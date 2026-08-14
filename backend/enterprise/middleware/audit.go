package middleware

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"flovart/enterprise/model"
	"github.com/gin-gonic/gin"
)

type AuditRecorder interface {
	Create(entry *model.AuditLog) error
}

func Audit(recorder AuditRecorder) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		requestID := c.GetHeader("X-Request-ID")
		if requestID == "" {
			requestID = randomRequestID()
		}
		c.Header("X-Request-ID", requestID)
		c.Next()
		entry := &model.AuditLog{
			OrgID:      c.Param("id"),
			ActorID:    c.GetString(ContextUserID),
			Method:     c.Request.Method,
			Route:      c.FullPath(),
			StatusCode: c.Writer.Status(),
			RequestID:  requestID,
			IP:         c.ClientIP(),
			UserAgent:  c.Request.UserAgent(),
		}
		if entry.ActorID != "" {
			_ = recorder.Create(entry)
		}
	}
}

func randomRequestID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "audit-request"
	}
	return hex.EncodeToString(buf)
}
