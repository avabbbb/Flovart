package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
	ContextUserID   contextKey = "userId"
	ContextUsername contextKey = "username"
	ContextRole     contextKey = "role"
)

// Auth JWT 校验中间件
func Auth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "未登录"})
			return
		}
		claims := &jwt.RegisteredClaims{}
		_, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
			return []byte(secret), nil
		})
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "登录已过期"})
			return
		}
		c.Set(string(ContextUserID), claims.Subject)
		c.Set(string(ContextRole), claims.Audience[0])
		c.Next()
	}
}

// RequireRole 角色限定的二段中间件，需在 Auth 之后
func RequireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, ok := c.Get(string(ContextRole))
		if !ok || v != role {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "msg": "无权限"})
			return
		}
		c.Next()
	}
}

func extractToken(c *gin.Context) string {
	auth := c.GetHeader("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	return ""
}