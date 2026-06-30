package service

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"flovart/hub/storage"
)

type UploadService struct {
	r2 *storage.R2Client
}

func NewUploadService(r2 *storage.R2Client) *UploadService {
	return &UploadService{r2: r2}
}

// PresignInput 请求预签名 PUT URL 的入参
type PresignInput struct {
	Filename    string // 原始文件名，仅用于推断扩展名
	ContentType string // MIME，如 image/png、video/mp4
	Purpose     string // 用途：prompt_cover / workflow_showcase / avatar 等
}

// PresignResult 返回给前端的预签名信息
type PresignResult struct {
	Key       string `json:"key"`
	PutURL    string `json:"putUrl"`
	PublicURL string `json:"publicUrl"`
	Expires   int64  `json:"expiresAt"` // unix 秒
}

// Presign 生成上传 key 并预签名 PUT URL
func (s *UploadService) Presign(ctx context.Context, uploaderID string, in PresignInput) (*PresignResult, error) {
	if s.r2 == nil {
		return nil, fmt.Errorf("存储未配置")
	}
	ext := strings.ToLower(path.Ext(strings.TrimSpace(in.Filename)))
	if ext == "" {
		// 没有 ext 时按 contentType 兜底
		switch {
		case strings.HasPrefix(in.ContentType, "image/png"):
			ext = ".png"
		case strings.HasPrefix(in.ContentType, "image/jpeg"):
			ext = ".jpg"
		case strings.HasPrefix(in.ContentType, "image/webp"):
			ext = ".webp"
		case strings.HasPrefix(in.ContentType, "video/mp4"):
			ext = ".mp4"
		case strings.HasPrefix(in.ContentType, "video/webm"):
			ext = ".webm"
		}
	}
	purpose := sanitizePurpose(in.Purpose)
	key := fmt.Sprintf("uploads/%s/%s/%s%s", purpose, time.Now().UTC().Format("2006/01/02"), uuid.NewString(), ext)
	putURL, err := s.r2.PresignPut(ctx, key, in.ContentType)
	if err != nil {
		return nil, fmt.Errorf("生成上传地址失败：%w", err)
	}
	return &PresignResult{
		Key:       key,
		PutURL:    putURL,
		PublicURL: s.r2.PublicURL(key),
		Expires:   time.Now().Add(15 * time.Minute).Unix(),
	}, nil
}

// ConfirmUpload 校验对象真实存在于 R2 后返回最终可访问 URL
func (s *UploadService) ConfirmUpload(ctx context.Context, key string) (string, error) {
	if s.r2 == nil {
		return "", fmt.Errorf("存储未配置")
	}
	if _, _, err := s.r2.HeadObject(ctx, key); err != nil {
		return "", fmt.Errorf("对象不存在或无法访问：%w", err)
	}
	return s.r2.PublicURL(key), nil
}

func sanitizePurpose(p string) string {
	p = strings.ToLower(strings.TrimSpace(p))
	switch p {
	case "prompt_cover", "workflow_showcase", "avatar", "workflow_media":
		return p
	}
	return "misc"
}