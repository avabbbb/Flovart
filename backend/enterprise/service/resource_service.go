package service

import (
	"errors"
	"strings"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"gorm.io/gorm"
)

type ResourceService struct {
	db  *gorm.DB
	rep *repository.ResourceRepository
}

func NewResourceService(db *gorm.DB, rep *repository.ResourceRepository) *ResourceService {
	return &ResourceService{db: db, rep: rep}
}

type CreateLevelInput struct {
	OrgID string
	Name  string
	Sort  int
}

func (s *ResourceService) CreateLevel(in CreateLevelInput) (*model.ResourceLevel, error) {
	in.Name = strings.TrimSpace(in.Name)
	if in.Name == "" {
		return nil, errors.New("密级名称不能为空")
	}
	l := &model.ResourceLevel{OrgID: in.OrgID, Name: in.Name, Sort: in.Sort}
	if err := s.rep.CreateLevel(l); err != nil {
		return nil, err
	}
	return l, nil
}

func (s *ResourceService) ListLevels(orgID string) ([]model.ResourceLevel, error) {
	return s.rep.ListLevels(orgID)
}

func (s *ResourceService) DeleteLevel(orgID, id string) error {
	return s.rep.DeleteLevelByOrg(orgID, id)
}

type CreateResourceInput struct {
	OrgID      string
	UploaderID string
	Type       string
	Title      string
	Href       string
	Thumbnail  string
	StorageKey string
	LevelID    string
}

func (s *ResourceService) Create(in CreateResourceInput) (*model.Resource, error) {
	if in.Type != "image" && in.Type != "video" {
		return nil, errors.New("type 只能是 image 或 video")
	}
	if in.Href == "" {
		return nil, errors.New("href 不能为空")
	}
	res := &model.Resource{
		OrgID:      in.OrgID,
		UploaderID: in.UploaderID,
		Type:       in.Type,
		Title:      in.Title,
		Href:       in.Href,
		Thumbnail:  in.Thumbnail,
		StorageKey: in.StorageKey,
		Status:     model.ResourceStatusPending,
	}
	if in.LevelID != "" {
		res.LevelID = &in.LevelID
	}
	if err := s.rep.Create(res); err != nil {
		return nil, err
	}
	return res, nil
}

type ListResourceInput struct {
	OrgID    string
	Page     int
	PageSize int
	Status   string
}

func (s *ResourceService) List(in ListResourceInput) ([]model.Resource, int64, error) {
	if in.Page < 1 {
		in.Page = 1
	}
	if in.PageSize < 1 || in.PageSize > 100 {
		in.PageSize = 20
	}
	return s.rep.List(in.OrgID, in.Page, in.PageSize, in.Status)
}

func (s *ResourceService) Get(orgID, id string) (*model.Resource, error) {
	res, err := s.rep.FindByIDAndOrg(orgID, id)
	if err != nil || res == nil {
		return nil, errors.New("资源不存在")
	}
	return res, nil
}

func (s *ResourceService) Review(orgID, id, status string) (*model.Resource, error) {
	if status != model.ResourceStatusApproved && status != model.ResourceStatusRejected {
		return nil, errors.New("status 只能是 approved 或 rejected")
	}
	res, err := s.rep.FindByIDAndOrg(orgID, id)
	if err != nil || res == nil {
		return nil, errors.New("资源不存在")
	}
	if res.Status != model.ResourceStatusPending {
		return nil, errors.New("只有待审核资源可以审批")
	}
	res.Status = status
	if err := s.rep.Update(res); err != nil {
		return nil, err
	}
	return res, nil
}

func (s *ResourceService) Publish(orgID, id string) (*model.Resource, error) {
	res, err := s.rep.FindByIDAndOrg(orgID, id)
	if err != nil || res == nil {
		return nil, errors.New("资源不存在")
	}
	if res.Status != model.ResourceStatusApproved {
		return nil, errors.New("只有已审核通过的资源可以上架")
	}
	res.Status = model.ResourceStatusPublished
	if err := s.rep.Update(res); err != nil {
		return nil, err
	}
	return res, nil
}
