package repository

import (
	"errors"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type ApprovalRepository struct {
	db *gorm.DB
}

func NewApprovalRepository(db *gorm.DB) *ApprovalRepository {
	return &ApprovalRepository{db: db}
}

// --- Workflow ---

func (r *ApprovalRepository) CreateWorkflow(w *model.ApprovalWorkflow) error {
	return r.db.Create(w).Error
}

// FindWorkflowByIDAndOrg 按 org 归属查找审批流（防跨组织读取）
func (r *ApprovalRepository) FindWorkflowByIDAndOrg(orgID, id string) (*model.ApprovalWorkflow, error) {
	var w model.ApprovalWorkflow
	err := r.db.Where("id = ? AND org_id = ?", id, orgID).First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &w, err
}

func (r *ApprovalRepository) FindWorkflowByTarget(orgID, targetType string) (*model.ApprovalWorkflow, error) {
	var w model.ApprovalWorkflow
	err := r.db.Where("org_id = ? AND target_type = ? AND enabled = true", orgID, targetType).First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &w, err
}

func (r *ApprovalRepository) ListWorkflows(orgID string) ([]model.ApprovalWorkflow, error) {
	var list []model.ApprovalWorkflow
	err := r.db.Where("org_id = ?", orgID).Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *ApprovalRepository) UpdateWorkflow(w *model.ApprovalWorkflow) error {
	return r.db.Save(w).Error
}

// DeleteWorkflowByOrg 按 org 归属删除审批流（防跨组织删除）
func (r *ApprovalRepository) DeleteWorkflowByOrg(orgID, id string) error {
	return r.db.Where("id = ? AND org_id = ?", id, orgID).Delete(&model.ApprovalWorkflow{}).Error
}

// --- Node ---

func (r *ApprovalRepository) CreateNode(n *model.ApprovalNode) error {
	return r.db.Create(n).Error
}

func (r *ApprovalRepository) ListNodes(workflowID string) ([]model.ApprovalNode, error) {
	var list []model.ApprovalNode
	err := r.db.Where("workflow_id = ?", workflowID).Order("node_index ASC").Find(&list).Error
	return list, err
}

func (r *ApprovalRepository) DeleteNodesByWorkflow(workflowID string) error {
	return r.db.Where("workflow_id = ?", workflowID).Delete(&model.ApprovalNode{}).Error
}

// --- Record ---

func (r *ApprovalRepository) CreateRecord(rec *model.ApprovalRecord) error {
	return r.db.Create(rec).Error
}

// FindRecordByOrg 按 org 归属查找审批实例（防跨组织读取/操作）
func (r *ApprovalRepository) FindRecordByOrg(orgID, id string) (*model.ApprovalRecord, error) {
	var rec model.ApprovalRecord
	err := r.db.Where("id = ? AND org_id = ?", id, orgID).First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &rec, err
}

func (r *ApprovalRepository) ListRecords(orgID string, page, size int) ([]model.ApprovalRecord, int64, error) {
	var list []model.ApprovalRecord
	var total int64
	q := r.db.Model(&model.ApprovalRecord{}).Where("org_id = ?", orgID)
	q.Count(&total)
	err := q.Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error
	return list, total, err
}

func (r *ApprovalRepository) UpdateRecord(rec *model.ApprovalRecord) error {
	return r.db.Save(rec).Error
}

// --- Step ---

func (r *ApprovalRepository) CreateStep(s *model.ApprovalStep) error {
	return r.db.Create(s).Error
}

func (r *ApprovalRepository) ListSteps(recordID string) ([]model.ApprovalStep, error) {
	var list []model.ApprovalStep
	err := r.db.Where("record_id = ?", recordID).Order("node_index ASC, acted_at ASC").Find(&list).Error
	return list, err
}
