package handler

import (
	"github.com/gin-gonic/gin"

	"flovart/hub/service"
)

type DeploymentHandler struct {
	svc *service.DeploymentService
}

func NewDeploymentHandler(svc *service.DeploymentService) *DeploymentHandler {
	return &DeploymentHandler{svc: svc}
}

func (h *DeploymentHandler) Profile(c *gin.Context) {
	OK(c, h.svc.Profile())
}
