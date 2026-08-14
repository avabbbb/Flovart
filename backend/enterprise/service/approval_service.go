package service

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"gorm.io/gorm"
)

type ApprovalService struct {
	db    *gorm.DB
	rep   *repository.ApprovalRepository
	depts *repository.DeptRepository
}

func NewApprovalService(db *gorm.DB, rep *repository.ApprovalRepository, depts *repository.DeptRepository) *ApprovalService {
	return &ApprovalService{db: db, rep: rep, depts: depts}
}

type CreateWorkflowInput struct {
	OrgID      string
	Name       string
	TargetType string
	Nodes      []NodeInput
}

type NodeInput struct {
	NodeType     string // sequential|parallel|any
	ApproverType string // user|role|dept_lead
	ApproverIDs  []string
}

func (s *ApprovalService) CreateWorkflow(in CreateWorkflowInput) (*model.ApprovalWorkflow, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return nil, errors.New("审批流名称不能为空")
	}
	if in.TargetType == "" {
		return nil, errors.New("targetType 不能为空")
	}
	if len(in.Nodes) == 0 {
		return nil, errors.New("至少需要一个审批节点")
	}
	w := &model.ApprovalWorkflow{
		OrgID:      in.OrgID,
		Name:       in.Name,
		TargetType: in.TargetType,
		Enabled:    true,
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(w).Error; err != nil {
			return err
		}
		for i, n := range in.Nodes {
			if n.NodeType == "" {
				n.NodeType = model.ApprovalNodeSequential
			}
			if n.NodeType != model.ApprovalNodeSequential && n.NodeType != model.ApprovalNodeParallel && n.NodeType != model.ApprovalNodeAny {
				return fmt.Errorf("节点 %d 的 nodeType 只能是 sequential/parallel/any", i+1)
			}
			if n.ApproverType == "" {
				n.ApproverType = model.ApproverTypeUser
			}
			if n.ApproverType != model.ApproverTypeUser && n.ApproverType != model.ApproverTypeRole && n.ApproverType != model.ApproverTypeDeptLead {
				return fmt.Errorf("节点 %d 的 approverType 只能是 user/role/dept_lead", i+1)
			}
			if len(n.ApproverIDs) == 0 {
				return fmt.Errorf("节点 %d 必须至少指定一个审批人", i+1)
			}
			node := &model.ApprovalNode{
				WorkflowID:   w.ID,
				NodeIndex:    i,
				NodeType:     n.NodeType,
				ApproverType: n.ApproverType,
				ApproverIDs:  n.ApproverIDs,
			}
			if err := tx.Create(node).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return w, nil
}

func (s *ApprovalService) ListWorkflows(orgID string) ([]model.ApprovalWorkflow, error) {
	return s.rep.ListWorkflows(orgID)
}

func (s *ApprovalService) GetWorkflow(orgID, id string) (*model.ApprovalWorkflow, []model.ApprovalNode, error) {
	w, err := s.rep.FindWorkflowByIDAndOrg(orgID, id)
	if err != nil || w == nil {
		return nil, nil, errors.New("审批流不存在")
	}
	nodes, err := s.rep.ListNodes(id)
	return w, nodes, err
}

func (s *ApprovalService) DeleteWorkflow(orgID, id string) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("workflow_id = ?", id).Delete(&model.ApprovalNode{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND org_id = ?", id, orgID).Delete(&model.ApprovalWorkflow{}).Error
	})
}

type SubmitApprovalInput struct {
	OrgID       string
	TargetType  string
	TargetID    string
	InitiatorID string
}

// Submit 提交审批：查找 org 下该 targetType 的 enabled workflow，创建 record
func (s *ApprovalService) Submit(in SubmitApprovalInput) (*model.ApprovalRecord, error) {
	w, err := s.rep.FindWorkflowByTarget(in.OrgID, in.TargetType)
	if err != nil || w == nil {
		return nil, fmt.Errorf("未找到 %s 类型的审批流", in.TargetType)
	}
	rec := &model.ApprovalRecord{
		OrgID:            in.OrgID,
		WorkflowID:       w.ID,
		TargetType:       in.TargetType,
		TargetID:         in.TargetID,
		InitiatorID:      in.InitiatorID,
		Status:           model.ApprovalStatusPending,
		CurrentNodeIndex: 0,
	}
	if err := s.rep.CreateRecord(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

type ActApprovalInput struct {
	OrgID      string
	RecordID   string
	ApproverID string
	Action     string // approve|reject
	Note       string
}

// canAct 判断 approverID 是否为当前节点的合法审批人。
// user: 必须在节点 ApproverIDs 中；role: 必须持有 ApproverIDs 中任一角色；
// dept_lead: 必须是 ApproverIDs 中任一部门的负责人。未知类型一律拒绝。
func (s *ApprovalService) canAct(orgID, approverID string, node *model.ApprovalNode) (bool, error) {
	switch node.ApproverType {
	case model.ApproverTypeUser:
		for _, id := range node.ApproverIDs {
			if id == approverID {
				return true, nil
			}
		}
		return false, nil
	case model.ApproverTypeRole:
		return s.depts.UserHasAnyRole(orgID, approverID, node.ApproverIDs)
	case model.ApproverTypeDeptLead:
		return s.depts.UserLeadsAnyDept(orgID, approverID, node.ApproverIDs)
	default:
		return false, nil
	}
}

// Act 审批操作。当前节点审批通过后自动流转到下一节点。
// sequential: 需要所有 approver 各自审批通过
// parallel: 需要所有 approver 各自审批通过
// any: 任一 approver 审批通过即可
// role/dept_lead 节点: 任一合法审批人（角色成员/部门负责人）审批通过即视为节点完成
// reject: 直接驳回整条审批
func (s *ApprovalService) Act(in ActApprovalInput) (*model.ApprovalRecord, error) {
	if in.Action != model.ApprovalActionApprove && in.Action != model.ApprovalActionReject {
		return nil, errors.New("action 只能是 approve 或 reject")
	}
	rec, err := s.rep.FindRecordByOrg(in.OrgID, in.RecordID)
	if err != nil || rec == nil {
		return nil, errors.New("审批记录不存在")
	}
	if rec.Status != model.ApprovalStatusPending {
		return nil, fmt.Errorf("审批状态为 %s，无法操作", rec.Status)
	}
	nodes, err := s.rep.ListNodes(rec.WorkflowID)
	if err != nil {
		return nil, err
	}
	if len(nodes) == 0 {
		return nil, errors.New("审批流没有节点")
	}
	if rec.CurrentNodeIndex < 0 || rec.CurrentNodeIndex >= len(nodes) {
		return nil, errors.New("当前节点不存在")
	}
	currentNode := &nodes[rec.CurrentNodeIndex]

	// 审批人授权校验：非当前节点审批人不得操作
	allowed, err := s.canAct(in.OrgID, in.ApproverID, currentNode)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, errors.New("您不是当前节点的审批人")
	}

	// 记录 step
	step := &model.ApprovalStep{
		RecordID:   rec.ID,
		NodeIndex:  rec.CurrentNodeIndex,
		ApproverID: in.ApproverID,
		Action:     in.Action,
		Note:       in.Note,
		ActedAt:    time.Now().UTC(),
	}

	if in.Action == model.ApprovalActionReject {
		rec.Status = model.ApprovalStatusRejected
		return rec, s.db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Create(step).Error; err != nil {
				return err
			}
			return tx.Save(rec).Error
		})
	}

	// approve: 检查当前节点是否满足条件
	existingSteps, err := s.rep.ListSteps(rec.ID)
	if err != nil {
		return nil, err
	}
	nodeComplete := s.isNodeComplete(currentNode, existingSteps, in.ApproverID)

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(step).Error; err != nil {
			return err
		}
		if nodeComplete {
			if rec.CurrentNodeIndex >= len(nodes)-1 {
				rec.Status = model.ApprovalStatusApproved
			} else {
				rec.CurrentNodeIndex++
			}
		}
		return tx.Save(rec).Error
	})
	if err != nil {
		return nil, err
	}
	return rec, nil
}

func (s *ApprovalService) isNodeComplete(node *model.ApprovalNode, existingSteps []model.ApprovalStep, newApproverID string) bool {
	// role/dept_lead：审批人授权已由 canAct 校验，任一合法审批人通过即视为节点完成
	if node.ApproverType != model.ApproverTypeUser {
		return true
	}
	// any: 任一人审即可
	if node.NodeType == model.ApprovalNodeAny {
		return true
	}
	// sequential / parallel: 需要所有 approverIDs 都已审批
	approved := make(map[string]bool)
	approved[newApproverID] = true
	for _, st := range existingSteps {
		if st.NodeIndex == node.NodeIndex && st.Action == model.ApprovalActionApprove {
			approved[st.ApproverID] = true
		}
	}
	for _, id := range node.ApproverIDs {
		if !approved[id] {
			return false
		}
	}
	return true
}

func (s *ApprovalService) ListRecords(orgID string, page, size int) ([]model.ApprovalRecord, int64, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	return s.rep.ListRecords(orgID, page, size)
}

func (s *ApprovalService) GetRecord(orgID, id string) (*model.ApprovalRecord, []model.ApprovalStep, error) {
	rec, err := s.rep.FindRecordByOrg(orgID, id)
	if err != nil || rec == nil {
		return nil, nil, errors.New("审批记录不存在")
	}
	steps, err := s.rep.ListSteps(id)
	return rec, steps, err
}
