package repository

import (
	"errors"

	"gorm.io/gorm"
	"flovart/enterprise/model"
)

type RoleRepository struct {
	db *gorm.DB
}

func NewRoleRepository(db *gorm.DB) *RoleRepository {
	return &RoleRepository{db: db}
}

func (r *RoleRepository) Create(role *model.Role) error {
	return r.db.Create(role).Error
}

func (r *RoleRepository) FindByID(id string) (*model.Role, error) {
	var ro model.Role
	if err := r.db.Where("id = ?", id).First(&ro).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &ro, nil
}

func (r *RoleRepository) ListByOrg(orgID string) ([]model.Role, error) {
	var list []model.Role
	err := r.db.Where("org_id = ?", orgID).Order("is_builtin DESC, sort ASC, created_at ASC").Find(&list).Error
	return list, err
}

func (r *RoleRepository) FindByOrgName(orgID, name string) (*model.Role, error) {
	var ro model.Role
	if err := r.db.Where("org_id = ? AND name = ?", orgID, name).First(&ro).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &ro, nil
}

func (r *RoleRepository) Update(role *model.Role) error {
	return r.db.Save(role).Error
}

func (r *RoleRepository) Delete(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.Role{}).Error
}

// CountMembers 角色被部门成员引用次数（删除前检查）
// 用 Postgres uuid 数组包含操作
func (r *RoleRepository) CountMembers(roleID string) (int64, error) {
	var n int64
	err := r.db.Table("department_members").
		Where("? = ANY(roles)", roleID).
		Count(&n).Error
	return n, err
}