package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/service"
)

type ProjectHandler struct {
	svc *service.ProjectService
}

func NewProjectHandler(svc *service.ProjectService) *ProjectHandler {
	return &ProjectHandler{svc: svc}
}

type syncProjectReq struct {
	ID              string `json:"id" binding:"required"`
	OrgID           string `json:"orgId" binding:"required"`
	OwnerID         string `json:"ownerId" binding:"required"`
	Title           string `json:"title" binding:"required"`
	NodeCount       int    `json:"nodeCount"`
	ConnectionCount int    `json:"connectionCount"`
}

func (h *ProjectHandler) Sync(c *gin.Context) {
	var req syncProjectReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	p, err := h.svc.Sync(service.SyncProjectInput{
		ID: req.ID, OrgID: req.OrgID, OwnerID: req.OwnerID,
		Title: req.Title, NodeCount: req.NodeCount, ConnectionCount: req.ConnectionCount,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, p)
}

func (h *ProjectHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.List(c.Param("id"), page, size)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

func (h *ProjectHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Param("projId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("projId")})
}
