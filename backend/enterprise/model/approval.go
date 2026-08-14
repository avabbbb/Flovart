package model

import (
	"time"

	"github.com/lib/pq"
)

// ApprovalWorkflow 审批流定义。绑定到特定业务场景（资源上架/密级变更等）。
type ApprovalWorkflow struct {
	ID         string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID      string    `gorm:"type:uuid;index;not null" json:"orgId"`
	Name       string    `gorm:"size:120;not null" json:"name"`
	TargetType string    `gorm:"size:32;not null" json:"targetType"` // resource_publish|resource_level
	Enabled    bool      `gorm:"default:true" json:"enabled"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// ApprovalNode 审批流中的节点。按 NodeIndex 顺序流转。
// NodeType: sequential（顺序，所有人审）/ parallel（并行，所有人审）/ any（任一人审即可）
// ApproverType: user（指定用户）/ role（指定角色所有人）/ dept_lead（部门负责人）
type ApprovalNode struct {
	ID           string         `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	WorkflowID   string         `gorm:"type:uuid;uniqueIndex:idx_node_wf_idx;index;not null" json:"workflowId"`
	NodeIndex    int            `gorm:"uniqueIndex:idx_node_wf_idx;not null" json:"nodeIndex"`
	NodeType     string         `gorm:"size:16;not null;default:'sequential'" json:"nodeType"`
	ApproverType string         `gorm:"size:16;not null;default:'user'" json:"approverType"`
	ApproverIDs  pq.StringArray `gorm:"type:uuid[]" json:"approverIds"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

// ApprovalRecord 审批实例。每次提交审批生成一条。
// Status: pending（流转中）/ approved（最终通过）/ rejected（被驳回）/ cancelled（发起者撤回）
type ApprovalRecord struct {
	ID               string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	OrgID            string    `gorm:"type:uuid;index;not null" json:"orgId"`
	WorkflowID       string    `gorm:"type:uuid;index;not null" json:"workflowId"`
	TargetType       string    `gorm:"size:32;not null" json:"targetType"`
	TargetID         string    `gorm:"type:uuid;index;not null" json:"targetId"`
	InitiatorID      string    `gorm:"type:uuid;not null" json:"initiatorId"`
	Status           string    `gorm:"size:16;index;not null;default:'pending'" json:"status"`
	CurrentNodeIndex int       `gorm:"not null;default:0" json:"currentNodeIndex"`
	CreatedAt        time.Time `gorm:"index" json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// ApprovalStep 审批记录中每个节点的实际审批动作。不可变。
type ApprovalStep struct {
	ID         string    `gorm:"primaryKey;type:uuid;default:gen_random_uuid()" json:"id"`
	RecordID   string    `gorm:"type:uuid;index;not null" json:"recordId"`
	NodeIndex  int       `gorm:"not null" json:"nodeIndex"`
	ApproverID string    `gorm:"type:uuid;not null" json:"approverId"`
	Action     string    `gorm:"size:16;not null" json:"action"` // approve|reject
	Note       string    `gorm:"size:500" json:"note,omitempty"`
	ActedAt    time.Time `gorm:"not null" json:"actedAt"`
}

const (
	ApprovalStatusPending   = "pending"
	ApprovalStatusApproved  = "approved"
	ApprovalStatusRejected  = "rejected"
	ApprovalStatusCancelled = "cancelled"
)

const (
	ApprovalNodeSequential = "sequential"
	ApprovalNodeParallel   = "parallel"
	ApprovalNodeAny        = "any"
)

const (
	ApproverTypeUser     = "user"
	ApproverTypeRole     = "role"
	ApproverTypeDeptLead = "dept_lead"
)

const (
	ApprovalActionApprove = "approve"
	ApprovalActionReject  = "reject"
)

const (
	ApprovalTargetResourcePublish = "resource_publish"
	ApprovalTargetResourceLevel   = "resource_level"
)
