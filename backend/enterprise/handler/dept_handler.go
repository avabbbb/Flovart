package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
)

type DeptHandler struct {
	svc *service.DeptService
}

func NewDeptHandler(svc *service.DeptService) *DeptHandler {
	return &DeptHandler{svc}
}

type createDeptReq struct {
	Slug     string `json:"slug"`
	Name     string `json:"name"`
	ParentID string `json:"parentId"`
	Sort     int    `json:"sort"`
}

func (h *DeptHandler) Create(c *gin.Context) {
	orgID := c.Param("id")
	uid := c.GetString(middleware.ContextUserID)
	_ = uid // 权限由 RequirePerm 中间件保证
	var req createDeptReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	d, err := h.svc.Create(service.CreateDeptInput{
		OrgID: orgID, ParentID: strings.TrimSpace(req.ParentID),
		Slug: req.Slug, Name: req.Name, Sort: req.Sort,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, d)
}

func (h *DeptHandler) Tree(c *gin.Context) {
	tree, err := h.svc.Tree(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, tree)
}

type updateDeptReq struct {
	Slug     *string `json:"slug"`
	Name     *string `json:"name"`
	ParentID *string `json:"parentId"`
	Sort     *int    `json:"sort"`
}

func (h *DeptHandler) Update(c *gin.Context) {
	deptID := c.Param("deptId")
	var req updateDeptReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	d, err := h.svc.Update(deptID, service.UpdateDeptInput{
		Slug: req.Slug, Name: req.Name, ParentID: req.ParentID, Sort: req.Sort,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, d)
}

func (h *DeptHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Param("deptId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("deptId")})
}

func (h *DeptHandler) ListMembers(c *gin.Context) {
	list, err := h.svc.ListMembers(c.Param("deptId"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

type addDeptMemberReq struct {
	UserID  string   `json:"userId"`
	IsLead  bool     `json:"isLead"`
	RoleIDs []string `json:"roleIds"`
}

func (h *DeptHandler) AddMember(c *gin.Context) {
	deptID := c.Param("deptId")
	var req addDeptMemberReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.UserID) == "" {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	m, err := h.svc.AddMember(service.AddDeptMemberInput{
		DeptID: deptID, UserID: strings.TrimSpace(req.UserID),
		IsLead: req.IsLead, RoleIDs: req.RoleIDs,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, m)
}

type updateMemberReq struct {
	IsLead  *bool    `json:"isLead"`
	RoleIDs []string `json:"roleIds"`
}

func (h *DeptHandler) UpdateMember(c *gin.Context) {
	deptID := c.Param("deptId")
	userID := c.Param("userId")
	var req updateMemberReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	m, err := h.svc.UpdateMember(deptID, userID, service.UpdateMemberInput{
		IsLead: req.IsLead, RoleIDs: req.RoleIDs,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, m)
}

func (h *DeptHandler) RemoveMember(c *gin.Context) {
	if err := h.svc.RemoveMember(c.Param("deptId"), c.Param("userId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"removed": c.Param("userId")})
}