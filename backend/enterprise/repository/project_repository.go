package repository

import (
	"errors"

	"flovart/enterprise/model"
	"gorm.io/gorm"
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

// UpsertScoped 同 org 内 upsert：已存在行若属于其它组织则拒绝，防止用 body 里的 ID 覆写他组织数据
func (r *ProjectRepository) UpsertScoped(p *model.Project) error {
	existing, _ := r.FindByID(p.ID)
	if existing != nil {
		if existing.OrgID != p.OrgID {
			return errors.New("项目不属于当前组织")
		}
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

// DeleteByOrg 按 org 归属删除（防跨组织删除）
func (r *ProjectRepository) DeleteByOrg(orgID, id string) error {
	return r.db.Where("id = ? AND org_id = ?", id, orgID).Delete(&model.Project{}).Error
}
