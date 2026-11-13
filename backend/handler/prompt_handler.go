package handler

import (
	"log"
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
	Slug        string             `json:"slug"`
	Title       string             `json:"title"`
	Description string             `json:"description"`
	Mode        string             `json:"mode"`
	Tags        []string           `json:"tags"`
	Items       []model.PromptItem `json:"items"`
}

func (r createPackReq) input() service.CreateInput {
	return service.CreateInput{
		Slug: r.Slug, Title: r.Title, Description: r.Description,
		Mode: r.Mode, Tags: r.Tags, Items: r.Items,
	}
}

func (h *PromptHandler) Create(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	var req createPackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	pack, err := h.svc.Create(c.Request.Context(), uid, req.input())
	if err != nil {
		FailErr(c, err)
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
	result, err := h.svc.List(c.Request.Context(), q)
	if err != nil {
		FailErr(c, err)
		return
	}
	OK(c, result)
}

// respondPack 统一处理"按 id/slug 取单个包"的结果：查询失败为 500，不存在为 404
func respondPack(c *gin.Context, pack *model.PromptPack, err error) bool {
	if err != nil {
		FailErr(c, err)
		return false
	}
	if pack == nil {
		Fail(c, http.StatusNotFound, "未找到")
		return false
	}
	return true
}

func (h *PromptHandler) Get(c *gin.Context) {
	pack, err := h.svc.Get(c.Request.Context(), c.Param("id"))
	if respondPack(c, pack, err) {
		OK(c, pack)
	}
}

func (h *PromptHandler) GetBySlug(c *gin.Context) {
	pack, err := h.svc.GetBySlug(c.Request.Context(), c.Param("slug"))
	if respondPack(c, pack, err) {
		OK(c, pack)
	}
}

func (h *PromptHandler) Update(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	var req createPackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	pack, err := h.svc.Update(c.Request.Context(), uid, c.Param("id"), req.input())
	if err != nil {
		FailErr(c, err)
		return
	}
	OK(c, pack)
}

func (h *PromptHandler) Delete(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	id := c.Param("id")
	if err := h.svc.Delete(c.Request.Context(), uid, id); err != nil {
		FailErr(c, err)
		return
	}
	OK(c, gin.H{"deleted": id})
}

func (h *PromptHandler) Download(c *gin.Context) {
	id := c.Param("id")
	pack, err := h.svc.Get(c.Request.Context(), id)
	if !respondPack(c, pack, err) {
		return
	}
	if err := h.svc.IncrementDownload(c.Request.Context(), id); err != nil {
		// 计数失败不影响下载本身，但需要留痕
		log.Printf("increment download %s: %v", id, err)
	} else {
		pack.DownloadCount++
	}
	OK(c, pack)
}

func (h *PromptHandler) ToggleLike(c *gin.Context) {
	uid := c.GetString(string(middleware.ContextUserID))
	liked, err := h.svc.ToggleLike(c.Request.Context(), uid, c.Param("id"))
	if err != nil {
		FailErr(c, err)
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
