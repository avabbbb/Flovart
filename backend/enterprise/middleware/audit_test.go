package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"flovart/enterprise/model"
	"github.com/gin-gonic/gin"
)

type memoryAuditRecorder struct{ entries []*model.AuditLog }

func (r *memoryAuditRecorder) Create(entry *model.AuditLog) error {
	r.entries = append(r.entries, entry)
	return nil
}

func TestAuditRecordsMutationMetadataWithoutRequestBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := &memoryAuditRecorder{}
	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set(ContextUserID, "user-1")
		c.Next()
	}, Audit(recorder))
	r.POST("/orgs/:id/secrets", func(c *gin.Context) { c.Status(http.StatusNoContent) })

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/orgs/org-1/secrets", strings.NewReader(`{"apiKey":"must-not-be-recorded"}`)))

	if len(recorder.entries) != 1 {
		t.Fatalf("entries=%d", len(recorder.entries))
	}
	entry := recorder.entries[0]
	if entry.ActorID != "user-1" || entry.OrgID != "org-1" || entry.Method != http.MethodPost || entry.StatusCode != http.StatusNoContent {
		t.Fatalf("unexpected audit entry: %#v", entry)
	}
}
