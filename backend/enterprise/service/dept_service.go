package service

import (
	"errors"
	"strings"
	"unicode"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type DeptService struct {
	depts *repository.DeptRepository
}

func NewDeptService(depts *repository.DeptRepository) *DeptService {
	return &DeptService{depts: depts}
}

// DeptNode 树节点（前端可直接渲染）
type DeptNode struct {
	model.Department
	Children []*DeptNode `json:"children"`
}

type CreateDeptInput struct {
	OrgID    string
	ParentID string // 可空
	Slug     string
	Name     string
	Sort     int
}

func (s *DeptService) Create(in CreateDeptInput) (*model.Department, error) {
	in.Slug = strings.TrimSpace(in.Slug)
	in.Name = strings.TrimSpace(in.Name)
	if in.Slug == "" || !validDeptSlug(in.Slug) {
		return nil, errors.New("slug 只能含字母数字和短横线，1-80 位")
	}
	if in.Name == "" {
		return nil, errors.New("部门名称不能为空")
	}
	if existing, _ := s.depts.FindByOrgSlug(in.OrgID, in.Slug); existing != nil {
		return nil, errors.New("slug 在该组织内已存在")
	}
	var parentID *string
	if in.ParentID != "" {
		p, err := s.depts.FindByID(in.ParentID)
		if err != nil || p == nil {
			return nil, errors.New("父部门不存在")
		}
		if p.OrgID != in.OrgID {
			return nil, errors.New("父部门必须属于同一组织")
		}
		pid := in.ParentID
		parentID = &pid
	}
	d := &model.Department{
		OrgID:    in.OrgID,
		ParentID: parentID,
		Slug:     in.Slug,
		Name:     in.Name,
		Sort:     in.Sort,
	}
	if err := s.depts.Create(d); err != nil {
		return nil, err
	}
	return d, nil
}

// Tree 组织部门树（从 ListByOrg 平铺构建，过滤 Hidden=true 根 _all）
func (s *DeptService) Tree(orgID string) ([]*DeptNode, error) {
	list, err := s.depts.ListByOrg(orgID)
	if err != nil {
		return nil, err
	}
	return buildDeptTree(list), nil
}

type UpdateDeptInput struct {
	Slug     *string
	Name     *string
	ParentID *string // 给值=移动；空字符串=变根；nil=不动
	Sort     *int
}

func (s *DeptService) Update(deptID string, in UpdateDeptInput) (*model.Department, error) {
	d, err := s.depts.FindByID(deptID)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, errors.New("部门不存在")
	}
	if in.Slug != nil {
		slug := strings.TrimSpace(*in.Slug)
		if !validDeptSlug(slug) {
			return nil, errors.New("slug 只能含字母数字和短横线，1-80 位")
		}
		if existing, _ := s.depts.FindByOrgSlug(d.OrgID, slug); existing != nil && existing.ID != deptID {
			return nil, errors.New("slug 已被其他部门占用")
		}
		d.Slug = slug
	}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return nil, errors.New("名称不能为空")
		}
		d.Name = name
	}
	if in.ParentID != nil {
		pid := strings.TrimSpace(*in.ParentID)
		if pid == "" {
			d.ParentID = nil
		} else {
			if pid == deptID {
				return nil, errors.New("不可将部门设为自己的父部门")
			}
			p, err := s.depts.FindByID(pid)
			if err != nil || p == nil {
				return nil, errors.New("父部门不存在")
			}
			if p.OrgID != d.OrgID {
				return nil, errors.New("父部门必须属于同一组织")
			}
			// 简单环形检查：向上递归看是否出现 deptID
			cur := p
			for cur != nil && cur.ParentID != nil {
				if cur.ID == deptID {
					return nil, errors.New("不可将部门移到自己的子孙部门下")
				}
				cur, _ = s.depts.FindByID(*cur.ParentID)
			}
			d.ParentID = &pid
		}
	}
	if in.Sort != nil {
		d.Sort = *in.Sort
	}
	if err := s.depts.Update(d); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *DeptService) Delete(deptID string) error {
	d, err := s.depts.FindByID(deptID)
	if err != nil {
		return err
	}
	if d == nil {
		return errors.New("部门不存在")
	}
	if d.Hidden {
		return errors.New("内置根部门不可删除")
	}
	has, err := s.depts.HasChildren(deptID)
	if err != nil {
		return err
	}
	if has {
		return errors.New("请先删除子部门")
	}
	return s.depts.Delete(deptID)
}

func (s *DeptService) ListMembers(deptID string) ([]model.DepartmentMember, error) {
	return s.depts.ListMembers(deptID)
}

type AddDeptMemberInput struct {
	DeptID  string
	UserID  string
	IsLead  bool
	RoleIDs []string
}

func (s *DeptService) AddMember(in AddDeptMemberInput) (*model.DepartmentMember, error) {
	if existing, _ := s.depts.FindMember(in.DeptID, in.UserID); existing != nil {
		return nil, errors.New("该用户已在此部门")
	}
	m := &model.DepartmentMember{
		DeptID: in.DeptID,
		UserID: in.UserID,
		IsLead: in.IsLead,
		Roles:  in.RoleIDs,
	}
	if err := s.depts.AddMember(m); err != nil {
		return nil, err
	}
	return m, nil
}

type UpdateMemberInput struct {
	IsLead  *bool
	RoleIDs []string
}

func (s *DeptService) UpdateMember(deptID, userID string, in UpdateMemberInput) (*model.DepartmentMember, error) {
	m, err := s.depts.FindMember(deptID, userID)
	if err != nil {
		return nil, err
	}
	if m == nil {
		return nil, errors.New("成员不在此部门")
	}
	if in.IsLead != nil {
		m.IsLead = *in.IsLead
	}
	if in.RoleIDs != nil {
		m.Roles = in.RoleIDs
	}
	if err := s.depts.UpdateMember(m); err != nil {
		return nil, err
	}
	return m, nil
}

func (s *DeptService) RemoveMember(deptID, userID string) error {
	return s.depts.RemoveMember(deptID, userID)
}

// buildDeptTree 从平铺列表构建树，过滤 Hidden 根 _all（前端不展示）
func buildDeptTree(list []model.Department) []*DeptNode {
	byID := make(map[string]*DeptNode, len(list))
	roots := make([]*DeptNode, 0)
	for i := range list {
		if list[i].Hidden {
			continue
		}
		n := &DeptNode{Department: list[i], Children: []*DeptNode{}}
		byID[list[i].ID] = n
	}
	for _, n := range byID {
		if n.ParentID == nil || *n.ParentID == "" {
			roots = append(roots, n)
			continue
		}
		if parent, ok := byID[*n.ParentID]; ok {
			parent.Children = append(parent.Children, n)
		} else {
			// parent Hidden 不在 byID → 兜底挂根
			roots = append(roots, n)
		}
	}
	return roots
}

func validDeptSlug(s string) bool {
	if len(s) < 1 || len(s) > 80 {
		return false
	}
	for _, r := range s {
		if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_') {
			return false
		}
	}
	return true
}