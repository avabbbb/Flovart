package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"flovart/enterprise/middleware"
	"flovart/enterprise/service"
)

type ApprovalHandler struct {
	svc *service.ApprovalService
}

func NewApprovalHandler(svc *service.ApprovalService) *ApprovalHandler {
	return &ApprovalHandler{svc: svc}
}

type nodeReq struct {
	NodeType     string   `json:"nodeType"`
	ApproverType string   `json:"approverType"`
	ApproverIDs  []string `json:"approverIds"`
}

type createWorkflowReq struct {
	Name       string    `json:"name" binding:"required"`
	TargetType string    `json:"targetType" binding:"required"`
	Nodes      []nodeReq `json:"nodes" binding:"required"`
}

func (h *ApprovalHandler) Create(c *gin.Context) {
	var req createWorkflowReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	nodes := make([]service.NodeInput, len(req.Nodes))
	for i, n := range req.Nodes {
		nodes[i] = service.NodeInput{
			NodeType: n.NodeType, ApproverType: n.ApproverType, ApproverIDs: n.ApproverIDs,
		}
	}
	w, err := h.svc.CreateWorkflow(service.CreateWorkflowInput{
		OrgID: c.Param("id"), Name: req.Name, TargetType: req.TargetType, Nodes: nodes,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, w)
}

func (h *ApprovalHandler) List(c *gin.Context) {
	list, err := h.svc.ListWorkflows(c.Param("id"))
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, list)
}

func (h *ApprovalHandler) Get(c *gin.Context) {
	w, nodes, err := h.svc.GetWorkflow(c.Param("wfId"))
	if err != nil {
		Fail(c, http.StatusNotFound, err.Error())
		return
	}
	OK(c, gin.H{"workflow": w, "nodes": nodes})
}

func (h *ApprovalHandler) Delete(c *gin.Context) {
	if err := h.svc.DeleteWorkflow(c.Param("wfId")); err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, gin.H{"deleted": c.Param("wfId")})
}

type submitApprovalReq struct {
	TargetType string `json:"targetType" binding:"required"`
	TargetID   string `json:"targetId" binding:"required"`
}

func (h *ApprovalHandler) Submit(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req submitApprovalReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	rec, err := h.svc.Submit(service.SubmitApprovalInput{
		OrgID: c.Param("id"), TargetType: req.TargetType,
		TargetID: req.TargetID, InitiatorID: uid,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, rec)
}

func (h *ApprovalHandler) ListRecords(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
	list, total, err := h.svc.ListRecords(c.Param("id"), page, size)
	if err != nil {
		Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	OK(c, gin.H{"list": list, "total": total})
}

func (h *ApprovalHandler) GetRecord(c *gin.Context) {
	rec, steps, err := h.svc.GetRecord(c.Param("recId"))
	if err != nil {
		Fail(c, http.StatusNotFound, err.Error())
		return
	}
	OK(c, gin.H{"record": rec, "steps": steps})
}

type actApprovalReq struct {
	Action string `json:"action" binding:"required"` // approve|reject
	Note   string `json:"note"`
}

func (h *ApprovalHandler) Act(c *gin.Context) {
	uid := c.GetString(middleware.ContextUserID)
	var req actApprovalReq
	if err := c.ShouldBindJSON(&req); err != nil {
		Fail(c, http.StatusBadRequest, "入参格式错误")
		return
	}
	rec, err := h.svc.Act(service.ActApprovalInput{
		RecordID: c.Param("recId"), ApproverID: uid, Action: req.Action, Note: req.Note,
	})
	if err != nil {
		Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	OK(c, rec)
}
