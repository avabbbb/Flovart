package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"flovart/hub/middleware"
	"flovart/hub/model"
	"flovart/hub/service"
)

type PromptHandler struct {
	svc *service.PromptService
}

func NewPromptHandler(svc *service.PromptService) *PromptHandler {
	return &PromptHandler{svc: svc}
}

type createPackReq struct {
	Slug        string              `json:"slug"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Mode        string              `json:"mode"`
	Tags        []string            `json:"tags"`
	Items       []model.PromptItem  `json:"items"`
}

func (h *PromptHandler) Create(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	var req createPackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	pack, err := h.svc.Create(uid, service.CreateInput{
		Slug: req.Slug, Title: req.Title, Description: req.Description,
		Mode: req.Mode, Tags: req.Tags, Items: req.Items,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, pack)
}

func (h *PromptHandler) List(c *gin.Context) {
	q := model.Query{
		Keyword:  strings.TrimSpace(c.Query("keyword")),
		Mode:     c.Query("mode"),
		AuthorID: c.Query("authorId"),
		Sort:     c.Query("sort"),
		Page:     atoi(c.Query("page")),
		Size:     atoi(c.Query("size")),
	}
	if t := c.QueryArray("tags"); len(t) > 0 {
		q.Tags = t
	}
	result, err := h.svc.List(q)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, result)
}

func (h *PromptHandler) Get(c *gin.Context) {
	id := c.Param("id")
	pack, err := h.svc.Get(id)
	if err != nil || pack == nil {
		Fail(c, http.StatusNotFound, "未找到")
		return
	}
	OK(c, pack)
}

func (h *PromptHandler) GetBySlug(c *gin.Context) {
	slug := c.Param("slug")
	pack, err := h.svc.GetBySlug(slug)
	if err != nil || pack == nil {
		Fail(c, http.StatusNotFound, "未找到")
		return
	}
	OK(c, pack)
}

func (h *PromptHandler) Update(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	id := c.Param("id")
	var req createPackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	pack, err := h.svc.Update(uid, id, service.CreateInput{
		Slug: req.Slug, Title: req.Title, Description: req.Description,
		Mode: req.Mode, Tags: req.Tags, Items: req.Items,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, pack)
}

func (h *PromptHandler) Delete(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	id := c.Param("id")
	if err := h.svc.Delete(uid, id); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": id})
}

func (h *PromptHandler) Download(c *gin.Context) {
	id := c.Param("id")
	pack, err := h.svc.Get(id)
	if err != nil || pack == nil {
		Fail(c, http.StatusNotFound, "未找到")
		return
	}
	_ = h.svc.IncrementDownload(id)
	OK(c, pack)
}

func (h *PromptHandler) ToggleLike(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	packID := c.Param("id")
	liked, err := h.svc.ToggleLike(uid, packID)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"liked": liked})
}

func atoi(s string) int {
	if s == "" {
		return 0
	}
	n, _ := strconv.Atoi(s)
	return n
}