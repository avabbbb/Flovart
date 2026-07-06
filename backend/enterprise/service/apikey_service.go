package service

import (
	"errors"
	"fmt"
	"strings"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"gorm.io/gorm"
)

type ApiKeyService struct {
	db      *gorm.DB
	keys    *repository.ApiKeyRepository
	credits *repository.CreditRepository
}

func NewApiKeyService(db *gorm.DB, keys *repository.ApiKeyRepository, credits *repository.CreditRepository) *ApiKeyService {
	return &ApiKeyService{db: db, keys: keys, credits: credits}
}

type CreateApiKeyInput struct {
	OrgID    string
	Label    string
	Provider string
	BaseURL  string
	APIKey   string
}

func (s *ApiKeyService) Create(createdBy string, in CreateApiKeyInput) (*model.OrgApiKey, error) {
	in.Label = strings.TrimSpace(in.Label)
	in.Provider = strings.ToLower(strings.TrimSpace(in.Provider))
	in.APIKey = strings.TrimSpace(in.APIKey)
	if in.Label == "" {
		return nil, errors.New("标签不能为空")
	}
	if in.Provider == "" {
		return nil, errors.New("provider 不能为空")
	}
	if in.APIKey == "" {
		return nil, errors.New("API Key 不能为空")
	}
	hint := ""
	if len(in.APIKey) >= 4 {
		hint = "****" + in.APIKey[len(in.APIKey)-4:]
	}
	encrypted, err := encryptSecret(in.APIKey)
	if err != nil {
		return nil, err
	}
	key := &model.OrgApiKey{
		OrgID:       in.OrgID,
		Label:       in.Label,
		Provider:    in.Provider,
		BaseURL:     in.BaseURL,
		APIKey:      encrypted,
		KeyHint:     hint,
		Enabled:     true,
		CreatedByID: createdBy,
	}
	if err := s.keys.Create(key); err != nil {
		return nil, fmt.Errorf("创建 API Key 失败: %w", err)
	}
	return key, nil
}

func (s *ApiKeyService) List(orgID string) ([]model.OrgApiKey, error) {
	return s.keys.ListByOrg(orgID)
}

func (s *ApiKeyService) Toggle(id string, enabled bool) (*model.OrgApiKey, error) {
	key, err := s.keys.FindByID(id)
	if err != nil || key == nil {
		return nil, errors.New("API Key 不存在")
	}
	key.Enabled = enabled
	if err := s.keys.Update(key); err != nil {
		return nil, err
	}
	return key, nil
}

func (s *ApiKeyService) Delete(id string) error {
	return s.keys.Delete(id)
}

// --- ModelPricing ---

type CreatePricingInput struct {
	OrgID       string
	Provider    string
	Model       string
	Mode        string
	CostCredits int64
}

func (s *ApiKeyService) CreatePricing(in CreatePricingInput) (*model.ModelPricing, error) {
	if in.Provider == "" || in.Model == "" || in.Mode == "" {
		return nil, errors.New("provider/model/mode 不能为空")
	}
	if in.CostCredits < 0 {
		return nil, errors.New("积分单价不能为负")
	}
	existing, _ := s.keys.FindPricing(in.OrgID, in.Provider, in.Model)
	if existing != nil {
		existing.Mode = in.Mode
		existing.CostCredits = in.CostCredits
		existing.Enabled = true
		if err := s.keys.UpdatePricing(existing); err != nil {
			return nil, err
		}
		return existing, nil
	}
	p := &model.ModelPricing{
		OrgID:       in.OrgID,
		Provider:    in.Provider,
		Model:       in.Model,
		Mode:        in.Mode,
		CostCredits: in.CostCredits,
		Enabled:     true,
	}
	if err := s.keys.CreatePricing(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *ApiKeyService) ListPricing(orgID string) ([]model.ModelPricing, error) {
	return s.keys.ListPricing(orgID)
}

func (s *ApiKeyService) DeletePricing(id string) error {
	return s.keys.DeletePricing(id)
}

// --- MemberQuota ---

func (s *ApiKeyService) GetQuota(orgID, userID string) (*model.MemberQuota, error) {
	return s.keys.GetOrCreateQuota(orgID, userID)
}

func (s *ApiKeyService) ListQuotas(orgID string) ([]model.MemberQuota, error) {
	return s.keys.ListQuotas(orgID)
}

type UpdateQuotaInput struct {
	OrgID        string
	UserID       string
	MonthlyLimit int64
}

func (s *ApiKeyService) UpdateQuota(in UpdateQuotaInput) (*model.MemberQuota, error) {
	q, err := s.keys.GetOrCreateQuota(in.OrgID, in.UserID)
	if err != nil {
		return nil, err
	}
	q.MonthlyLimit = in.MonthlyLimit
	if err := s.keys.UpdateQuota(q); err != nil {
		return nil, err
	}
	return q, nil
}

// CheckQuota 检查成员当月用量是否超限。返回 (是否允许, 已用, 上限)
func (s *ApiKeyService) CheckQuota(orgID, userID string, cost int64) (bool, int64, int64, error) {
	q, err := s.keys.GetOrCreateQuota(orgID, userID)
	if err != nil {
		return false, 0, 0, err
	}
	if q.MonthlyLimit > 0 && q.UsedThisMonth+cost > q.MonthlyLimit {
		return false, q.UsedThisMonth, q.MonthlyLimit, nil
	}
	return true, q.UsedThisMonth, q.MonthlyLimit, nil
}

// ResolveKeyForProxy 代理端点使用：返回第一个 enabled 的指定 provider key
func (s *ApiKeyService) ResolveKeyForProxy(orgID, provider string) (*model.OrgApiKey, error) {
	list, err := s.keys.ListEnabledByOrg(orgID, provider)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, errors.New("没有可用的 API Key")
	}
	key := list[0]
	plain, err := decryptSecret(key.APIKey)
	if err != nil {
		return nil, err
	}
	key.APIKey = plain
	return &key, nil
}
