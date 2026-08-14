package handler

import (
	"net/http"
	"strconv"

	"flovart/enterprise/service"
	"github.com/gin-gonic/gin"
)

type AuditHandler struct{ svc *service.AuditService }

func NewAuditHandler(svc *service.AuditService) *AuditHandler { return &AuditHandler{svc: svc} }

func (h *AuditHandler) ListOrganization(c *gin.Context) { h.list(c, c.Param("id")) }
func (h *AuditHandler) ListPlatform(c *gin.Context)     { h.list(c, "") }

func (h *AuditHandler) list(c *gin.Context, orgID string) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.List(orgID, page, size)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}
