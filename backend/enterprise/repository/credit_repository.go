package repository

import (
	"errors"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type CreditRepository struct {
	db *gorm.DB
}

func NewCreditRepository(db *gorm.DB) *CreditRepository {
	return &CreditRepository{db: db}
}

func (r *CreditRepository) GetOrCreateCredit(orgID string) (*model.OrgCredit, error) {
	var credit model.OrgCredit
	err := r.db.Where("org_id = ?", orgID).First(&credit).Error
	if err == nil {
		return &credit, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	credit = model.OrgCredit{OrgID: orgID, Balance: 0}
	if err := r.db.Create(&credit).Error; err != nil {
		return nil, err
	}
	return &credit, nil
}

func (r *CreditRepository) AddTransaction(tx *gorm.DB, t *model.CreditTransaction) error {
	return tx.Create(t).Error
}

func (r *CreditRepository) ListTransactions(orgID string, page, size int) ([]model.CreditTransaction, int64, error) {
	var list []model.CreditTransaction
	var total int64
	q := r.db.Model(&model.CreditTransaction{}).Where("org_id = ?", orgID)
	q.Count(&total)
	err := q.Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error
	return list, total, err
}

func (r *CreditRepository) CreateRecharge(req *model.RechargeRequest) error {
	return r.db.Create(req).Error
}

func (r *CreditRepository) GetRecharge(id string) (*model.RechargeRequest, error) {
	var req model.RechargeRequest
	err := r.db.Where("id = ?", id).First(&req).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &req, err
}

func (r *CreditRepository) ListRecharges(orgID string, page, size int) ([]model.RechargeRequest, int64, error) {
	var list []model.RechargeRequest
	var total int64
	q := r.db.Model(&model.RechargeRequest{}).Where("org_id = ?", orgID)
	q.Count(&total)
	err := q.Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error
	return list, total, err
}

func (r *CreditRepository) ListUsage(orgID string, page, size int) ([]model.UsageRecord, int64, error) {
	var list []model.UsageRecord
	var total int64
	q := r.db.Model(&model.UsageRecord{}).Where("org_id = ?", orgID)
	q.Count(&total)
	err := q.Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error
	return list, total, err
}

func (r *CreditRepository) CreateUsage(u *model.UsageRecord) error {
	return r.db.Create(u).Error
}

func (r *CreditRepository) GetUsage(id string) (*model.UsageRecord, error) {
	var u model.UsageRecord
	err := r.db.Where("id = ?", id).First(&u).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &u, err
}
