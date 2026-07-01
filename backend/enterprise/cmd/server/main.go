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
		&model.Department{},
		&model.DepartmentMember{},
		&model.Role{},
	); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	orgRepo := repository.NewOrgRepository(db)
	userRepo := repository.NewUserRepository(db)
	deptRepo := repository.NewDeptRepository(db)
	roleRepo := repository.NewRoleRepository(db)
	rbacRepo := repository.NewRbacRepository(db)

	orgSvc := service.NewOrgService(db, orgRepo, userRepo, deptRepo, roleRepo)
	rbacSvc := service.NewRbacService(orgRepo, rbacRepo)
	deptSvc := service.NewDeptService(deptRepo)
	roleSvc := service.NewRoleService(roleRepo)

	orgH := handler.NewOrgHandler(orgSvc)
	deptH := handler.NewDeptHandler(deptSvc)
	roleH := handler.NewRoleHandler(roleSvc)

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(corsMiddleware(cfg.CORSAllow))
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	api := r.Group("/api/v1/enterprise", middleware.Auth(cfg.JWTSecret))
	{
		// 组织 CRUD（沿用现有 handler）
		api.POST("/orgs", orgH.Create)
		api.GET("/orgs", orgH.MyOrgs)
		api.GET("/orgs/:id", middleware.RequireMember(rbacSvc), orgH.Get)
		api.DELETE("/orgs/:id", middleware.RequirePerm(rbacSvc, model.PermOrgManage), orgH.Delete)

		// 成员名册（M4：改为部门汇总 + 根部门快捷加入）
		api.GET("/orgs/:id/members", middleware.RequireMember(rbacSvc), orgH.ListMembers)
		api.POST("/orgs/:id/members", middleware.RequirePerm(rbacSvc, model.PermMemberInvite), orgH.AddMember)
		api.DELETE("/orgs/:id/members/:userId", middleware.RequirePerm(rbacSvc, model.PermMemberManage), orgH.RemoveMember)

		// 部门树（M3 新增）
		api.POST("/orgs/:id/departments", middleware.RequirePerm(rbacSvc, model.PermDeptManage), deptH.Create)
		api.GET("/orgs/:id/departments", middleware.RequireMember(rbacSvc), deptH.Tree)
		api.PUT("/departments/:deptId", middleware.RequirePerm(rbacSvc, model.PermDeptManage), deptH.Update)
		api.DELETE("/departments/:deptId", middleware.RequirePerm(rbacSvc, model.PermDeptManage), deptH.Delete)

		// 部门成员（M3 新增）
		// 注意：部门 API 路径 :id 在 RequirePerm 里读不到（部门路径是 :deptId）
		//       故部门级鉴权也走 orgID 查 dept.org_id 的方式 — 这里暂用 RequireMember on :id
		//       …但部门成员路径上没有 :id。M5 前统一改成 DeptPerm。
		// MVP 简化：部门成员 CRUD 暂只要求已登录成员（组织内），不再细分权限点。
		// 完整鉴权待 M5 部门级 middleware 实现。
		api.GET("/departments/:deptId/members", deptH.ListMembers)
		api.POST("/departments/:deptId/members", deptH.AddMember)
		api.PUT("/departments/:deptId/members/:userId", deptH.UpdateMember)
		api.DELETE("/departments/:deptId/members/:userId", deptH.RemoveMember)

		// 角色 CRUD（M3 新增）
		api.GET("/orgs/:id/roles", middleware.RequireMember(rbacSvc), roleH.List)
		api.POST("/orgs/:id/roles", middleware.RequirePerm(rbacSvc, model.PermRoleManage), roleH.Create)
		api.PUT("/roles/:roleId", middleware.RequirePerm(rbacSvc, model.PermRoleManage), roleH.Update)
		api.DELETE("/roles/:roleId", middleware.RequirePerm(rbacSvc, model.PermRoleManage), roleH.Delete)

		// 我的有效权限集
		api.GET("/orgs/:id/me/permissions", middleware.RequireMember(rbacSvc), roleH.MyPerms(rbacSvc))
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