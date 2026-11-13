package repository

import (
	"context"
	"errors"
	"time"

	"flovart/hub/model"
	"github.com/lib/pq"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	// ErrNotFound 目标提示词包不存在
	ErrNotFound = errors.New("prompt pack not found")
	// ErrNotOwner 目标存在但不属于当前用户
	ErrNotOwner = errors.New("prompt pack not owned by user")
)

type PromptRepository struct {
	db *gorm.DB
}

func NewPromptRepository(db *gorm.DB) *PromptRepository {
	return &PromptRepository{db: db}
}

// publicAuthor 预加载作者时只取公开字段，避免把邮箱、状态等私有信息随公开列表泄露
func publicAuthor(db *gorm.DB) *gorm.DB {
	return db.Select("id", "username", "avatar_url", "bio")
}

func orderedItems(db *gorm.DB) *gorm.DB {
	return db.Order("sort ASC").Order("id ASC")
}

// Create 在单个事务中写入包与条目（GORM 关联创建默认包事务）；不级联写作者
func (r *PromptRepository) Create(ctx context.Context, pack *model.PromptPack) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		items := pack.Items
		if err := tx.Omit(clause.Associations).Create(pack).Error; err != nil {
			return err
		}
		if len(items) == 0 {
			return nil
		}
		for i := range items {
			items[i].ID = ""
			items[i].PackID = pack.ID
		}
		if err := tx.Create(&items).Error; err != nil {
			return err
		}
		pack.Items = items
		return nil
	})
}

func (r *PromptRepository) findOne(ctx context.Context, column, value string) (*model.PromptPack, error) {
	var p model.PromptPack
	err := r.db.WithContext(ctx).
		Preload("Author", publicAuthor).
		Preload("Items", orderedItems).
		Where(column+" = ?", value).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}

func (r *PromptRepository) FindByID(ctx context.Context, id string) (*model.PromptPack, error) {
	if !IsUUID(id) {
		return nil, nil
	}
	return r.findOne(ctx, "id", id)
}

func (r *PromptRepository) FindBySlug(ctx context.Context, slug string) (*model.PromptPack, error) {
	return r.findOne(ctx, "slug", slug)
}

// List 分页查询；Count 与 Find 使用各自的会话，避免共享 Statement 相互污染。
// 作者与条目通过 Preload 批量加载（每种关联一条 IN 查询），不存在 N+1。
func (r *PromptRepository) List(ctx context.Context, q model.Query) (*model.PageResult[model.PromptPack], error) {
	q.Normalize()
	base := r.db.WithContext(ctx).Model(&model.PromptPack{})
	if q.Keyword != "" {
		kw := "%" + escapeLike(q.Keyword) + "%"
		base = base.Where("(title ILIKE ? OR description ILIKE ?)", kw, kw)
	}
	if q.AuthorID != "" {
		base = base.Where("author_id = ?", q.AuthorID)
	}
	if q.Mode != "" {
		base = base.Where("mode = ?", q.Mode)
	}
	if len(q.Tags) > 0 {
		base = base.Where("tags && ?", pq.Array(q.Tags))
	}
	var total int64
	if err := base.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, err
	}
	list := []model.PromptPack{}
	if total > 0 {
		find := base.Session(&gorm.Session{}).Preload("Author", publicAuthor).Preload("Items", orderedItems)
		switch q.Sort {
		case "popular":
			find = find.Order("like_count DESC")
		case "downloads":
			find = find.Order("download_count DESC")
		}
		// 二级排序保证翻页稳定（同计数/同时间时顺序确定）
		find = find.Order("created_at DESC").Order("id DESC")
		if err := find.Offset((q.Page - 1) * q.Size).Limit(q.Size).Find(&list).Error; err != nil {
			return nil, err
		}
	}
	for i := range list {
		if list[i].Items == nil {
			list[i].Items = []model.PromptItem{}
		}
	}
	return &model.PageResult[model.PromptPack]{List: list, Total: total, Page: q.Page, Size: q.Size}, nil
}

// lockOwned 在事务内锁定包行并校验归属
func lockOwned(tx *gorm.DB, id, authorID string) error {
	if !IsUUID(id) {
		return ErrNotFound
	}
	var owner struct{ AuthorID string }
	res := tx.Model(&model.PromptPack{}).Clauses(clause.Locking{Strength: "UPDATE"}).
		Select("author_id").Where("id = ?", id).Limit(1).Scan(&owner)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	if owner.AuthorID != authorID {
		return ErrNotOwner
	}
	return nil
}

// UpdateOwned 校验归属后在一个事务里更新包字段并整体替换条目。
// 旧实现用 Save 级联保存，旧条目不会被删除（条目只增不减），且会把客户端带来的条目 ID upsert 到本包。
func (r *PromptRepository) UpdateOwned(ctx context.Context, id, authorID string, fields model.PromptPack) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwned(tx, id, authorID); err != nil {
			return err
		}
		if err := tx.Model(&model.PromptPack{}).Where("id = ?", id).Updates(map[string]any{
			"title":       fields.Title,
			"description": fields.Description,
			"mode":        fields.Mode,
			"tags":        fields.Tags,
			"updated_at":  time.Now(),
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("pack_id = ?", id).Delete(&model.PromptItem{}).Error; err != nil {
			return err
		}
		if len(fields.Items) == 0 {
			return nil
		}
		items := make([]model.PromptItem, len(fields.Items))
		for i, it := range fields.Items {
			items[i] = model.PromptItem{PackID: id, Name: it.Name, Prompt: it.Prompt, Sort: it.Sort}
		}
		return tx.Create(&items).Error
	})
}

// DeleteOwned 校验归属后删除包及其条目、收藏关系。
// 旧实现直接删包，会被 prompt_items / prompt_likes 的外键约束拒绝。
func (r *PromptRepository) DeleteOwned(ctx context.Context, id, authorID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockOwned(tx, id, authorID); err != nil {
			return err
		}
		if err := tx.Where("pack_id = ?", id).Delete(&model.PromptLike{}).Error; err != nil {
			return err
		}
		if err := tx.Where("pack_id = ?", id).Delete(&model.PromptItem{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.PromptPack{}).Error
	})
}

func (r *PromptRepository) IncrementDownload(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&model.PromptPack{}).Where("id = ?", id).
		UpdateColumn("download_count", gorm.Expr("download_count + 1")).Error
}

// ToggleLike 在事务内切换收藏并同步 like_count。
// 用 RowsAffected 判断是否真的删除/插入，配合 ON CONFLICT DO NOTHING，并发重复点击不会报主键冲突也不会让计数漂移。
func (r *PromptRepository) ToggleLike(ctx context.Context, userID, packID string) (bool, error) {
	if !IsUUID(packID) {
		return false, ErrNotFound
	}
	liked := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var exists int64
		if err := tx.Model(&model.PromptPack{}).Where("id = ?", packID).Count(&exists).Error; err != nil {
			return err
		}
		if exists == 0 {
			return ErrNotFound
		}
		del := tx.Where("user_id = ? AND pack_id = ?", userID, packID).Delete(&model.PromptLike{})
		if del.Error != nil {
			return del.Error
		}
		if del.RowsAffected > 0 {
			liked = false
			return tx.Model(&model.PromptPack{}).Where("id = ?", packID).
				UpdateColumn("like_count", gorm.Expr("GREATEST(like_count - 1, 0)")).Error
		}
		ins := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.PromptLike{UserID: userID, PackID: packID})
		if ins.Error != nil {
			return ins.Error
		}
		liked = true
		if ins.RowsAffected == 0 {
			return nil // 并发请求已插入，状态即为已收藏
		}
		return tx.Model(&model.PromptPack{}).Where("id = ?", packID).
			UpdateColumn("like_count", gorm.Expr("like_count + 1")).Error
	})
	return liked, err
}
