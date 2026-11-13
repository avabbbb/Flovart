package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"flovart/hub/apperr"
	"flovart/hub/model"
	"flovart/hub/repository"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthService struct {
	users     *repository.UserRepository
	jwtSecret string
	jwtExpH   int
}

func AccountCanAuthenticate(status string) bool {
	status = strings.ToLower(strings.TrimSpace(status))
	return status == "" || status == "active"
}

func NewAuthService(users *repository.UserRepository, jwtSecret string, jwtExpH int) *AuthService {
	if jwtExpH <= 0 {
		jwtExpH = 168
	}
	return &AuthService{users: users, jwtSecret: jwtSecret, jwtExpH: jwtExpH}
}

// 密码长度约束：bcrypt 只处理前 72 字节，超出时 x/crypto 会直接返回错误
const (
	minPasswordLen = 6
	maxPasswordLen = 72
)

// dummyHash 用于账号不存在时也做一次 bcrypt 比较，抹平响应时间差，防止按耗时枚举账号
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("flovart-dummy-password"), bcrypt.DefaultCost)

// Register 注册新用户
func (s *AuthService) Register(ctx context.Context, username, email, password string) (*model.User, string, error) {
	username = strings.TrimSpace(username)
	email = strings.ToLower(strings.TrimSpace(email))
	if !validUsername(username) {
		return nil, "", apperr.BadRequest("用户名只能含字母数字下划线，3-32 位")
	}
	if !validEmail(email) {
		return nil, "", apperr.BadRequest("邮箱格式不正确")
	}
	if len(password) < minPasswordLen {
		return nil, "", apperr.BadRequest("密码至少 6 位")
	}
	if len(password) > maxPasswordLen {
		return nil, "", apperr.BadRequest("密码不能超过 72 字节")
	}
	existing, err := s.users.FindByUsername(ctx, username)
	if err != nil {
		return nil, "", err
	}
	if existing != nil {
		return nil, "", apperr.BadRequest("用户名已存在")
	}
	if existing, err = s.users.FindByEmail(ctx, email); err != nil {
		return nil, "", err
	}
	if existing != nil {
		return nil, "", apperr.BadRequest("邮箱已注册")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", err
	}
	user := &model.User{Username: username, Email: email, Password: string(hash), Role: "user", Status: "active", TokenVersion: 1}
	if err := s.users.Create(ctx, user); err != nil {
		// 并发注册同名/同邮箱时由唯一索引兜底
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, "", apperr.BadRequest("用户名或邮箱已存在")
		}
		return nil, "", err
	}
	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", err
	}
	return user, token, nil
}

// Login 用户名/邮箱 + 密码登录
func (s *AuthService) Login(ctx context.Context, identifier, password string) (*model.User, string, error) {
	identifier = strings.TrimSpace(identifier)
	var user *model.User
	var err error
	if validEmail(identifier) {
		// 注册时邮箱统一小写存储，登录也需小写后再查
		user, err = s.users.FindByEmail(ctx, strings.ToLower(identifier))
	} else {
		user, err = s.users.FindByUsername(ctx, identifier)
	}
	if err != nil {
		return nil, "", err
	}
	if user == nil {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return nil, "", errInvalidCredentials
	}
	// 先校验密码再暴露账号状态，避免未知密码者探测账号是否被停用
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)) != nil {
		return nil, "", errInvalidCredentials
	}
	if !AccountCanAuthenticate(user.Status) {
		return nil, "", apperr.Forbidden("账号已停用，请联系平台管理员")
	}
	token, err := s.issueToken(user)
	if err != nil {
		return nil, "", err
	}
	return user, token, nil
}

var errInvalidCredentials = apperr.Unauthorized("账号或密码错误")

func (s *AuthService) issueToken(user *model.User) (string, error) {
	now := time.Now()
	claims := UserClaims{
		TokenVersion: user.TokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			Audience:  jwt.ClaimStrings{user.Role},
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(s.jwtExpH) * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
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

// GetUserByID 根据 ID 查询用户
func (s *AuthService) GetUserByID(ctx context.Context, id string) (*model.User, error) {
	return s.users.FindByID(ctx, id)
}

type UserClaims struct {
	TokenVersion int64 `json:"ver"`
	jwt.RegisteredClaims
}
