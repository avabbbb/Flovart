package service

import (
	"errors"
	"strings"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type RoleService struct {
	roles *repository.RoleRepository
}

func NewRoleService(roles *repository.RoleRepository) *RoleService {
	return &RoleService{roles: roles}
}

// SeedBuiltin 创建组织时调用，预置 owner + admin 内置角色
func (s *RoleService) SeedBuiltin(orgID string) error {
	if existing, _ := s.roles.FindByOrgName(orgID, "owner"); existing != nil {
		return nil // 已 seed
	}
	owner := &model.Role{
		OrgID:       orgID,
		Name:        "owner",
		IsBuiltin:   true,
		Permissions: model.BuiltinOwnerPerms,
		Sort:        0,
	}
	if err := s.roles.Create(owner); err != nil {
		return err
	}
	admin := &model.Role{
		OrgID:       orgID,
		Name:        "admin",
		IsBuiltin:   true,
		Permissions: model.BuiltinAdminPerms,
		Sort:        1,
	}
	return s.roles.Create(admin)
}

type CreateRoleInput struct {
	OrgID       string
	Name        string
	Permissions []string
	Sort        int
}

func (s *RoleService) Create(in CreateRoleInput) (*model.Role, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, errors.New("角色名不能为空")
	}
	if existing, _ := s.roles.FindByOrgName(in.OrgID, name); existing != nil {
		return nil, errors.New("角色名在该组织已存在")
	}
	perms := model.NormalizePerms(in.Permissions)
	ro := &model.Role{
		OrgID:       in.OrgID,
		Name:        name,
		IsBuiltin:   false,
		Permissions: perms,
		Sort:        in.Sort,
	}
	if err := s.roles.Create(ro); err != nil {
		return nil, err
	}
	return ro, nil
}

func (s *RoleService) List(orgID string) ([]model.Role, error) {
	return s.roles.ListByOrg(orgID)
}

type UpdateRoleInput struct {
	Name        *string
	Permissions []string
	Sort        *int
}

func (s *RoleService) Update(roleID string, in UpdateRoleInput) (*model.Role, error) {
	ro, err := s.roles.FindByID(roleID)
	if err != nil {
		return nil, err
	}
	if ro == nil {
		return nil, errors.New("角色不存在")
	}
	if ro.IsBuiltin {
		return nil, errors.New("内置角色不可修改")
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return nil, errors.New("角色名不能为空")
		}
		if existing, _ := s.roles.FindByOrgName(ro.OrgID, name); existing != nil && existing.ID != roleID {
			return nil, errors.New("角色名已被占用")
		}
		ro.Name = name
	}
	if in.Permissions != nil {
		ro.Permissions = model.NormalizePerms(in.Permissions)
	}
	if in.Sort != nil {
		ro.Sort = *in.Sort
	}
	if err := s.roles.Update(ro); err != nil {
		return nil, err
	}
	return ro, nil
}

func (s *RoleService) Delete(roleID string) error {
	ro, err := s.roles.FindByID(roleID)
	if err != nil {
		return err
	}
	if ro == nil {
		return errors.New("角色不存在")
	}
	if ro.IsBuiltin {
		return errors.New("内置角色不可删除")
	}
	n, err := s.roles.CountMembers(roleID)
	if err != nil {
		return err
	}
	if n > 0 {
		return errors.New("角色仍被部门成员使用，无法删除")
	}
	return s.roles.Delete(roleID)
}