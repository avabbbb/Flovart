package repository

import (
	"errors"

	"gorm.io/gorm"
	"flovart/hub/model"
)

type PromptRepository struct {
	db *gorm.DB
}

func NewPromptRepository(db *gorm.DB) *PromptRepository {
	return &PromptRepository{db: db}
}

func (r *PromptRepository) Create(pack *model.PromptPack) error {
	return r.db.Create(pack).Error
}

func (r *PromptRepository) FindByID(id string) (*model.PromptPack, error) {
	var p model.PromptPack
	if err := r.db.Preload("Author").Preload("Items").Where("id = ?", id).First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (r *PromptRepository) FindBySlug(slug string) (*model.PromptPack, error) {
	var p model.PromptPack
	if err := r.db.Preload("Author").Preload("Items").Where("slug = ?", slug).First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (r *PromptRepository) List(q model.Query) (*model.PageResult[model.PromptPack], error) {
	q.Normalize()
	tx := r.db.Model(&model.PromptPack{}).Preload("Author")
	if q.Keyword != "" {
		tx = tx.Where("title ILIKE ? OR description ILIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}
	if q.AuthorID != "" {
		tx = tx.Where("author_id = ?", q.AuthorID)
	}
	if q.Mode != "" {
		tx = tx.Where("mode = ?", q.Mode)
	}
	if len(q.Tags) > 0 {
		tx = tx.Where("tags && ?", "{"+joinTags(q.Tags)+"}")
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, err
	}
	switch q.Sort {
	case "popular":
		tx = tx.Order("like_count DESC")
	case "downloads":
		tx = tx.Order("download_count DESC")
	default:
		tx = tx.Order("created_at DESC")
	}
	var list []model.PromptPack
	if err := tx.Offset((q.Page - 1) * q.Size).Limit(q.Size).Find(&list).Error; err != nil {
		return nil, err
	}
	return &model.PageResult[model.PromptPack]{List: list, Total: total, Page: q.Page, Size: q.Size}, nil
}

func (r *PromptRepository) Update(pack *model.PromptPack) error {
	return r.db.Save(pack).Error
}

func (r *PromptRepository) Delete(id, authorID string) error {
	tx := r.db.Where("id = ? AND author_id = ?", id, authorID).Delete(&model.PromptPack{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("not found or not owned")
	}
	return nil
}

func (r *PromptRepository) IncrementDownload(id string) error {
	return r.db.Model(&model.PromptPack{}).Where("id = ?", id).
		UpdateColumn("download_count", gorm.Expr("download_count + 1")).Error
}

func (r *PromptRepository) ToggleLike(userID, packID string) (bool, error) {
	var existing model.PromptLike
	err := r.db.Where("user_id = ? AND pack_id = ?", userID, packID).First(&existing).Error
	if err == nil {
		if err := r.db.Delete(&existing).Error; err != nil {
			return false, err
		}
		if err := r.db.Model(&model.PromptPack{}).Where("id = ?", packID).
			UpdateColumn("like_count", gorm.Expr("like_count - 1")).Error; err != nil {
			return false, err
		}
		return false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	like := model.PromptLike{UserID: userID, PackID: packID}
	if err := r.db.Create(&like).Error; err != nil {
		return false, err
	}
	if err := r.db.Model(&model.PromptPack{}).Where("id = ?", packID).
		UpdateColumn("like_count", gorm.Expr("like_count + 1")).Error; err != nil {
		return false, err
	}
	return true, nil
}

func joinTags(tags []string) string {
	out := ""
	for i, t := range tags {
		if i > 0 {
			out += ","
		}
		out += t
	}
	return out
}