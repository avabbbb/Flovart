package service

import (
	"errors"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

var errRequireOrg = errors.New("组织不存在或未初始化")

// RbacService 鉴权服务：owner 快通道 + 递归 CTE 求 perms 并集
type RbacService struct {
	orgs *repository.OrgRepository
	rbac *repository.RbacRepository
}

func NewRbacService(orgs *repository.OrgRepository, rbac *repository.RbacRepository) *RbacService {
	return &RbacService{orgs: orgs, rbac: rbac}
}

// Satisfy 判断 user 在 org 是否拥有 perm
// 1. org.owner_id == user → 全权（builtin owner 角色），通过
// 2. 递归 CTE 求 user 在 org 的有效 perms 并集，perm ∈ 集合 → 通过
func (s *RbacService) Satisfy(orgID, userID, perm string) (bool, error) {
	org, err := s.orgs.FindByID(orgID)
	if err != nil || org == nil {
		return false, errRequireOrg
	}
	if org.OwnerID == userID {
		return true, nil
	}
	perms, err := s.rbac.UserPerms(orgID, userID)
	if err != nil {
		return false, err
	}
	return perms[perm], nil
}

// IsMember 判断 user 是否 org 任一部门成员（"组织成员即可"档权限用）
func (s *RbacService) IsMember(orgID, userID string) (bool, error) {
	if org, _ := s.orgs.FindByID(orgID); org != nil && org.OwnerID == userID {
		return true, nil
	}
	return s.rbac.UserInOrg(orgID, userID)
}

// EffectivePerms 返回 user 在 org 的有效权限集合（前端取权限点用 /me/permissions）
// owner → AllPermissions；否则走递归 CTE
func (s *RbacService) EffectivePerms(orgID, userID string) ([]string, error) {
	org, err := s.orgs.FindByID(orgID)
	if err != nil || org == nil {
		return nil, errRequireOrg
	}
	if org.OwnerID == userID {
		return model.AllPermissions, nil
	}
	perms, err := s.rbac.UserPerms(orgID, userID)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(perms))
	for _, p := range model.AllPermissions {
		if perms[p] {
			out = append(out, p)
		}
	}
	return out, nil
}