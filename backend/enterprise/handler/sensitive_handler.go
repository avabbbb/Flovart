package handler

import (
	"net/http"

	"flovart/enterprise/service"
	"github.com/gin-gonic/gin"
)

type SensitiveHandler struct {
	svc *service.SensitiveService
}

func NewSensitiveHandler(svc *service.SensitiveService) *SensitiveHandler {
	return &SensitiveHandler{svc: svc}
}

type createSensitiveReq struct {
	Word     string `json:"word" binding:"required"`
	Category string `json:"category"`
	Action   string `json:"action"`
}

func (h *SensitiveHandler) Create(c *gin.Context) {
	var req createSensitiveReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	w, err := h.svc.Create(service.CreateSensitiveInput{
		OrgID: c.Param("id"), Word: req.Word, Category: req.Category, Action: req.Action,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, w)
}

func (h *SensitiveHandler) List(c *gin.Context) {
	list, err := h.svc.List(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

func (h *SensitiveHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Param("id"), c.Param("wordId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("wordId")})
}

type checkSensitiveReq struct {
	Text string `json:"text" binding:"required"`
}

func (h *SensitiveHandler) Check(c *gin.Context) {
	var req checkSensitiveReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	result, err := h.svc.Check(c.Param("id"), req.Text)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, result)
}
