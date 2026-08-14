package service

import (
	"errors"
	"fmt"
	"time"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CreditService struct {
	db      *gorm.DB
	credits *repository.CreditRepository
}

func NewCreditService(db *gorm.DB, credits *repository.CreditRepository) *CreditService {
	return &CreditService{db: db, credits: credits}
}

// GetBalance 获取组织积分余额，不存在则自动创建 0 余额记录
func (s *CreditService) GetBalance(orgID string) (*model.OrgCredit, error) {
	return s.credits.GetOrCreateCredit(orgID)
}

type ListTxInput struct {
	OrgID    string
	Page     int
	PageSize int
}

func (s *CreditService) ListTransactions(in ListTxInput) ([]model.CreditTransaction, int64, error) {
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize < 1 || in.PageSize > 100 {
		in.PageSize = 20
	}
	return s.credits.ListTransactions(in.OrgID, in.Page, in.PageSize)
}

type CreateRechargeInput struct {
	OrgID       string
	RequestedBy string
	Amount      int64
	PriceCents  int64
	Note        string
}

func (s *CreditService) CreateRecharge(in CreateRechargeInput) (*model.RechargeRequest, error) {
	if in.Amount <= 0 {
		return nil, errors.New("充值金额必须大于 0")
	}
	req := &model.RechargeRequest{
		OrgID:       in.OrgID,
		RequestedBy: in.RequestedBy,
		Amount:      in.Amount,
		PriceCents:  in.PriceCents,
		Note:        in.Note,
		Status:      model.RechargeStatusPending,
	}
	if err := s.credits.CreateRecharge(req); err != nil {
		return nil, err
	}
	return req, nil
}

type ReviewRechargeInput struct {
	OrgID      string
	RechargeID string
	ReviewedBy string
	Approve    bool
	ReviewNote string
}

// ReviewRecharge 平台 admin 审批充值申请。approve=true 时在事务内入账 + 写流水。
// 行锁（FOR UPDATE）防止并发双审批重复入账。
func (s *CreditService) ReviewRecharge(in ReviewRechargeInput) (*model.RechargeRequest, error) {
	var result *model.RechargeRequest
	err := s.db.Transaction(func(tx *gorm.DB) error {
		var req model.RechargeRequest
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND org_id = ?", in.RechargeID, in.OrgID).First(&req).Error; err != nil {
			return errors.New("充值申请不存在")
		}
		if req.Status != model.RechargeStatusPending {
			return fmt.Errorf("申请状态为 %s，无法审批", req.Status)
		}

		status := model.RechargeStatusRejected
		if in.Approve {
			status = model.RechargeStatusApproved
		}
		req.Status = status
		req.ReviewedBy = in.ReviewedBy
		req.ReviewNote = in.ReviewNote
		now := time.Now().UTC()
		req.ReviewedAt = &now

		if !in.Approve {
			return tx.Save(&req).Error
		}

		// 审批通过：锁定组织余额行后入账 + 写流水，防止并发余额丢失更新
		var credit model.OrgCredit
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("org_id = ?", req.OrgID).First(&credit).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				credit = model.OrgCredit{OrgID: req.OrgID, Balance: 0}
				if err := tx.Create(&credit).Error; err != nil {
					return err
				}
			} else {
				return err
			}
		}
		credit.Balance += req.Amount
		credit.TotalIn += req.Amount
		if err := tx.Save(&credit).Error; err != nil {
			return err
		}
		txRecord := &model.CreditTransaction{
			OrgID:        req.OrgID,
			Kind:         model.TxKindRecharge,
			Amount:       req.Amount,
			BalanceAfter: credit.Balance,
			RefRequestID: req.ID,
			Reason:       "充值审批通过",
		}
		if err := tx.Create(txRecord).Error; err != nil {
			return err
		}
		if err := tx.Save(&req).Error; err != nil {
			return err
		}
		result = &req
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *CreditService) CancelRecharge(orgID, rechargeID, userID string) (*model.RechargeRequest, error) {
	req, err := s.credits.GetRecharge(rechargeID)
	if err != nil || req == nil {
		return nil, errors.New("充值申请不存在")
	}
	if req.OrgID != orgID {
		return nil, errors.New("充值申请不存在")
	}
	if req.Status != model.RechargeStatusPending {
		return nil, fmt.Errorf("申请状态为 %s，无法撤销", req.Status)
	}
	if req.RequestedBy != userID {
		return nil, errors.New("只能撤销自己提交的申请")
	}
	req.Status = model.RechargeStatusCancelled
	err = s.db.Save(req).Error
	return req, err
}

type ListRechargesInput struct {
	OrgID    string
	Page     int
	PageSize int
}

func (s *CreditService) ListRecharges(in ListRechargesInput) ([]model.RechargeRequest, int64, error) {
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize < 1 || in.PageSize > 100 {
		in.PageSize = 20
	}
	return s.credits.ListRecharges(in.OrgID, in.Page, in.PageSize)
}

type ListUsageInput struct {
	OrgID    string
	Page     int
	PageSize int
}

func (s *CreditService) ListUsage(in ListUsageInput) ([]model.UsageRecord, int64, error) {
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize < 1 || in.PageSize > 100 {
		in.PageSize = 20
	}
	return s.credits.ListUsage(in.OrgID, in.Page, in.PageSize)
}

// ConsumeCredits 代理端点调用成功后扣除积分。在事务内完成：
// 1. 检查余额是否足够
// 2. 扣减 OrgCredit.Balance
// 3. 写 CreditTransaction（consume）
// 4. 写 UsageRecord
// 5. 累加 MemberQuota.UsedThisMonth
func (s *CreditService) ConsumeCredits(orgID, userID string, usage *model.UsageRecord) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var credit model.OrgCredit
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("org_id = ?", orgID).First(&credit).Error; err != nil {
			return err
		}
		if credit.Balance < usage.CostCredits {
			return errors.New("积分余额不足")
		}
		credit.Balance -= usage.CostCredits
		credit.TotalOut += usage.CostCredits
		if err := tx.Save(&credit).Error; err != nil {
			return err
		}
		if err := tx.Create(usage).Error; err != nil {
			return err
		}
		txRecord := &model.CreditTransaction{
			OrgID:        orgID,
			UserID:       userID,
			Kind:         model.TxKindConsume,
			Amount:       -usage.CostCredits,
			BalanceAfter: credit.Balance,
			RefUsageID:   usage.ID,
		}
		if err := tx.Create(txRecord).Error; err != nil {
			return err
		}
		// quota 累加
		var quota model.MemberQuota
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("org_id = ? AND user_id = ?", orgID, userID).First(&quota).Error; err == nil {
			quota.UsedThisMonth += usage.CostCredits
			if err := tx.Save(&quota).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// RefundCredits 代理调用失败时退还积分
func (s *CreditService) RefundCredits(usageID string) error {
	var usage model.UsageRecord
	if err := s.db.Where("id = ?", usageID).First(&usage).Error; err != nil {
		return err
	}
	if usage.Status != model.UsageStatusSuccess {
		return errors.New("只有成功的记录才能退款")
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		var credit model.OrgCredit
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("org_id = ?", usage.OrgID).First(&credit).Error; err != nil {
			return err
		}
		credit.Balance += usage.CostCredits
		credit.TotalOut -= usage.CostCredits
		if err := tx.Save(&credit).Error; err != nil {
			return err
		}
		usage.Status = model.UsageStatusRefunded
		if err := tx.Save(&usage).Error; err != nil {
			return err
		}
		txRecord := &model.CreditTransaction{
			OrgID:        usage.OrgID,
			UserID:       usage.UserID,
			Kind:         model.TxKindRefund,
			Amount:       usage.CostCredits,
			BalanceAfter: credit.Balance,
			RefUsageID:   usage.ID,
			Reason:       "调用失败自动退款",
		}
		return tx.Create(txRecord).Error
	})
}
