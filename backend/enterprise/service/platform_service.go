package service

import (
	"errors"
	"regexp"
	"strings"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"golang.org/x/crypto/bcrypt"
)

var (
	platformUsernamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{3,32}$`)
	platformEmailPattern    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
)

type PlatformService struct {
	users *repository.UserRepository
	orgs  *repository.OrgRepository
}

func NewPlatformService(users *repository.UserRepository, orgs *repository.OrgRepository) *PlatformService {
	return &PlatformService{users: users, orgs: orgs}
}

type CreatePlatformUserInput struct {
	Username string
	Email    string
	Password string
	Role     string
}

func (s *PlatformService) CreateUser(in CreatePlatformUserInput) (*model.User, error) {
	in.Username = strings.TrimSpace(in.Username)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	if !platformUsernamePattern.MatchString(in.Username) || !platformEmailPattern.MatchString(in.Email) {
		return nil, errors.New("用户名或邮箱格式不正确")
	}
	if len(in.Password) < 8 {
		return nil, errors.New("密码至少 8 位")
	}
	if in.Role != "admin" {
		in.Role = "user"
	}
	if user, _ := s.users.FindByUsername(in.Username); user != nil {
		return nil, errors.New("用户名已存在")
	}
	if user, _ := s.users.FindByEmail(in.Email); user != nil {
		return nil, errors.New("邮箱已存在")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}
	user := &model.User{Username: in.Username, Email: in.Email, Password: string(hash), Role: in.Role, Status: "active", TokenVersion: 1}
	if err := s.users.Create(user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *PlatformService) ListUsers(search string, page, pageSize int) ([]model.User, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	return s.users.List(search, page, pageSize)
}

type UpdatePlatformUserInput struct {
	RequesterID string
	UserID      string
	Username    string
	Email       string
	Role        string
	Status      string
}

func (s *PlatformService) UpdateUser(in UpdatePlatformUserInput) (*model.User, error) {
	user, err := s.users.FindByID(in.UserID)
	if err != nil || user == nil {
		return nil, errors.New("用户不存在")
	}
	if value := strings.TrimSpace(in.Username); value != "" {
		if !platformUsernamePattern.MatchString(value) {
			return nil, errors.New("用户名格式不正确")
		}
		user.Username = value
	}
	if value := strings.ToLower(strings.TrimSpace(in.Email)); value != "" {
		if !platformEmailPattern.MatchString(value) {
			return nil, errors.New("邮箱格式不正确")
		}
		user.Email = value
	}
	if in.Role == "admin" || in.Role == "user" {
		if in.RequesterID == in.UserID && in.Role != "admin" {
			return nil, errors.New("不可移除自己的平台管理员权限")
		}
		if in.Role != user.Role {
			user.TokenVersion++
		}
		user.Role = in.Role
	}
	if in.Status != "" {
		status, ok := NormalizeAccountStatus(in.Status)
		if !ok {
			return nil, errors.New("账号状态无效")
		}
		if in.RequesterID == in.UserID && status != "active" {
			return nil, errors.New("不可停用自己的账号")
		}
		if status != user.Status {
			user.TokenVersion++
		}
		user.Status = status
	}
	if err := s.users.Update(user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *PlatformService) DeleteUser(requesterID, userID string) error {
	_, err := s.UpdateUser(UpdatePlatformUserInput{RequesterID: requesterID, UserID: userID, Status: "deleted"})
	return err
}

func (s *PlatformService) ListOrganizations(page, pageSize int) ([]model.Organization, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	return s.orgs.List(page, pageSize)
}

func (s *PlatformService) UpdateOrganizationStatus(orgID, status string) error {
	status = strings.ToLower(strings.TrimSpace(status))
	if status != "active" && status != "suspended" {
		return errors.New("组织状态无效")
	}
	return s.orgs.UpdateStatus(orgID, status)
}

func normalizePage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	return page, pageSize
}
