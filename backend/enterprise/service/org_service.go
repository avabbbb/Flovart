package service

import (
	"errors"
	"strings"
	"unicode"

	"github.com/lib/pq"
	"gorm.io/gorm"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type OrgService struct {
	db    *gorm.DB
	orgs  *repository.OrgRepository
	users *repository.UserRepository
	depts *repository.DeptRepository
	roles *repository.RoleRepository
}

func NewOrgService(db *gorm.DB, orgs *repository.OrgRepository, users *repository.UserRepository, depts *repository.DeptRepository, roles *repository.RoleRepository) *OrgService {
	return &OrgService{db: db, orgs: orgs, users: users, depts: depts, roles: roles}
}

type CreateOrgInput struct {
	Slug string
	Name string
}

// Create 创建组织：事务内同时 seed builtin roles + _all 根部门 + owner 加入根部门
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
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(org).Error; err != nil {
			return err
		}
		// seed builtin roles
		ownerRole := &model.Role{OrgID: org.ID, Name: "owner", IsBuiltin: true, Permissions: model.BuiltinOwnerPerms, Sort: 0}
		if err := tx.Create(ownerRole).Error; err != nil {
			return err
		}
		adminRole := &model.Role{OrgID: org.ID, Name: "admin", IsBuiltin: true, Permissions: model.BuiltinAdminPerms, Sort: 1}
		if err := tx.Create(adminRole).Error; err != nil {
			return err
		}
		// _all 根部门
		rootDept := &model.Department{OrgID: org.ID, Slug: "_all", Name: "全体成员", Hidden: true, Sort: 0}
		if err := tx.Create(rootDept).Error; err != nil {
			return err
		}
		// owner 加入根部门，绑定 owner 角色
		m := &model.DepartmentMember{DeptID: rootDept.ID, UserID: ownerID, Roles: pq.StringArray{ownerRole.ID}}
		return tx.Create(m).Error
	})
	if err != nil {
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

// ListMembers 跨部门汇总组织全部成员，按 userID 去重（保留首条记录）
func (s *OrgService) ListMembers(orgID string) ([]model.DepartmentMember, error) {
	var list []model.DepartmentMember
	err := s.db.Preload("User").
		Where("dept_id IN (SELECT id FROM departments WHERE org_id = ?)", orgID).
		Order("created_at ASC").
		Find(&list).Error
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var result []model.DepartmentMember
	for _, m := range list {
		if seen[m.UserID] {
			continue
		}
		seen[m.UserID] = true
		result = append(result, m)
	}
	return result, nil
}

type AddOrgMemberInput struct {
	OrgID      string
	ByUsername string
}

// AddMember 查用户后加入 _all 根部门，默认空角色（普通成员无特殊权限）
func (s *OrgService) AddMember(requesterID string, in AddOrgMemberInput) (*model.DepartmentMember, error) {
	target, err := s.users.FindByUsername(strings.TrimSpace(in.ByUsername))
	if err != nil || target == nil {
		return nil, errors.New("用户不存在，需先在 flovart 平台注册")
	}
	rootDept, err := s.depts.FindByOrgSlug(in.OrgID, "_all")
	if err != nil || rootDept == nil {
		return nil, errors.New("组织根部门不存在")
	}
	if existing, _ := s.depts.FindMember(rootDept.ID, target.ID); existing != nil {
		return nil, errors.New("该用户已是组织成员")
	}
	m := &model.DepartmentMember{
		DeptID: rootDept.ID,
		UserID: target.ID,
		Roles:  pq.StringArray{},
	}
	if err := s.depts.AddMember(m); err != nil {
		return nil, err
	}
	m.User = target
	return m, nil
}

// RemoveMember 将用户从组织所有部门移除
func (s *OrgService) RemoveMember(requesterID, orgID, targetUserID string) error {
	if requesterID == targetUserID {
		return errors.New("不可移除自己，请使用退出或转让流程")
	}
	return s.depts.RemoveUserFromOrg(orgID, targetUserID)
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
