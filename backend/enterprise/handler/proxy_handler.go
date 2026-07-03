package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
)

type ProxyHandler struct {
	svc *service.ProxyService
}

func NewProxyHandler(svc *service.ProxyService) *ProxyHandler {
	return &ProxyHandler{svc: svc}
}

func (h *ProxyHandler) Forward(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req service.ProxyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	result, err := h.svc.Forward(c.Param("id"), uid, req)
	if err != nil {
		Fail(c, http.StatusBadGateway, err.Error())
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result, "msg": "ok"})
}
