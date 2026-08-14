package handler

import (
	"net/http"
	"strconv"

	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
	"github.com/gin-gonic/gin"
)

type PlatformHandler struct{ svc *service.PlatformService }

func NewPlatformHandler(svc *service.PlatformService) *PlatformHandler {
	return &PlatformHandler{svc: svc}
}

type createPlatformUserReq struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

func (h *PlatformHandler) CreateUser(c *gin.Context) {
	var req createPlatformUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	user, err := h.svc.CreateUser(service.CreatePlatformUserInput(req))
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, user)
}

func (h *PlatformHandler) ListUsers(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.ListUsers(c.Query("search"), page, size)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

type updatePlatformUserReq struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
	Status   string `json:"status"`
}

func (h *PlatformHandler) UpdateUser(c *gin.Context) {
	var req updatePlatformUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	user, err := h.svc.UpdateUser(service.UpdatePlatformUserInput{
		RequesterID: c.GetString(middleware.ContextUserID), UserID: c.Param("userId"),
		Username: req.Username, Email: req.Email, Role: req.Role, Status: req.Status,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, user)
}

func (h *PlatformHandler) DeleteUser(c *gin.Context) {
	if err := h.svc.DeleteUser(c.GetString(middleware.ContextUserID), c.Param("userId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("userId")})
}

func (h *PlatformHandler) ListOrganizations(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.ListOrganizations(page, size)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

func (h *PlatformHandler) UpdateOrganization(c *gin.Context) {
	var req struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	if err := h.svc.UpdateOrganizationStatus(c.Param("orgId"), req.Status); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"orgId": c.Param("orgId"), "status": req.Status})
}
