package service

import (
	"errors"
	"strings"

	"flovart/hub/model"
	"flovart/hub/repository"
)

type PromptService struct {
	pack *repository.PromptRepository
}

func NewPromptService(pack *repository.PromptRepository) *PromptService {
	return &PromptService{pack: pack}
}

// CreateInput 创建提示词包的入参（含鉴权后的作者）
type CreateInput struct {
	Slug        string
	Title       string
	Description string
	Mode        string
	Tags        []string
	Items       []model.PromptItem
}

func (s *PromptService) Create(authorID string, in CreateInput) (*model.PromptPack, error) {
	in.Slug = strings.TrimSpace(in.Slug)
	in.Title = strings.TrimSpace(in.Title)
	if in.Slug == "" {
		return nil, errors.New("slug 不能为空")
	}
	if in.Title == "" {
		return nil, errors.New("标题不能为空")
	}
	if in.Mode != "image" && in.Mode != "video" && in.Mode != "text" {
		in.Mode = "image"
	}
	if len(in.Items) == 0 {
		return nil, errors.New("至少包含一条提示词")
	}
	for i := range in.Items {
		if strings.TrimSpace(in.Items[i].Name) == "" || strings.TrimSpace(in.Items[i].Prompt) == "" {
			return nil, errors.New("提示词条目名称和内容不能为空")
		}
		in.Items[i].Sort = i
	}
	if existing, _ := s.pack.FindBySlug(in.Slug); existing != nil {
		return nil, errors.New("slug 已存在")
	}
	pack := &model.PromptPack{
		Slug:        in.Slug,
		Title:       in.Title,
		Description: in.Description,
		AuthorID:    authorID,
		Mode:        in.Mode,
		Tags:        in.Tags,
		Items:       in.Items,
	}
	if err := s.pack.Create(pack); err != nil {
		return nil, err
	}
	return pack, nil
}

func (s *PromptService) List(q model.Query) (*model.PageResult[model.PromptPack], error) {
	return s.pack.List(q)
}

func (s *PromptService) Get(id string) (*model.PromptPack, error) {
	return s.pack.FindByID(id)
}

func (s *PromptService) GetBySlug(slug string) (*model.PromptPack, error) {
	return s.pack.FindBySlug(slug)
}

func (s *PromptService) IncrementDownload(id string) error {
	return s.pack.IncrementDownload(id)
}

func (s *PromptService) ToggleLike(userID, packID string) (bool, error) {
	return s.pack.ToggleLike(userID, packID)
}

func (s *PromptService) Update(authorID, id string, in CreateInput) (*model.PromptPack, error) {
	pack, err := s.pack.FindByID(id)
	if err != nil {
		return nil, err
	}
	if pack == nil {
		return nil, errors.New("未找到提示词包")
	}
	if pack.AuthorID != authorID {
		return nil, errors.New("无权修改他人提示词包")
	}
	pack.Title = strings.TrimSpace(in.Title)
	pack.Description = in.Description
	pack.Mode = in.Mode
	pack.Tags = in.Tags
	pack.Items = in.Items
	if err := s.pack.Update(pack); err != nil {
		return nil, err
	}
	return pack, nil
}

func (s *PromptService) Delete(authorID, id string) error {
	return s.pack.Delete(id, authorID)
}