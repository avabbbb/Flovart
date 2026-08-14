package repository

import (
	"errors"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type SensitiveRepository struct {
	db *gorm.DB
}

func NewSensitiveRepository(db *gorm.DB) *SensitiveRepository {
	return &SensitiveRepository{db: db}
}

func (r *SensitiveRepository) Create(w *model.SensitiveWord) error {
	return r.db.Create(w).Error
}

func (r *SensitiveRepository) List(orgID string) ([]model.SensitiveWord, error) {
	var list []model.SensitiveWord
	err := r.db.Where("org_id = ?", orgID).Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *SensitiveRepository) ListAll(orgID string) ([]model.SensitiveWord, error) {
	return r.List(orgID)
}

// DeleteByOrg 按 org 归属删除（防跨组织删除）
func (r *SensitiveRepository) DeleteByOrg(orgID, id string) error {
	return r.db.Where("id = ? AND org_id = ?", id, orgID).Delete(&model.SensitiveWord{}).Error
}

func (r *SensitiveRepository) FindByWord(orgID, word string) (*model.SensitiveWord, error) {
	var w model.SensitiveWord
	err := r.db.Where("org_id = ? AND word = ?", orgID, word).First(&w).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &w, err
}
