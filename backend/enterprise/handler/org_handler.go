package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
)

type OrgHandler struct {
	svc *service.OrgService
}

func NewOrgHandler(svc *service.OrgService) *OrgHandler {
	return &OrgHandler{svc: svc}
}

type createOrgReq struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

func (h *OrgHandler) Create(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req createOrgReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	org, err := h.svc.Create(uid, service.CreateOrgInput{Slug: req.Slug, Name: req.Name})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, org)
}

func (h *OrgHandler) MyOrgs(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	list, err := h.svc.ListMyOrgs(uid)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

func (h *OrgHandler) Get(c *gin.Context) {
	org, err := h.svc.Get(c.Param("id"))
	if err != nil || org == nil {
		Fail(c, http.StatusNotFound, "组织不存在")
		return
	}
	OK(c, org)
}

func (h *OrgHandler) Delete(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	if err := h.svc.Delete(c.Param("id"), uid); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("id")})
}

func (h *OrgHandler) ListMembers(c *gin.Context) {
	list, err := h.svc.ListMembers(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

type addOrgMemberReq struct {
	ByUsername string `json:"byUsername"`
}

func (h *OrgHandler) AddMember(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req addOrgMemberReq
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.ByUsername) == "" {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	m, err := h.svc.AddMember(uid, service.AddOrgMemberInput{
		OrgID: c.Param("id"), ByUsername: req.ByUsername,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, m)
}

func (h *OrgHandler) RemoveMember(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	if err := h.svc.RemoveMember(uid, c.Param("id"), c.Param("userId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"removed": c.Param("userId")})
}
