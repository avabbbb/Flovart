package repository

import (
	"errors"
	"strings"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

// UserRepository 只读查询 hub 共享的 users 表
type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) FindByID(id string) (*model.User, error) {
	var u model.User
	if err := r.db.Where("id = ?", id).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) FindByUsername(username string) (*model.User, error) {
	var u model.User
	if err := r.db.Where("username = ?", username).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) FindByEmail(email string) (*model.User, error) {
	var u model.User
	if err := r.db.Where("email = ?", email).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) SessionState(id string) (string, int64, error) {
	user, err := r.FindByID(id)
	if err != nil || user == nil {
		return "", 0, err
	}
	return user.Status, user.TokenVersion, nil
}

func (r *UserRepository) Create(user *model.User) error {
	return r.db.Create(user).Error
}

func (r *UserRepository) List(search string, page, pageSize int) ([]model.User, int64, error) {
	query := r.db.Model(&model.User{})
	if search = strings.TrimSpace(search); search != "" {
		like := "%" + search + "%"
		query = query.Where("username ILIKE ? OR email ILIKE ?", like, like)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var list []model.User
	err := query.Order("created_at DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&list).Error
	return list, total, err
}

func (r *UserRepository) Update(user *model.User) error {
	return r.db.Model(&model.User{}).Where("id = ?", user.ID).Updates(map[string]any{
		"username":      user.Username,
		"email":         user.Email,
		"role":          user.Role,
		"status":        user.Status,
		"token_version": user.TokenVersion,
	}).Error
}
