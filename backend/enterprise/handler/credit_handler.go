package handler

import (
	"net/http"
	"strconv"

	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
	"github.com/gin-gonic/gin"
)

type CreditHandler struct {
	svc *service.CreditService
}

func NewCreditHandler(svc *service.CreditService) *CreditHandler {
	return &CreditHandler{svc: svc}
}

func (h *CreditHandler) Balance(c *gin.Context) {
	credit, err := h.svc.GetBalance(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, credit)
}

func (h *CreditHandler) Transactions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.ListTransactions(service.ListTxInput{
		OrgID: c.Param("id"), Page: page, PageSize: size,
	})
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

type createRechargeReq struct {
	Amount     int64  `json:"amount" binding:"required"`
	PriceCents int64  `json:"priceCents"`
	Note       string `json:"note"`
}

func (h *CreditHandler) CreateRecharge(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req createRechargeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	r, err := h.svc.CreateRecharge(service.CreateRechargeInput{
		OrgID: c.Param("id"), RequestedBy: uid,
		Amount: req.Amount, PriceCents: req.PriceCents, Note: req.Note,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, r)
}

func (h *CreditHandler) ListRecharges(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.ListRecharges(service.ListRechargesInput{
		OrgID: c.Param("id"), Page: page, PageSize: size,
	})
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

func (h *CreditHandler) CancelRecharge(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	r, err := h.svc.CancelRecharge(c.Param("id"), c.Param("rechargeId"), uid)
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, r)
}

type reviewRechargeReq struct {
	Approve    bool   `json:"approve"`
	ReviewNote string `json:"reviewNote"`
}

func (h *CreditHandler) ReviewRecharge(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req reviewRechargeReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	r, err := h.svc.ReviewRecharge(service.ReviewRechargeInput{
		OrgID: c.Param("id"), RechargeID: c.Param("rechargeId"),
		ReviewedBy: uid,
		Approve:    req.Approve,
		ReviewNote: req.ReviewNote,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, r)
}

func (h *CreditHandler) ListUsage(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.ListUsage(service.ListUsageInput{
		OrgID: c.Param("id"), Page: page, PageSize: size,
	})
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}
