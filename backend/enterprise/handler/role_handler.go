package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/service"
)

type RoleHandler struct {
	svc *service.RoleService
}

func NewRoleHandler(svc *service.RoleService) *RoleHandler {
	return &RoleHandler{svc}
}

func (h *RoleHandler) List(c *gin.Context) {
	list, err := h.svc.List(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

type createRoleReq struct {
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
	Sort        int      `json:"sort"`
}

func (h *RoleHandler) Create(c *gin.Context) {
	orgID := c.Param("id")
	var req createRoleReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	ro, err := h.svc.Create(service.CreateRoleInput{
		OrgID: orgID, Name: req.Name, Permissions: req.Permissions, Sort: req.Sort,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, ro)
}

type updateRolePermsReq struct {
	Name        *string   `json:"name"`
	Permissions []string  `json:"permissions"`
	Sort        *int      `json:"sort"`
}

func (h *RoleHandler) Update(c *gin.Context) {
	roleID := c.Param("roleId")
	var req updateRolePermsReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	ro, err := h.svc.Update(roleID, service.UpdateRoleInput{
		Name: req.Name, Permissions: req.Permissions, Sort: req.Sort,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, ro)
}

func (h *RoleHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Param("roleId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("roleId")})
}

// ---- 组织级辅助 ----

// MyPerms 我在该组织的有效权限集（前端 UI 按钮显隐）
func (h *RoleHandler) MyPerms(svc *service.RbacService) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString("userId")
		orgID := c.Param("id")
		perms, err := svc.EffectivePerms(orgID, uid)
		if err != nil {
			Fail(c, http.StatusInternalServerError, err.Error())
			return
		}
		OK(c, gin.H{"permissions": perms})
	}
}