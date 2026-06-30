package repository

import (
	"errors"

	"gorm.io/gorm"
	"flovart/enterprise/model"
)

type OrgRepository struct {
	db *gorm.DB
}

func NewOrgRepository(db *gorm.DB) *OrgRepository {
	return &OrgRepository{db: db}
}

func (r *OrgRepository) Create(org *model.Organization, ownerID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(org).Error; err != nil {
			return err
		}
		member := &model.OrganizationMember{
			OrgID:  org.ID,
			UserID: ownerID,
			Role:  model.RoleOwner,
		}
		return tx.Create(member).Error
	})
}

func (r *OrgRepository) FindByID(id string) (*model.Organization, error) {
	var o model.Organization
	if err := r.db.Where("id = ?", id).First(&o).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func (r *OrgRepository) FindBySlug(slug string) (*model.Organization, error) {
	var o model.Organization
	if err := r.db.Where("slug = ?", slug).First(&o).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

func (r *OrgRepository) ListByUser(userID string) ([]model.Organization, error) {
	var list []model.Organization
	err := r.db.Joins("JOIN organization_members ON organization_members.org_id = organizations.id").
		Where("organization_members.user_id = ?", userID).
		Order("organizations.created_at DESC").
		Find(&list).Error
	return list, err
}

func (r *OrgRepository) Delete(id, ownerID string) error {
	tx := r.db.Where("id = ? AND owner_id = ?", id, ownerID).Delete(&model.Organization{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("not found or not owner")
	}
	return r.db.Where("org_id = ?", id).Delete(&model.OrganizationMember{}).Error
}

func (r *OrgRepository) ListMembers(orgID string) ([]model.OrganizationMember, error) {
	var list []model.OrganizationMember
	err := r.db.Preload("User").Where("org_id = ?", orgID).Order("created_at ASC").Find(&list).Error
	return list, err
}

func (r *OrgRepository) FindMember(orgID, userID string) (*model.OrganizationMember, error) {
	var m model.OrganizationMember
	if err := r.db.Where("org_id = ? AND user_id = ?", orgID, userID).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &m, nil
}

func (r *OrgRepository) AddMember(m *model.OrganizationMember) error {
	return r.db.Create(m).Error
}

func (r *OrgRepository) UpdateMemberRole(orgID, userID, newRole string) error {
	tx := r.db.Model(&model.OrganizationMember{}).
		Where("org_id = ? AND user_id = ? AND role <> ?", orgID, userID, model.RoleOwner).
		Update("role", newRole)
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("成员不存在或为 owner，无法调整")
	}
	return nil
}

func (r *OrgRepository) RemoveMember(orgID, userID string) error {
	tx := r.db.Where("org_id = ? AND user_id = ? AND role <> ?", orgID, userID, model.RoleOwner).
		Delete(&model.OrganizationMember{})
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return errors.New("成员不存在或为 owner，无法移除")
	}
	return nil
}

func (r *OrgRepository) OwnerCount(orgID string) (int64, error) {
	var n int64
	err := r.db.Model(&model.OrganizationMember{}).
		Where("org_id = ? AND role = ?", orgID, model.RoleOwner).Count(&n).Error
	return n, err
}