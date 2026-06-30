package main

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"flovart/hub/config"
	"flovart/hub/handler"
	"flovart/hub/middleware"
	"flovart/hub/model"
	"flovart/hub/repository"
	"flovart/hub/service"
	"flovart/hub/storage"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config load: %v", err)
	}
	db, err := gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatalf("db open: %v", err)
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
			uploadSvc := service.NewUploadService(r2)
			uploadH = handler.NewUploadHandler(uploadSvc)
			log.Printf("R2 storage ready: bucket=%s publicBase=%s", cfg.Storage.Bucket, cfg.Storage.PublicBase)
		}
	} else {
		log.Printf("R2 storage not configured (R2_ACCOUNT_ID/Bucket missing); upload routes disabled")
	}

	if strings.ToLower(cfg.CORSAllow) != "off" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	r.Use(corsMiddleware(cfg.CORSAllow))
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	api := r.Group("/api/v1")
	{
		auth := api.Group("/auth")
		{
			auth.POST("/register", authH.Register)
			auth.POST("/login", authH.Login)
			auth.GET("/me", middleware.Auth(cfg.JWTSecret), authH.Me)
		}
		p := api.Group("/prompts")
		{
			p.GET("", promptH.List)
			p.GET("/by-slug/:slug", promptH.GetBySlug)
			p.GET("/:id", promptH.Get)
			p.GET("/:id/download", promptH.Download)
			pAuth := p.Group("", middleware.Auth(cfg.JWTSecret))
			{
				pAuth.POST("", promptH.Create)
				pAuth.PUT("/:id", promptH.Update)
				pAuth.DELETE("/:id", promptH.Delete)
				pAuth.POST("/:id/like", promptH.ToggleLike)
			}
		}
		if uploadH != nil {
			up := api.Group("/uploads", middleware.Auth(cfg.JWTSecret))
			{
				up.POST("/presign", uploadH.Presign)
				up.POST("/confirm", uploadH.Confirm)
			}
		}
	}

	log.Printf("flovart/hub listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func corsMiddleware(allow string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allow == "*" || allow == origin || allow == "off" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func atoiDefault(s string, def int) int {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return def
		}
		n = n*10 + int(ch-'0')
	}
	if n <= 0 {
		return def
	}
	return n
}