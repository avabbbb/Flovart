package handler

import (
	"net/http"

	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
	"github.com/gin-gonic/gin"
)

type ApiKeyHandler struct {
	svc *service.ApiKeyService
}

func NewApiKeyHandler(svc *service.ApiKeyService) *ApiKeyHandler {
	return &ApiKeyHandler{svc: svc}
}

type createApiKeyReq struct {
	Label    string `json:"label" binding:"required"`
	Provider string `json:"provider" binding:"required"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey" binding:"required"`
}

func (h *ApiKeyHandler) Create(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req createApiKeyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	key, err := h.svc.Create(uid, service.CreateApiKeyInput{
		OrgID: c.Param("id"), Label: req.Label, Provider: req.Provider,
		BaseURL: req.BaseURL, APIKey: req.APIKey,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, key)
}

func (h *ApiKeyHandler) List(c *gin.Context) {
	list, err := h.svc.List(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

type toggleApiKeyReq struct {
	Enabled bool `json:"enabled"`
}

func (h *ApiKeyHandler) Toggle(c *gin.Context) {
	var req toggleApiKeyReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	key, err := h.svc.Toggle(c.Param("id"), c.Param("keyId"), req.Enabled)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, key)
}

func (h *ApiKeyHandler) Delete(c *gin.Context) {
	if err := h.svc.Delete(c.Param("id"), c.Param("keyId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("keyId")})
}

// --- ModelPricing ---

type createPricingReq struct {
	Provider    string `json:"provider" binding:"required"`
	Model       string `json:"model" binding:"required"`
	Mode        string `json:"mode" binding:"required"`
	CostCredits int64  `json:"costCredits"`
}

func (h *ApiKeyHandler) CreatePricing(c *gin.Context) {
	var req createPricingReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	p, err := h.svc.CreatePricing(service.CreatePricingInput{
		OrgID: c.Param("id"), Provider: req.Provider, Model: req.Model,
		Mode: req.Mode, CostCredits: req.CostCredits,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, p)
}

func (h *ApiKeyHandler) ListPricing(c *gin.Context) {
	list, err := h.svc.ListPricing(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

func (h *ApiKeyHandler) DeletePricing(c *gin.Context) {
	if err := h.svc.DeletePricing(c.Param("id"), c.Param("pricingId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("pricingId")})
}

// --- MemberQuota ---

func (h *ApiKeyHandler) ListQuotas(c *gin.Context) {
	list, err := h.svc.ListQuotas(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

type updateQuotaReq struct {
	UserID       string `json:"userId" binding:"required"`
	MonthlyLimit int64  `json:"monthlyLimit"`
}

func (h *ApiKeyHandler) UpdateQuota(c *gin.Context) {
	var req updateQuotaReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	q, err := h.svc.UpdateQuota(service.UpdateQuotaInput{
		OrgID: c.Param("id"), UserID: req.UserID, MonthlyLimit: req.MonthlyLimit,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, q)
}
