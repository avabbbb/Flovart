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
	// API Key 加密密钥必须单独配置，启动即失败，避免回退 JWT_SECRET 的弱隔离
	if err := service.RequireKeyEncryptionSecret(); err != nil {
		log.Fatalf("key encryption: %v", err)
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
		// 信用与计费
		&model.OrgCredit{},
		&model.CreditTransaction{},
		&model.RechargeRequest{},
		&model.UsageRecord{},
		// API Key 池与额度
		&model.OrgApiKey{},
		&model.ModelPricing{},
		&model.MemberQuota{},
		// 资源管理
		&model.ResourceLevel{},
		&model.Resource{},
		// 审批流
		&model.ApprovalWorkflow{},
		&model.ApprovalNode{},
		&model.ApprovalRecord{},
		&model.ApprovalStep{},
		// 敏感词
		&model.SensitiveWord{},
		// 项目镜像
		&model.Project{},
		// 企业审计（不保存请求正文与密钥）
		&model.AuditLog{},
	); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	orgRepo := repository.NewOrgRepository(db)
	userRepo := repository.NewUserRepository(db)
	deptRepo := repository.NewDeptRepository(db)
	roleRepo := repository.NewRoleRepository(db)
	rbacRepo := repository.NewRbacRepository(db)
	creditRepo := repository.NewCreditRepository(db)
	apiKeyRepo := repository.NewApiKeyRepository(db)
	resourceRepo := repository.NewResourceRepository(db)
	approvalRepo := repository.NewApprovalRepository(db)
	sensitiveRepo := repository.NewSensitiveRepository(db)
	projectRepo := repository.NewProjectRepository(db)
	auditRepo := repository.NewAuditRepository(db)

	orgSvc := service.NewOrgService(db, orgRepo, userRepo, deptRepo, roleRepo)
	rbacSvc := service.NewRbacService(orgRepo, rbacRepo)
	deptSvc := service.NewDeptService(deptRepo)
	roleSvc := service.NewRoleService(roleRepo)
	creditSvc := service.NewCreditService(db, creditRepo)
	apiKeySvc := service.NewApiKeyService(db, apiKeyRepo, creditRepo)
	proxySvc := service.NewProxyService(db, apiKeyRepo, creditRepo, creditSvc, apiKeySvc)
	resourceSvc := service.NewResourceService(db, resourceRepo)
	approvalSvc := service.NewApprovalService(db, approvalRepo, deptRepo)
	sensitiveSvc := service.NewSensitiveService(sensitiveRepo)
	projectSvc := service.NewProjectService(projectRepo)
	platformSvc := service.NewPlatformService(userRepo, orgRepo)
	auditSvc := service.NewAuditService(auditRepo)

	orgH := handler.NewOrgHandler(orgSvc)
	deptH := handler.NewDeptHandler(deptSvc)
	roleH := handler.NewRoleHandler(roleSvc)
	creditH := handler.NewCreditHandler(creditSvc)
	apiKeyH := handler.NewApiKeyHandler(apiKeySvc)
	proxyH := handler.NewProxyHandler(proxySvc)
	resourceH := handler.NewResourceHandler(resourceSvc)
	approvalH := handler.NewApprovalHandler(approvalSvc)
	sensitiveH := handler.NewSensitiveHandler(sensitiveSvc)
	projectH := handler.NewProjectHandler(projectSvc)
	platformH := handler.NewPlatformHandler(platformSvc)
	auditH := handler.NewAuditHandler(auditSvc)

	gin.SetMode(gin.ReleaseMode)
	r := gin.Default()
	r.Use(corsMiddleware(cfg.CORSAllow))
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	api := r.Group("/api/v1/enterprise", middleware.Auth(cfg.JWTSecret, userRepo), middleware.Audit(auditRepo))
	{
		platform := api.Group("/platform", middleware.RequirePlatformAdmin())
		{
			platform.GET("/users", platformH.ListUsers)
			platform.POST("/users", platformH.CreateUser)
			platform.PUT("/users/:userId", platformH.UpdateUser)
			platform.DELETE("/users/:userId", platformH.DeleteUser)
			platform.GET("/organizations", platformH.ListOrganizations)
			platform.PUT("/organizations/:orgId", platformH.UpdateOrganization)
			platform.GET("/audit-logs", auditH.ListPlatform)
		}

		// 组织 CRUD（沿用现有 handler）
		api.POST("/orgs", orgH.Create)
		api.GET("/orgs", orgH.MyOrgs)
		api.GET("/orgs/:id", middleware.RequireMember(rbacSvc), orgH.Get)
		api.DELETE("/orgs/:id", middleware.RequirePerm(rbacSvc, model.PermOrgManage), orgH.Delete)

		// 成员名册（M4：改为部门汇总 + 根部门快捷加入）
		api.GET("/orgs/:id/members", middleware.RequireMember(rbacSvc), orgH.ListMembers)
		api.POST("/orgs/:id/members", middleware.RequirePerm(rbacSvc, model.PermMemberInvite), orgH.AddMember)
		api.PUT("/orgs/:id/members/:userId", middleware.RequirePerm(rbacSvc, model.PermMemberManage), orgH.UpdateMember)
		api.DELETE("/orgs/:id/members/:userId", middleware.RequirePerm(rbacSvc, model.PermMemberManage), orgH.RemoveMember)
		api.GET("/orgs/:id/audit-logs", middleware.RequirePerm(rbacSvc, model.PermViewAuditLog), auditH.ListOrganization)

		// 部门树（M3 新增）
		api.POST("/orgs/:id/departments", middleware.RequirePerm(rbacSvc, model.PermDeptManage), deptH.Create)
		api.GET("/orgs/:id/departments", middleware.RequireMember(rbacSvc), deptH.Tree)
		api.PUT("/departments/:deptId", middleware.RequireDeptPerm(rbacSvc, model.PermDeptManage), deptH.Update)
		api.DELETE("/departments/:deptId", middleware.RequireDeptPerm(rbacSvc, model.PermDeptManage), deptH.Delete)

		// 部门成员通过 deptId 反查 org_id 后再鉴权。
		api.GET("/departments/:deptId/members", middleware.RequireDeptMember(rbacSvc), deptH.ListMembers)
		api.POST("/departments/:deptId/members", middleware.RequireDeptPerm(rbacSvc, model.PermMemberManage), deptH.AddMember)
		api.PUT("/departments/:deptId/members/:userId", middleware.RequireDeptPerm(rbacSvc, model.PermMemberManage), deptH.UpdateMember)
		api.DELETE("/departments/:deptId/members/:userId", middleware.RequireDeptPerm(rbacSvc, model.PermMemberManage), deptH.RemoveMember)

		// 角色 CRUD（M3 新增）
		api.GET("/orgs/:id/roles", middleware.RequireMember(rbacSvc), roleH.List)
		api.POST("/orgs/:id/roles", middleware.RequirePerm(rbacSvc, model.PermRoleManage), roleH.Create)
		api.PUT("/roles/:roleId", middleware.RequireRolePerm(rbacSvc, model.PermRoleManage), roleH.Update)
		api.DELETE("/roles/:roleId", middleware.RequireRolePerm(rbacSvc, model.PermRoleManage), roleH.Delete)

		// 我的有效权限集
		api.GET("/orgs/:id/me/permissions", middleware.RequireMember(rbacSvc), roleH.MyPerms(rbacSvc))

		// 积分与计费
		api.GET("/orgs/:id/credit", middleware.RequireMember(rbacSvc), creditH.Balance)
		api.GET("/orgs/:id/credit/transactions", middleware.RequireMember(rbacSvc), creditH.Transactions)
		api.POST("/orgs/:id/credit/recharges", middleware.RequirePerm(rbacSvc, model.PermCreditGrant), creditH.CreateRecharge)
		api.GET("/orgs/:id/credit/recharges", middleware.RequireMember(rbacSvc), creditH.ListRecharges)
		api.PUT("/orgs/:id/credit/recharges/:rechargeId/cancel", middleware.RequirePerm(rbacSvc, model.PermCreditGrant), creditH.CancelRecharge)
		api.PUT("/orgs/:id/credit/recharges/:rechargeId/review", middleware.RequirePerm(rbacSvc, model.PermCreditAdjust), creditH.ReviewRecharge)
		api.GET("/orgs/:id/credit/usage", middleware.RequireMember(rbacSvc), creditH.ListUsage)

		// API Key 池
		api.GET("/orgs/:id/api-keys", middleware.RequireMember(rbacSvc), apiKeyH.List)
		api.POST("/orgs/:id/api-keys", middleware.RequirePerm(rbacSvc, model.PermApiKeyManage), apiKeyH.Create)
		api.PUT("/orgs/:id/api-keys/:keyId", middleware.RequirePerm(rbacSvc, model.PermApiKeyManage), apiKeyH.Toggle)
		api.DELETE("/orgs/:id/api-keys/:keyId", middleware.RequirePerm(rbacSvc, model.PermApiKeyManage), apiKeyH.Delete)

		// 模型单价
		api.GET("/orgs/:id/pricing", middleware.RequireMember(rbacSvc), apiKeyH.ListPricing)
		api.POST("/orgs/:id/pricing", middleware.RequirePerm(rbacSvc, model.PermPricingManage), apiKeyH.CreatePricing)
		api.DELETE("/orgs/:id/pricing/:pricingId", middleware.RequirePerm(rbacSvc, model.PermPricingManage), apiKeyH.DeletePricing)

		// 成员额度
		api.GET("/orgs/:id/quotas", middleware.RequirePerm(rbacSvc, model.PermQuotaManage), apiKeyH.ListQuotas)
		api.PUT("/orgs/:id/quotas", middleware.RequirePerm(rbacSvc, model.PermQuotaManage), apiKeyH.UpdateQuota)

		// AI 代理 — 组织成员通过此端点间接使用 org 的 API Key
		api.POST("/orgs/:id/ai/proxy", middleware.RequireMember(rbacSvc), proxyH.Forward)

		// 资源密级
		api.GET("/orgs/:id/resource-levels", middleware.RequireMember(rbacSvc), resourceH.ListLevels)
		api.POST("/orgs/:id/resource-levels", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), resourceH.CreateLevel)
		api.DELETE("/orgs/:id/resource-levels/:levelId", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), resourceH.DeleteLevel)

		// 资源库
		api.GET("/orgs/:id/resources", middleware.RequireMember(rbacSvc), resourceH.List)
		api.POST("/orgs/:id/resources", middleware.RequireMember(rbacSvc), resourceH.Create)
		api.GET("/orgs/:id/resources/:resId", middleware.RequireMember(rbacSvc), resourceH.Get)
		api.PUT("/orgs/:id/resources/:resId/review", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), resourceH.Review)
		api.PUT("/orgs/:id/resources/:resId/publish", middleware.RequirePerm(rbacSvc, model.PermAssetPublish), resourceH.Publish)

		// 审批流
		api.GET("/orgs/:id/approval-workflows", middleware.RequireMember(rbacSvc), approvalH.List)
		api.POST("/orgs/:id/approval-workflows", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), approvalH.Create)
		api.GET("/orgs/:id/approval-workflows/:wfId", middleware.RequireMember(rbacSvc), approvalH.Get)
		api.DELETE("/orgs/:id/approval-workflows/:wfId", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), approvalH.Delete)
		api.POST("/orgs/:id/approvals/submit", middleware.RequireMember(rbacSvc), approvalH.Submit)
		api.GET("/orgs/:id/approvals", middleware.RequireMember(rbacSvc), approvalH.ListRecords)
		api.GET("/orgs/:id/approvals/:recId", middleware.RequireMember(rbacSvc), approvalH.GetRecord)
		api.PUT("/orgs/:id/approvals/:recId/act", middleware.RequireMember(rbacSvc), approvalH.Act)

		// 敏感词
		api.GET("/orgs/:id/sensitive-words", middleware.RequireMember(rbacSvc), sensitiveH.List)
		api.POST("/orgs/:id/sensitive-words", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), sensitiveH.Create)
		api.DELETE("/orgs/:id/sensitive-words/:wordId", middleware.RequirePerm(rbacSvc, model.PermAssetApprove), sensitiveH.Delete)
		api.POST("/orgs/:id/sensitive-words/check", middleware.RequireMember(rbacSvc), sensitiveH.Check)

		// 项目镜像
		api.POST("/orgs/:id/projects/sync", middleware.RequireMember(rbacSvc), projectH.Sync)
		api.GET("/orgs/:id/projects", middleware.RequireMember(rbacSvc), projectH.List)
		api.DELETE("/orgs/:id/projects/:projId", middleware.RequirePerm(rbacSvc, model.PermOrgManage), projectH.Delete)
	}

	log.Printf("flovart/enterprise listening on :%s", cfg.Port)
	if err := r.Run(":" + cfg.Port); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func corsMiddleware(allow string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		switch allow {
		case "*":
			// 通配模式：不回显 Origin、不携带凭据
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
			c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		case "", "off":
			// 关闭 CORS：不输出任何 CORS 头
		default:
			// 白名单模式：仅放行匹配的 Origin 并携带凭据
			if origin == allow {
				c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
				c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
			}
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
