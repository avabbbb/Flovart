package repository

import (
	"errors"

	"gorm.io/gorm"
	"flovart/enterprise/model"
)

type ProjectRepository struct {
	db *gorm.DB
}

func NewProjectRepository(db *gorm.DB) *ProjectRepository {
	return &ProjectRepository{db: db}
}

func (r *ProjectRepository) Upsert(p *model.Project) error {
	existing, _ := r.FindByID(p.ID)
	if existing != nil {
		return r.db.Save(p).Error
	}
	return r.db.Create(p).Error
}

func (r *ProjectRepository) FindByID(id string) (*model.Project, error) {
	var p model.Project
	err := r.db.Where("id = ?", id).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

func (r *ProjectRepository) List(orgID string, page, size int) ([]model.Project, int64, error) {
	var list []model.Project
	var total int64
	q := r.db.Model(&model.Project{}).Where("org_id = ?", orgID)
	q.Count(&total)
	err := q.Order("updated_at DESC").Offset((page - 1) * size).Limit(size).Find(&list).Error
	return list, total, err
}

func (r *ProjectRepository) Delete(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.Project{}).Error
}
