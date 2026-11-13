package repository

import (
	"context"
	"errors"

	"flovart/hub/model"
	"gorm.io/gorm"
)

type UserRepository struct {
	db *gorm.DB
}

func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) Create(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *UserRepository) findOne(ctx context.Context, column, value string) (*model.User, error) {
	var u model.User
	if err := r.db.WithContext(ctx).Where(column+" = ?", value).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &u, nil
}

func (r *UserRepository) FindByUsername(ctx context.Context, username string) (*model.User, error) {
	return r.findOne(ctx, "username", username)
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	return r.findOne(ctx, "email", email)
}

func (r *UserRepository) FindByID(ctx context.Context, id string) (*model.User, error) {
	if !IsUUID(id) {
		return nil, nil
	}
	return r.findOne(ctx, "id", id)
}

// SessionState 供鉴权中间件校验账号状态与 token 版本；用户不存在时返回空状态与 nil 错误。
// 只查两列，避免每个鉴权请求都拉取整行（含密码哈希）。
func (r *UserRepository) SessionState(ctx context.Context, id string) (string, int64, error) {
	if !IsUUID(id) {
		return "", 0, nil
	}
	var row struct {
		Status       string
		TokenVersion int64
	}
	res := r.db.WithContext(ctx).Model(&model.User{}).Select("status", "token_version").Where("id = ?", id).Limit(1).Scan(&row)
	if res.Error != nil {
		return "", 0, res.Error
	}
	if res.RowsAffected == 0 {
		return "", 0, nil
	}
	return row.Status, row.TokenVersion, nil
}
