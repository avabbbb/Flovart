package middleware

import (
	"net/http"

	"flovart/enterprise/service"
	"github.com/gin-gonic/gin"
)

// RequirePerm 鉴权中间件。约定路由路径参数名为 :id（组织 ID）
func RequirePerm(svc *service.RbacService, perm string) gin.HandlerFunc {
	return requireOrgPerm(svc, perm, func(c *gin.Context) (string, bool) {
		return c.Param("id"), false
	})
}

// RequireMember 组织成员即可通过的中间件（如 GET 部门树、GET 成员列表）
func RequireMember(svc *service.RbacService) gin.HandlerFunc {
	return requireOrgMember(svc, func(c *gin.Context) (string, bool) {
		return c.Param("id"), false
	})
}

func RequireDeptPerm(svc *service.RbacService, perm string) gin.HandlerFunc {
	return requireOrgPerm(svc, perm, func(c *gin.Context) (string, bool) {
		orgID, err := svc.OrgIDByDeptID(c.Param("deptId"))
		if err != nil {
			abort(c, http.StatusInternalServerError, "鉴权失败")
			return "", true
		}
		return orgID, false
	})
}

func RequireDeptMember(svc *service.RbacService) gin.HandlerFunc {
	return requireOrgMember(svc, func(c *gin.Context) (string, bool) {
		orgID, err := svc.OrgIDByDeptID(c.Param("deptId"))
		if err != nil {
			abort(c, http.StatusInternalServerError, "鉴权失败")
			return "", true
		}
		return orgID, false
	})
}

func RequireRolePerm(svc *service.RbacService, perm string) gin.HandlerFunc {
	return requireOrgPerm(svc, perm, func(c *gin.Context) (string, bool) {
		orgID, err := svc.OrgIDByRoleID(c.Param("roleId"))
		if err != nil {
			abort(c, http.StatusInternalServerError, "鉴权失败")
			return "", true
		}
		return orgID, false
	})
}

func requireOrgPerm(svc *service.RbacService, perm string, resolveOrg func(*gin.Context) (string, bool)) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString(ContextUserID)
		if uid == "" {
			abort(c, http.StatusUnauthorized, "未登录")
			return
		}
		orgID, aborted := resolveOrg(c)
		if aborted {
			return
		}
		if orgID == "" {
			abort(c, http.StatusNotFound, "组织资源不存在")
			return
		}
		ok, err := svc.Satisfy(orgID, uid, perm)
		if err != nil {
			abort(c, http.StatusInternalServerError, "鉴权失败")
			return
		}
		if !ok {
			abort(c, http.StatusForbidden, "权限不足")
			return
		}
		c.Next()
	}
}

func requireOrgMember(svc *service.RbacService, resolveOrg func(*gin.Context) (string, bool)) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString(ContextUserID)
		if uid == "" {
			abort(c, http.StatusUnauthorized, "未登录")
			return
		}
		orgID, aborted := resolveOrg(c)
		if aborted {
			return
		}
		if orgID == "" {
			abort(c, http.StatusNotFound, "组织资源不存在")
			return
		}
		ok, err := svc.IsMember(orgID, uid)
		if err != nil {
			abort(c, http.StatusInternalServerError, "鉴权失败")
			return
		}
		if !ok {
			abort(c, http.StatusForbidden, "非组织成员")
			return
		}
		c.Next()
	}
}

func abort(c *gin.Context, status int, msg string) {
	c.AbortWithStatusJSON(status, gin.H{"code": status, "msg": msg})
}
