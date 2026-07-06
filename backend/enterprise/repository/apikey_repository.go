package repository

import (
	"errors"
	"time"

	"flovart/enterprise/model"
	"gorm.io/gorm"
)

type ApiKeyRepository struct {
	db *gorm.DB
}

func NewApiKeyRepository(db *gorm.DB) *ApiKeyRepository {
	return &ApiKeyRepository{db: db}
}

func (r *ApiKeyRepository) Create(key *model.OrgApiKey) error {
	return r.db.Create(key).Error
}

func (r *ApiKeyRepository) FindByID(id string) (*model.OrgApiKey, error) {
	var k model.OrgApiKey
	err := r.db.Where("id = ?", id).First(&k).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &k, err
}

func (r *ApiKeyRepository) ListByOrg(orgID string) ([]model.OrgApiKey, error) {
	var list []model.OrgApiKey
	err := r.db.Where("org_id = ?", orgID).Order("created_at DESC").Find(&list).Error
	return list, err
}

func (r *ApiKeyRepository) ListEnabledByOrg(orgID, provider string) ([]model.OrgApiKey, error) {
	var list []model.OrgApiKey
	q := r.db.Where("org_id = ? AND enabled = true", orgID)
	if provider != "" {
		q = q.Where("provider = ?", provider)
	}
	err := q.Order("created_at ASC").Find(&list).Error
	return list, err
}

func (r *ApiKeyRepository) Update(k *model.OrgApiKey) error {
	return r.db.Save(k).Error
}

func (r *ApiKeyRepository) Delete(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.OrgApiKey{}).Error
}

// --- ModelPricing ---

func (r *ApiKeyRepository) CreatePricing(p *model.ModelPricing) error {
	return r.db.Create(p).Error
}

func (r *ApiKeyRepository) FindPricing(orgID, provider, modelID string) (*model.ModelPricing, error) {
	var p model.ModelPricing
	err := r.db.Where("org_id = ? AND provider = ? AND model = ?", orgID, provider, modelID).First(&p).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &p, err
}

func (r *ApiKeyRepository) ListPricing(orgID string) ([]model.ModelPricing, error) {
	var list []model.ModelPricing
	err := r.db.Where("org_id = ?", orgID).Order("provider, model").Find(&list).Error
	return list, err
}

func (r *ApiKeyRepository) UpdatePricing(p *model.ModelPricing) error {
	return r.db.Save(p).Error
}

func (r *ApiKeyRepository) DeletePricing(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.ModelPricing{}).Error
}

// --- MemberQuota ---

func (r *ApiKeyRepository) GetOrCreateQuota(orgID, userID string) (*model.MemberQuota, error) {
	var q model.MemberQuota
	err := r.db.Where("org_id = ? AND user_id = ?", orgID, userID).First(&q).Error
	if err == nil {
		return &q, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	q = model.MemberQuota{OrgID: orgID, UserID: userID, MonthlyLimit: 0, UsedThisMonth: 0, PeriodStart: time.Now().UTC()}
	if err := r.db.Create(&q).Error; err != nil {
		return nil, err
	}
	return &q, nil
}

func (r *ApiKeyRepository) ListQuotas(orgID string) ([]model.MemberQuota, error) {
	var list []model.MemberQuota
	err := r.db.Where("org_id = ?", orgID).Order("updated_at DESC").Find(&list).Error
	return list, err
}

func (r *ApiKeyRepository) UpdateQuota(q *model.MemberQuota) error {
	return r.db.Save(q).Error
}
