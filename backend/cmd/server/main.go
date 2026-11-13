package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"flovart/hub/config"
	"flovart/hub/handler"
	"flovart/hub/middleware"
	"flovart/hub/model"
	"flovart/hub/repository"
	"flovart/hub/service"
	"flovart/hub/storage"
)

// maxRequestBody 单个 JSON 请求体上限；上传走 R2 预签名直传，不经过本服务
const maxRequestBody = 4 << 20

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load: %v", err)
	}
	if len(cfg.JWTSecret) < 32 {
		log.Printf("WARNING: JWT_SECRET is shorter than 32 bytes; use a long random secret outside local dev")
	}

	db, err := openDB(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.PromptPack{}, &model.PromptItem{}, &model.PromptLike{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	userRepo := repository.NewUserRepository(db)
	packRepo := repository.NewPromptRepository(db)
	authSvc := service.NewAuthService(userRepo, cfg.JWTSecret, atoiDefault(cfg.JWTExpHours, 168))
	promptSvc := service.NewPromptService(packRepo)
	authH := handler.NewAuthHandler(authSvc)
	promptH := handler.NewPromptHandler(promptSvc)

	var uploadH *handler.UploadHandler
	if cfg.StorageReady() {
		r2, err := storage.NewR2Client(context.Background(),
			cfg.Storage.AccountID, cfg.Storage.AccessKey, cfg.Storage.SecretKey,
			cfg.Storage.Bucket, cfg.Storage.PublicBase)
		if err != nil {
			log.Printf("R2 client init failed: %v (upload routes disabled)", err)
		} else {
			uploadH = handler.NewUploadHandler(service.NewUploadService(r2))
			log.Printf("R2 storage ready: bucket=%s publicBase=%s", cfg.Storage.Bucket, cfg.Storage.PublicBase)
		}
	} else {
		log.Printf("R2 storage not configured (R2_ACCOUNT_ID/Bucket missing); upload routes disabled")
	}

	// 旧实现把 gin 模式与 CORS_ALLOW 绑定（off 时进入 debug）；改为遵循标准 GIN_MODE，默认 release
	if os.Getenv(gin.EnvGinMode) == "" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.New()
	r.Use(gin.Logger(), gin.CustomRecovery(func(c *gin.Context, rec any) {
		log.Printf("panic: %s %s: %v", c.Request.Method, c.Request.URL.Path, rec)
		handler.Fail(c, http.StatusInternalServerError, "服务器内部错误")
		c.Abort()
	}))
	r.Use(middleware.CORS(cfg.CORSAllow), middleware.BodyLimit(maxRequestBody))
	r.NoRoute(func(c *gin.Context) { handler.Fail(c, http.StatusNotFound, "接口不存在") })

	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"service": "flovart/hub", "status": "ok", "api": "/api/v1"})
	})
	r.GET("/healthz", func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if sqlDB, err := db.DB(); err != nil || sqlDB.PingContext(ctx) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false})
			return
		}
		c.JSON(http.StatusOK, gin.H{"ok": true})
	})

	requireAuth := middleware.Auth(cfg.JWTSecret, userRepo)
	api := r.Group("/api/v1")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/register", authH.Register)
			auth.POST("/login", authH.Login)
			auth.GET("/me", requireAuth, authH.Me)
		}
		p := api.Group("/prompts")
		{
			p.GET("", promptH.List)
			p.GET("/by-slug/:slug", promptH.GetBySlug)
			p.GET("/:id", promptH.Get)
			p.GET("/:id/download", promptH.Download)
			pAuth := p.Group("", requireAuth)
			{
				pAuth.POST("", promptH.Create)
				pAuth.PUT("/:id", promptH.Update)
				pAuth.DELETE("/:id", promptH.Delete)
				pAuth.POST("/:id/like", promptH.ToggleLike)
			}
		}
		if uploadH != nil {
			up := api.Group("/uploads", requireAuth)
			{
				up.POST("/presign", uploadH.Presign)
				up.POST("/confirm", uploadH.Confirm)
			}
		}
	}

	srv := &http.Server{
		Addr:              cfg.Bind + ":" + cfg.Port,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	go func() {
		log.Printf("flovart/hub listening on %s", srv.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	}()

	// 优雅退出：收到 SIGINT/SIGTERM 后停止接新连接，等待在途请求最多 10 秒，再关闭连接池
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Printf("shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
	if sqlDB, err := db.DB(); err == nil {
		_ = sqlDB.Close()
	}
}

// openDB 打开连接、开启错误翻译（唯一键冲突 → gorm.ErrDuplicatedKey）、配置连接池并做一次带超时的连通性检查
func openDB(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		TranslateError: true,
		Logger:         logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, err
	}
	return db, nil
}

func atoiDefault(s string, def int) int {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return def
		}
		n = n*10 + int(ch-'0')
		if n > 1<<20 {
			return def
		}
	}
	if n <= 0 {
		return def
	}
	return n
}
