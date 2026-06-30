package service

import (
	"errors"
	"strings"
	"unicode"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type OrgService struct {
	orgs  *repository.OrgRepository
	users *repository.UserRepository
}

func NewOrgService(orgs *repository.OrgRepository, users *repository.UserRepository) *OrgService {
	return &OrgService{orgs: orgs, users: users}
}

type CreateOrgInput struct {
	Slug string
	Name string
}

func (s *OrgService) Create(ownerID string, in CreateOrgInput) (*model.Organization, error) {
	in.Slug = strings.TrimSpace(in.Slug)
	in.Name = strings.TrimSpace(in.Name)
	if in.Slug == "" || !validSlug(in.Slug) {
		return nil, errors.New("slug 只能含字母数字和短横线，3-80 位")
	}
	if in.Name == "" {
		return nil, errors.New("组织名称不能为空")
	}
	if existing, _ := s.orgs.FindBySlug(in.Slug); existing != nil {
		return nil, errors.New("slug 已存在")
	}
	org := &model.Organization{Slug: in.Slug, Name: in.Name, OwnerID: ownerID}
	if err := s.orgs.Create(org, ownerID); err != nil {
		return nil, err
	}
	return org, nil
}

func (s *OrgService) ListMyOrgs(userID string) ([]model.Organization, error) {
	return s.orgs.ListByUser(userID)
}

func (s *OrgService) Get(orgID string) (*model.Organization, error) {
	return s.orgs.FindByID(orgID)
}

func (s *OrgService) Delete(orgID, requesterID string) error {
	org, err := s.orgs.FindByID(orgID)
	if err != nil || org == nil {
		return errors.New("组织不存在")
	}
	if org.OwnerID != requesterID {
		return errors.New("仅 owner 可删除组织")
	}
	return s.orgs.Delete(orgID, requesterID)
}

func (s *OrgService) ListMembers(orgID string) ([]model.OrganizationMember, error) {
	return s.orgs.ListMembers(orgID)
}

func (s *OrgService) MemberRole(orgID, userID string) (string, error) {
	m, err := s.orgs.FindMember(orgID, userID)
	if err != nil {
		return "", err
	}
	if m == nil {
		return "", nil
	}
	return m.Role, nil
}

type AddMemberInput struct {
	OrgID      string
	ByUsername string
	Role       string
}

func (s *OrgService) AddMember(requesterID string, in AddMemberInput) (*model.OrganizationMember, error) {
	if !model.ValidRole(in.Role) {
		return nil, errors.New("角色非法")
	}
	if in.Role == model.RoleOwner {
		return nil, errors.New("不可直接添加 owner，请使用转让流程")
	}
	role, err := s.MemberRole(in.OrgID, requesterID)
	if err != nil {
		return nil, err
	}
	if !model.CanManage(role) {
		return nil, model.ErrNotManaged
	}
	target, err := s.users.FindByUsername(strings.TrimSpace(in.ByUsername))
	if err != nil || target == nil {
		return nil, errors.New("用户不存在，需先在 flovart 平台注册")
	}
	if existing, _ := s.orgs.FindMember(in.OrgID, target.ID); existing != nil {
		return nil, errors.New("该用户已是组织成员")
	}
	m := &model.OrganizationMember{
		OrgID:  in.OrgID,
		UserID: target.ID,
		Role:   in.Role,
	}
	if err := s.orgs.AddMember(m); err != nil {
		return nil, err
	}
	m.User = target
	return m, nil
}

func (s *OrgService) UpdateMemberRole(requesterID, orgID, targetUserID, newRole string) error {
	if !model.ValidRole(newRole) {
		return errors.New("角色非法")
	}
	if newRole == model.RoleOwner {
		return errors.New("不可直接提升为 owner，请使用转让流程")
	}
	role, err := s.MemberRole(orgID, requesterID)
	if err != nil {
		return err
	}
	if role != model.RoleOwner && role != model.RoleAdmin {
		return model.ErrNotManaged
	}
	// admin 不可调整其他 admin（只有 owner 能）
	if role == model.RoleAdmin {
		target, err := s.orgs.FindMember(orgID, targetUserID)
		if err != nil || target == nil {
			return errors.New("成员不存在")
		}
		if target.Role == model.RoleAdmin || target.Role == model.RoleOwner {
			return errors.New("admin 不可调整其他 admin/owner")
		}
	}
	return s.orgs.UpdateMemberRole(orgID, targetUserID, newRole)
}

func (s *OrgService) RemoveMember(requesterID, orgID, targetUserID string) error {
	if requesterID == targetUserID {
		return errors.New("不可移除自己，请使用退出或转让流程")
	}
	role, err := s.MemberRole(orgID, requesterID)
	if err != nil {
		return err
	}
	if !model.CanManage(role) {
		return model.ErrNotManaged
	}
	if role == model.RoleAdmin {
		target, err := s.orgs.FindMember(orgID, targetUserID)
		if err != nil || target == nil {
			return errors.New("成员不存在")
		}
		if target.Role == model.RoleAdmin || target.Role == model.RoleOwner {
			return errors.New("admin 不可移除其他 admin/owner")
		}
	}
	return s.orgs.RemoveMember(orgID, targetUserID)
}

func validSlug(s string) bool {
	if len(s) < 3 || len(s) > 80 {
		return false
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-') {
			return false
		}
	}
	return true
}