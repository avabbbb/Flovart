package main

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"

	"flovart/enterprise/config"
	"flovart/enterprise/handler"
	"flovart/enterprise/middleware"
	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"flovart/enterprise/service"
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
	// 仅 AutoMigrate 本服务拥有的表；users 表由 hub 维护，这里不重建
	if err := db.AutoMigrate(
		&model.Organization{},
		&model.OrganizationMember{}, // 旧表，M3/M4 渐进废弃
		&model.Department{},
		&model.DepartmentMember{},
		&model.Role{},
	); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	orgRepo := repository.NewOrgRepository(db)
	userRepo := repository.NewUserRepository(db)
	orgSvc := service.NewOrgService(orgRepo, userRepo)
	orgH := handler.NewOrgHandler(orgSvc)

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(corsMiddleware(cfg.CORSAllow))
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	api := r.Group("/api/v1/enterprise", middleware.Auth(cfg.JWTSecret))
	{
		api.POST("/orgs", orgH.Create)
		api.GET("/orgs", orgH.MyOrgs)
		api.GET("/orgs/:id", orgH.Get)
		api.DELETE("/orgs/:id", orgH.Delete)
		api.GET("/orgs/:id/members", orgH.ListMembers)
		api.POST("/orgs/:id/members", orgH.AddMember)
		api.PUT("/orgs/:id/members/:userId", orgH.UpdateMemberRole)
		api.DELETE("/orgs/:id/members/:userId", orgH.RemoveMember)
	}

	log.Printf("flovart/enterprise listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func corsMiddleware(allow string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allow == "*" || allow == origin {
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