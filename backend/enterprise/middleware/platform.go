package middleware

import "github.com/gin-gonic/gin"

func RequirePlatformAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetString(ContextRole) != "admin" {
			abort(c, 403, "仅平台管理员可访问")
			return
		}
		c.Next()
	}
}
