package repository

import (
	"errors"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type ResourceRepository struct {
	db *gorm.DB
}

func NewResourceRepository(db *gorm.DB) *ResourceRepository {
	return &ResourceRepository{db: db}
}

// --- ResourceLevel ---

func (r *ResourceRepository) CreateLevel(l *model.ResourceLevel) error {
	return r.db.Create(l).Error
}

func (r *ResourceRepository) ListLevels(orgID string) ([]model.ResourceLevel, error) {
	var list []model.ResourceLevel
	err := r.db.Where("org_id = ?", orgID).Order("sort ASC, created_at ASC").Find(&list).Error
	return list, err
}

// DeleteLevelByOrg 按 org 归属删除（防跨组织删除）
func (r *ResourceRepository) DeleteLevelByOrg(orgID, id string) error {
	return r.db.Where("id = ? AND org_id = ?", id, orgID).Delete(&model.ResourceLevel{}).Error
}

// --- Resource ---

func (r *ResourceRepository) Create(res *model.Resource) error {
	return r.db.Create(res).Error
}

// FindByIDAndOrg 按 org 归属查找（防跨组织读取/操作）
func (r *ResourceRepository) FindByIDAndOrg(orgID, id string) (*model.Resource, error) {
	var res model.Resource
	err := r.db.Preload("Level").Where("id = ? AND org_id = ?", id, orgID).First(&res).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &res, err
}

func (r *ResourceRepository) List(orgID string, page, size int, status string) ([]model.Resource, int64, error) {
	var list []model.Resource
	var total int64
	q := r.db.Model(&model.Resource{}).Where("org_id = ?", orgID)
	if status != "" {
		q = q.Where("status = ?", status)
	}
	q.Count(&total)
	err := q.Preload("Level").Order("created_at DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error
	return list, total, err
}

func (r *ResourceRepository) Update(res *model.Resource) error {
	return r.db.Save(res).Error
}

func (r *ResourceRepository) UpdateStatus(id, status string) error {
	return r.db.Model(&model.Resource{}).Where("id = ?", id).Update("status", status).Error
}
