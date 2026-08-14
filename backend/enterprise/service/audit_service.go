package service

import (
	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type AuditService struct{ repo *repository.AuditRepository }

func NewAuditService(repo *repository.AuditRepository) *AuditService {
	return &AuditService{repo: repo}
}

func (s *AuditService) List(orgID string, page, pageSize int) ([]model.AuditLog, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	return s.repo.List(orgID, page, pageSize)
}
