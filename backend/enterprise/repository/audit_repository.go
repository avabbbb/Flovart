package repository

import (
	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type AuditRepository struct{ db *gorm.DB }

func NewAuditRepository(db *gorm.DB) *AuditRepository { return &AuditRepository{db: db} }

func (r *AuditRepository) Create(entry *model.AuditLog) error { return r.db.Create(entry).Error }

func (r *AuditRepository) List(orgID string, page, pageSize int) ([]model.AuditLog, int64, error) {
	query := r.db.Model(&model.AuditLog{})
	if orgID != "" {
		query = query.Where("org_id = ?", orgID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []model.AuditLog
	err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}
