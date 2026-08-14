package repository

import (
	"errors"

	"flovart/enterprise/model"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type DeptRepository struct {
	db *gorm.DB
}

func NewDeptRepository(db *gorm.DB) *DeptRepository {
	return &DeptRepository{db: db}
}

func (r *DeptRepository) Create(d *model.Department) error {
	return r.db.Create(d).Error
}

func (r *DeptRepository) FindByID(id string) (*model.Department, error) {
	var d model.Department
	if err := r.db.Where("id = ?", id).First(&d).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &d, nil
}

// FindByOrgSlug 同组织内 slug 唯一校验用
func (r *DeptRepository) FindByOrgSlug(orgID, slug string) (*model.Department, error) {
	var d model.Department
	if err := r.db.Where("org_id = ? AND slug = ?", orgID, slug).First(&d).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &d, nil
}

// ListByOrg 组织全部部门，平铺。建树在 service 层做（部门 < 数百时内存构树更快）
func (r *DeptRepository) ListByOrg(orgID string) ([]model.Department, error) {
	var list []model.Department
	err := r.db.Where("org_id = ?", orgID).Order("sort ASC, created_at ASC").Find(&list).Error
	return list, err
}

func (r *DeptRepository) Update(d *model.Department) error {
	return r.db.Save(d).Error
}

// HasChildren 判断是否有子部门（删除前用）
func (r *DeptRepository) HasChildren(id string) (bool, error) {
	var n int64
	err := r.db.Model(&model.Department{}).Where("parent_id = ?", id).Count(&n).Error
	return n > 0, err
}

func (r *DeptRepository) Delete(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.Department{}).Error
}

// ---- DepartmentMember ----

func (r *DeptRepository) ListMembers(deptID string) ([]model.DepartmentMember, error) {
	var list []model.DepartmentMember
	err := r.db.Preload("User").Where("dept_id = ?", deptID).Order("created_at ASC").Find(&list).Error
	return list, err
}

func (r *DeptRepository) FindMember(deptID, userID string) (*model.DepartmentMember, error) {
	var m model.DepartmentMember
	if err := r.db.Where("dept_id = ? AND user_id = ?", deptID, userID).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

func (r *DeptRepository) AddMember(m *model.DepartmentMember) error {
	return r.db.Create(m).Error
}

func (r *DeptRepository) UpdateMember(m *model.DepartmentMember) error {
	return r.db.Save(m).Error
}

func (r *DeptRepository) UpdateOrgMemberStatus(orgID, userID, status string) error {
	tx := r.db.Model(&model.DepartmentMember{}).
		Where("user_id = ? AND dept_id IN (SELECT id FROM departments WHERE org_id = ?)", userID, orgID).
		Update("status", status)
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("成员不在该组织")
	}
	return nil
}

func (r *DeptRepository) RemoveMember(deptID, userID string) error {
	tx := r.db.Where("dept_id = ? AND user_id = ?", deptID, userID).Delete(&model.DepartmentMember{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("成员不在该部门")
	}
	return nil
}

// RemoveUserFromOrg 该用户在该组织所有部门的成员记录一并删除（移出组织用）
func (r *DeptRepository) RemoveUserFromOrg(orgID, userID string) error {
	return r.db.Where("user_id = ? AND dept_id IN (SELECT id FROM departments WHERE org_id = ?)", userID, orgID).
		Delete(&model.DepartmentMember{}).Error
}
func (r *DeptRepository) UserExists(userID string) (bool, error) {
	var n int64
	err := r.db.Model(&model.User{}).Where("id = ?", userID).Count(&n).Error
	return n > 0, err
}

func (r *DeptRepository) CountRolesByOrg(orgID string, roleIDs []string) (int64, error) {
	if len(roleIDs) == 0 {
		return 0, nil
	}
	var n int64
	err := r.db.Model(&model.Role{}).Where("org_id = ? AND id IN ?", orgID, roleIDs).Count(&n).Error
	return n, err
}

// UserHasAnyRole 判断 user 在该 org 是否持有 roleIDs 中任一角色（审批流 role 类型节点用）
func (r *DeptRepository) UserHasAnyRole(orgID, userID string, roleIDs []string) (bool, error) {
	if len(roleIDs) == 0 {
		return false, nil
	}
	var n int64
	err := r.db.Table("department_members dm").
		Joins("JOIN departments d ON d.id = dm.dept_id AND d.org_id = ?", orgID).
		Where("dm.user_id = ? AND dm.roles && ?", userID, pq.Array(roleIDs)).
		Count(&n).Error
	return n > 0, err
}

// UserLeadsAnyDept 判断 user 是否为该 org 中 deptIDs 任一部门的负责人（审批流 dept_lead 类型节点用）
func (r *DeptRepository) UserLeadsAnyDept(orgID, userID string, deptIDs []string) (bool, error) {
	if len(deptIDs) == 0 {
		return false, nil
	}
	var n int64
	err := r.db.Table("department_members dm").
		Joins("JOIN departments d ON d.id = dm.dept_id AND d.org_id = ?", orgID).
		Where("dm.user_id = ? AND dm.dept_id IN ? AND dm.is_lead = true", userID, deptIDs).
		Count(&n).Error
	return n > 0, err
}
