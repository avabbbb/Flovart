package service

import (
	"errors"
	"strings"
	"time"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type ProjectService struct {
	rep *repository.ProjectRepository
}

func NewProjectService(rep *repository.ProjectRepository) *ProjectService {
	return &ProjectService{rep: rep}
}

type SyncProjectInput struct {
	OrgID           string // 来自 URL 路径，不信任 body
	OwnerID         string // 来自登录态，不信任 body
	ID              string
	Title           string
	NodeCount       int
	ConnectionCount int
}

func (s *ProjectService) Sync(in SyncProjectInput) (*model.Project, error) {
	if in.ID == "" || in.OrgID == "" || in.OwnerID == "" {
		return nil, errors.New("ID/OrgID/OwnerID 不能为空")
	}
	in.Title = strings.TrimSpace(in.Title)
	if in.Title == "" {
		return nil, errors.New("项目标题不能为空")
	}
	now := time.Now().UTC()
	p := &model.Project{
		ID:              in.ID,
		OrgID:           in.OrgID,
		OwnerID:         in.OwnerID,
		Title:           in.Title,
		NodeCount:       in.NodeCount,
		ConnectionCount: in.ConnectionCount,
		LastSyncedAt:    &now,
	}
	if err := s.rep.UpsertScoped(p); err != nil {
		return nil, err
	}
	return p, nil
}

func (s *ProjectService) List(orgID string, page, size int) ([]model.Project, int64, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	return s.rep.List(orgID, page, size)
}

func (s *ProjectService) Delete(orgID, id string) error {
	return s.rep.DeleteByOrg(orgID, id)
}
