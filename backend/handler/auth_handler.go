package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"flovart/hub/middleware"
	"flovart/hub/model"
	"flovart/hub/service"
)

type AuthHandler struct {
	svc *service.AuthService
}

func NewAuthHandler(svc *service.AuthService) *AuthHandler {
	return &AuthHandler{svc: svc}
}

type registerReq struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req registerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	user, token, err := h.svc.Register(req.Username, req.Email, req.Password)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"user": user, "token": token})
}

type loginReq struct {
	Identifier string `json:"identifier"`
	Password   string `json:"password"`
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req loginReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	user, token, err := h.svc.Login(req.Identifier, req.Password)
	if err != nil {
		Fail(c, http.StatusUnauthorized, err.Error())
		return
	}
	OK(c, gin.H{"user": user, "token": token})
}

func (h *AuthHandler) Me(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	if uid == "" {
		Fail(c, http.StatusUnauthorized, "未登录")
		return
	}
	OK(c, gin.H{"userId": uid})
	_ = strings.TrimSpace
}