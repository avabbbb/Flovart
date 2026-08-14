package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRequirePlatformAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name string
		role string
		want int
	}{
		{name: "admin allowed", role: "admin", want: http.StatusOK},
		{name: "member denied", role: "user", want: http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.GET("/platform", func(c *gin.Context) {
				c.Set(ContextUserID, "user-1")
				c.Set(ContextRole, tc.role)
				c.Next()
			}, RequirePlatformAdmin(), func(c *gin.Context) { c.Status(http.StatusOK) })
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/platform", nil))
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
