package middleware

import (
	"context"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

type AccountSessionReader interface {
	SessionState(ctx context.Context, id string) (status string, tokenVersion int64, err error)
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
			status, tokenVersion, stateErr := readers[0].SessionState(c.Request.Context(), claims.Subject)
			if stateErr != nil {
				// 数据库故障不应被前端当成"登录失效"而清掉 token
				log.Printf("auth: session state lookup failed: %v", stateErr)
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"code": 503, "data": nil, "msg": "服务暂不可用，请稍后重试"})
				return
			}
			if status != "active" || tokenVersion != claims.TokenVersion {
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
	auth := strings.TrimSpace(c.GetHeader("Authorization"))
	const prefix = "bearer "
	if len(auth) > len(prefix) && strings.EqualFold(auth[:len(prefix)], prefix) {
		return strings.TrimSpace(auth[len(prefix):])
	}
	return ""
}
