package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/service"
)

// RequirePerm 鉴权中间件。约定路由路径参数名为 :id（组织 ID）
// 1. 未登录 → 401
// 2. 不在 org 内 → 403（即便 owner 也走 Auth 已注入 user）
// 3. 满足 perm → 通过
//
// 用法：api.POST("/orgs/:id/departments", middleware.RequirePerm(rbacSvc, model.PermDeptManage), h.Create)
func RequirePerm(svc *service.RbacService, perm string) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString(ContextUserID)
		if uid == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "未登录"})
			return
		}
		orgID := c.Param("id")
		if orgID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "缺少组织 id"})
			return
		}
		ok, err := svc.Satisfy(orgID, uid, perm)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "鉴权失败"})
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "msg": "权限不足"})
			return
		}
		c.Next()
	}
}

// RequireMember 组织成员即可通过的中间件（如 GET 部门树、GET 成员列表）
func RequireMember(svc *service.RbacService) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString(ContextUserID)
		if uid == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "未登录"})
			return
		}
		orgID := c.Param("id")
		if orgID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "缺少组织 id"})
			return
		}
		ok, err := svc.IsMember(orgID, uid)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "鉴权失败"})
			return
		}
		if !ok {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "msg": "非组织成员"})
			return
		}
		c.Next()
	}
}