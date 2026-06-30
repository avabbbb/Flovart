package service

import (
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"flovart/hub/model"
	"flovart/hub/repository"
)

type AuthService struct {
	users      *repository.UserRepository
	jwtSecret  string
	jwtExpH    int
}

func NewAuthService(users *repository.UserRepository, jwtSecret string, jwtExpH int) *AuthService {
	if jwtExpH <= 0 {
		jwtExpH = 168
	}
	return &AuthService{users: users, jwtSecret: jwtSecret, jwtExpH: jwtExpH}
}

// Register 注册新用户
func (s *AuthService) Register(username, email, password string) (*model.User, string, error) {
	username = strings.TrimSpace(username)
	email = strings.ToLower(strings.TrimSpace(email))
	if !validUsername(username) {
		return nil, "", errors.New("用户名只能含字母数字下划线，3-32 位")
	}
	if !validEmail(email) {
		return nil, "", errors.New("邮箱格式不正确")
	}
	if len(password) < 6 {
		return nil, "", errors.New("密码至少 6 位")
	}
	if existing, _ := s.users.FindByUsername(username); existing != nil {
		return nil, "", errors.New("用户名已存在")
	}
	if existing, _ := s.users.FindByEmail(email); existing != nil {
		return nil, "", errors.New("邮箱已注册")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", err
	}
	user := &model.User{Username: username, Email: email, Password: string(hash), Role: "user"}
	if err := s.users.Create(user); err != nil {
		return nil, "", err
	}
	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", err
	}
	return user, token, nil
}

// Login 用户名/邮箱 + 密码登录
func (s *AuthService) Login(identifier, password string) (*model.User, string, error) {
	identifier = strings.TrimSpace(identifier)
	var user *model.User
	var err error
	if validEmail(identifier) {
		user, err = s.users.FindByEmail(identifier)
	} else {
		user, err = s.users.FindByUsername(identifier)
	}
	if err != nil {
		return nil, "", err
	}
	if user == nil {
		return nil, "", errors.New("账号或密码错误")
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)) != nil {
		return nil, "", errors.New("账号或密码错误")
	}
	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", err
	}
	return user, token, nil
}

func (s *AuthService) issueToken(user *model.User) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   user.ID,
		Audience:  jwt.ClaimStrings{user.Role},
		ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(s.jwtExpH) * time.Hour)),
		IssuedAt:  jwt.NewNumericDate(now),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(s.jwtSecret))
}

var (
	usernameRe = regexp.MustCompile(`^[A-Za-z0-9_]{3,32}$`)
	emailRe    = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
)

func validUsername(v string) bool { return usernameRe.MatchString(v) }
func validEmail(v string) bool    { return emailRe.MatchString(v) }