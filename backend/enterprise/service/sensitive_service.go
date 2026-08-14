package service

import (
	"errors"
	"strings"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type SensitiveService struct {
	rep *repository.SensitiveRepository
}

func NewSensitiveService(rep *repository.SensitiveRepository) *SensitiveService {
	return &SensitiveService{rep: rep}
}

type CreateSensitiveInput struct {
	OrgID    string
	Word     string
	Category string
	Action   string
}

func (s *SensitiveService) Create(in CreateSensitiveInput) (*model.SensitiveWord, error) {
	in.Word = strings.TrimSpace(in.Word)
	if in.Word == "" {
		return nil, errors.New("敏感词不能为空")
	}
	if in.Category == "" {
		in.Category = "custom"
	}
	if in.Action == "" {
		in.Action = model.SensitiveActionBlock
	}
	w := &model.SensitiveWord{
		OrgID:    in.OrgID,
		Word:     in.Word,
		Category: in.Category,
		Action:   in.Action,
	}
	if err := s.rep.Create(w); err != nil {
		return nil, err
	}
	return w, nil
}

func (s *SensitiveService) List(orgID string) ([]model.SensitiveWord, error) {
	return s.rep.List(orgID)
}

func (s *SensitiveService) Delete(orgID, id string) error {
	return s.rep.DeleteByOrg(orgID, id)
}

type CheckResult struct {
	Blocked  []string
	Warned   []string
	Reviewed []string
	HasBlock bool
}

func (s *SensitiveService) Check(orgID, text string) (*CheckResult, error) {
	words, err := s.rep.ListAll(orgID)
	if err != nil {
		return nil, err
	}
	result := &CheckResult{}
	lowerText := strings.ToLower(text)
	for _, w := range words {
		if strings.Contains(lowerText, strings.ToLower(w.Word)) {
			switch w.Action {
			case model.SensitiveActionBlock:
				result.Blocked = append(result.Blocked, w.Word)
				result.HasBlock = true
			case model.SensitiveActionWarn:
				result.Warned = append(result.Warned, w.Word)
			case model.SensitiveActionReview:
				result.Reviewed = append(result.Reviewed, w.Word)
			}
		}
	}
	return result, nil
}
