package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"flovart/hub/middleware"
	"flovart/hub/service"
)

type UploadHandler struct {
	svc *service.UploadService
}

func NewUploadHandler(svc *service.UploadService) *UploadHandler {
	return &UploadHandler{svc: svc}
}

type presignReq struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Purpose     string `json:"purpose"`
}

func (h *UploadHandler) Presign(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	var req presignReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	if req.Filename == "" || req.ContentType == "" {
		Fail(c, http.StatusBadRequest, "filename 与 contentType 必填")
		return
	}
	result, err := h.svc.Presign(c.Request.Context(), uid, service.PresignInput{
		Filename: req.Filename, ContentType: req.ContentType, Purpose: req.Purpose,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, result)
}

type confirmReq struct {
	Key string `json:"key"`
}

func (h *UploadHandler) Confirm(c *gin.Context) {
	var req confirmReq
	if err := c.ShouldBindJSON(&req); err != nil || req.Key == "" {
		Fail(c, http.StatusBadRequest, "key 必填")
		return
	}
	url, err := h.svc.ConfirmUpload(c.Request.Context(), req.Key)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"key": req.Key, "url": url})
}