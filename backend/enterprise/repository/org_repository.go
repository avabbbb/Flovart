package repository

import (
	"errors"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type OrgRepository struct {
	db *gorm.DB
}

func NewOrgRepository(db *gorm.DB) *OrgRepository {
	return &OrgRepository{db: db}
}

func (r *OrgRepository) Create(org *model.Organization) error {
	return r.db.Create(org).Error
}

func (r *OrgRepository) FindByID(id string) (*model.Organization, error) {
	var o model.Organization
	if err := r.db.Where("id = ?", id).First(&o).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func (r *OrgRepository) FindBySlug(slug string) (*model.Organization, error) {
	var o model.Organization
	if err := r.db.Where("slug = ?", slug).First(&o).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

// ListByUser 通过 department_members 反查用户所在组织
func (r *OrgRepository) ListByUser(userID string) ([]model.Organization, error) {
	var list []model.Organization
	err := r.db.Joins("JOIN departments ON departments.org_id = organizations.id").
		Joins("JOIN department_members ON department_members.dept_id = departments.id").
		Where("department_members.user_id = ? AND department_members.status = ? AND organizations.status = ?", userID, "active", "active").
		Group("organizations.id").
		Order("organizations.created_at DESC").
		Find(&list).Error
	return list, err
}

func (r *OrgRepository) List(page, pageSize int) ([]model.Organization, int64, error) {
	query := r.db.Model(&model.Organization{})
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []model.Organization
	err := query.Preload("Owner").Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

func (r *OrgRepository) UpdateStatus(id, status string) error {
	tx := r.db.Model(&model.Organization{}).Where("id = ?", id).Update("status", status)
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("组织不存在")
	}
	return nil
}

func (r *OrgRepository) Delete(id, ownerID string) error {
	tx := r.db.Where("id = ? AND owner_id = ?", id, ownerID).Delete(&model.Organization{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("not found or not owner")
	}
	return nil
}
