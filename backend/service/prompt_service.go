package service

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"flovart/hub/apperr"
	"flovart/hub/model"
	"flovart/hub/repository"
	"github.com/lib/pq"
	"gorm.io/gorm"
)

type PromptService struct {
	pack *repository.PromptRepository
}

func NewPromptService(pack *repository.PromptRepository) *PromptService {
	return &PromptService{pack: pack}
}

// CreateInput 创建/更新提示词包的入参（作者由鉴权上下文给出）
type CreateInput struct {
	Slug        string
	Title       string
	Description string
	Mode        string
	Tags        []string
	Items       []model.PromptItem
}

// 字段上限与数据库列宽一致，超限时给出业务错误而不是让数据库报错
const (
	maxSlugLen        = 80
	maxTitleLen       = 120
	maxDescriptionLen = 1000
	maxItemNameLen    = 120
	maxItemPromptLen  = 20000
	maxItems          = 200
	maxTags           = 20
	maxTagLen         = 32
)

func runeLen(s string) int { return utf8.RuneCountInString(s) }

// normalizeInput 校验并规整入参；slug 只在创建时校验（更新时不允许修改 slug）
func normalizeInput(in *CreateInput, checkSlug bool) error {
	in.Slug = strings.TrimSpace(in.Slug)
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	if checkSlug {
		if in.Slug == "" {
			return apperr.BadRequest("slug 不能为空")
		}
		if runeLen(in.Slug) > maxSlugLen || strings.ContainsAny(in.Slug, "/?#%\\ \t\r\n") {
			return apperr.BadRequest("slug 不能超过 80 个字符，且不能包含空白或 / ? # % \\")
		}
	}
	if in.Title == "" {
		return apperr.BadRequest("标题不能为空")
	}
	if runeLen(in.Title) > maxTitleLen {
		return apperr.BadRequest("标题不能超过 120 个字符")
	}
	if runeLen(in.Description) > maxDescriptionLen {
		return apperr.BadRequest("描述不能超过 1000 个字符")
	}
	if in.Mode != "image" && in.Mode != "video" && in.Mode != "text" {
		in.Mode = "image"
	}
	tags := make([]string, 0, len(in.Tags))
	seen := map[string]bool{}
	for _, t := range in.Tags {
		t = strings.TrimSpace(t)
		if t == "" || seen[t] {
			continue
		}
		if runeLen(t) > maxTagLen {
			return apperr.BadRequest("单个标签不能超过 32 个字符")
		}
		seen[t] = true
		tags = append(tags, t)
	}
	if len(tags) > maxTags {
		return apperr.BadRequest("标签不能超过 20 个")
	}
	in.Tags = tags
	if len(in.Items) == 0 {
		return apperr.BadRequest("至少包含一条提示词")
	}
	if len(in.Items) > maxItems {
		return apperr.BadRequest("单个提示词包最多 200 条提示词")
	}
	items := make([]model.PromptItem, len(in.Items))
	for i, it := range in.Items {
		name := strings.TrimSpace(it.Name)
		prompt := strings.TrimSpace(it.Prompt)
		if name == "" || prompt == "" {
			return apperr.BadRequest("提示词条目名称和内容不能为空")
		}
		if runeLen(name) > maxItemNameLen || runeLen(prompt) > maxItemPromptLen {
			return apperr.BadRequest("提示词条目名称不能超过 120 字、内容不能超过 20000 字")
		}
		// 只保留内容字段；客户端传来的 ID / PackID 一律丢弃，防止借 upsert 篡改其他包的条目
		items[i] = model.PromptItem{Name: name, Prompt: prompt, Sort: i}
	}
	in.Items = items
	return nil
}

func (s *PromptService) Create(ctx context.Context, authorID string, in CreateInput) (*model.PromptPack, error) {
	if err := normalizeInput(&in, true); err != nil {
		return nil, err
	}
	existing, err := s.pack.FindBySlug(ctx, in.Slug)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, apperr.Conflict("slug 已存在")
	}
	pack := &model.PromptPack{
		Slug:        in.Slug,
		Title:       in.Title,
		Description: in.Description,
		AuthorID:    authorID,
		Mode:        in.Mode,
		Tags:        pq.StringArray(in.Tags),
		Items:       in.Items,
	}
	if err := s.pack.Create(ctx, pack); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			return nil, apperr.Conflict("slug 已存在")
		}
		return nil, err
	}
	return pack, nil
}

func (s *PromptService) List(ctx context.Context, q model.Query) (*model.PageResult[model.PromptPack], error) {
	if q.AuthorID != "" && !repository.IsUUID(q.AuthorID) {
		return nil, apperr.BadRequest("authorId 格式不正确")
	}
	return s.pack.List(ctx, q)
}

func (s *PromptService) Get(ctx context.Context, id string) (*model.PromptPack, error) {
	return s.pack.FindByID(ctx, id)
}

func (s *PromptService) GetBySlug(ctx context.Context, slug string) (*model.PromptPack, error) {
	return s.pack.FindBySlug(ctx, slug)
}

func (s *PromptService) IncrementDownload(ctx context.Context, id string) error {
	return s.pack.IncrementDownload(ctx, id)
}

func (s *PromptService) ToggleLike(ctx context.Context, userID, packID string) (bool, error) {
	liked, err := s.pack.ToggleLike(ctx, userID, packID)
	return liked, mapRepoErr(err)
}

// Update 更新标题/描述/模式/标签并整体替换条目；slug 不可修改
func (s *PromptService) Update(ctx context.Context, authorID, id string, in CreateInput) (*model.PromptPack, error) {
	if err := normalizeInput(&in, false); err != nil {
		return nil, err
	}
	err := s.pack.UpdateOwned(ctx, id, authorID, model.PromptPack{
		Title: in.Title, Description: in.Description, Mode: in.Mode,
		Tags: pq.StringArray(in.Tags), Items: in.Items,
	})
	if err != nil {
		return nil, mapRepoErr(err)
	}
	pack, err := s.pack.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if pack == nil {
		return nil, apperr.NotFound("未找到提示词包")
	}
	return pack, nil
}

func (s *PromptService) Delete(ctx context.Context, authorID, id string) error {
	return mapRepoErr(s.pack.DeleteOwned(ctx, id, authorID))
}

func mapRepoErr(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, repository.ErrNotFound):
		return apperr.NotFound("未找到提示词包")
	case errors.Is(err, repository.ErrNotOwner):
		return apperr.Forbidden("无权修改他人提示词包")
	}
	return err
}
