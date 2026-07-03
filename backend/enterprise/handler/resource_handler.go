package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
)

type ResourceHandler struct {
	svc *service.ResourceService
}

func NewResourceHandler(svc *service.ResourceService) *ResourceHandler {
	return &ResourceHandler{svc: svc}
}

type createLevelReq struct {
	Name string `json:"name" binding:"required"`
	Sort int    `json:"sort"`
}

func (h *ResourceHandler) CreateLevel(c *gin.Context) {
	var req createLevelReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	l, err := h.svc.CreateLevel(service.CreateLevelInput{
		OrgID: c.Param("id"), Name: req.Name, Sort: req.Sort,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, l)
}

func (h *ResourceHandler) ListLevels(c *gin.Context) {
	list, err := h.svc.ListLevels(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

func (h *ResourceHandler) DeleteLevel(c *gin.Context) {
	if err := h.svc.DeleteLevel(c.Param("levelId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("levelId")})
}

type createResourceReq struct {
	Type      string `json:"type" binding:"required"`
	Title     string `json:"title"`
	Href      string `json:"href" binding:"required"`
	Thumbnail string `json:"thumbnail"`
	StorageKey string `json:"storageKey"`
	LevelID   string `json:"levelId"`
}

func (h *ResourceHandler) Create(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req createResourceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	res, err := h.svc.Create(service.CreateResourceInput{
		OrgID: c.Param("id"), UploaderID: uid,
		Type: req.Type, Title: req.Title, Href: req.Href,
		Thumbnail: req.Thumbnail, StorageKey: req.StorageKey, LevelID: req.LevelID,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, res)
}

func (h *ResourceHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	status := c.Query("status")
	list, total, err := h.svc.List(service.ListResourceInput{
		OrgID: c.Param("id"), Page: page, PageSize: size, Status: status,
	})
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

func (h *ResourceHandler) Get(c *gin.Context) {
	res, err := h.svc.Get(c.Param("resId"))
	if err != nil {
		Fail(c, http.StatusNotFound, err.Error())
		return
	}
	OK(c, res)
}

type reviewResourceReq struct {
	Status string `json:"status" binding:"required"` // approved|rejected
}

func (h *ResourceHandler) Review(c *gin.Context) {
	var req reviewResourceReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	res, err := h.svc.Review(c.Param("resId"), req.Status)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, res)
}

func (h *ResourceHandler) Publish(c *gin.Context) {
	res, err := h.svc.Publish(c.Param("resId"))
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, res)
}
