package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

type AccountSessionReader interface {
	SessionState(id string) (status string, tokenVersion int64, err error)
}

type userClaims struct {
	TokenVersion int64 `json:"ver"`
	jwt.RegisteredClaims
}

const (
	ContextUserID   contextKey = "userId"
	ContextUsername contextKey = "username"
	ContextRole     contextKey = "role"
)

// Auth JWT 校验中间件
func Auth(secret string, readers ...AccountSessionReader) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "data": nil, "msg": "未登录"})
			return
		}
		claims := &userClaims{}
		parsed, err := jwt.ParseWithClaims(token, claims, func(t *jwt.Token) (any, error) {
			return []byte(secret), nil
		}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
		if err != nil || parsed == nil || !parsed.Valid || claims.Subject == "" || len(claims.Audience) == 0 || claims.Audience[0] == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "data": nil, "msg": "登录已过期"})
			return
		}
		if len(readers) > 0 && readers[0] != nil {
			status, tokenVersion, stateErr := readers[0].SessionState(claims.Subject)
			if stateErr != nil || status != "active" || tokenVersion != claims.TokenVersion {
				c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "data": nil, "msg": "登录已失效"})
				return
			}
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
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "data": nil, "msg": "无权限"})
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
