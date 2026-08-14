package service

import (
	"context"
	"fmt"
	"path"
	"strings"
	"time"

	"flovart/hub/storage"
	"github.com/google/uuid"
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
	SizeBytes   int64  // 客户端声明的文件大小，用于预检上限（0 表示未知）
}

// PresignResult 返回给前端的预签名信息
type PresignResult struct {
	Key       string `json:"key"`
	PutURL    string `json:"putUrl"`
	PublicURL string `json:"publicUrl"`
	Expires   int64  `json:"expiresAt"` // unix 秒
}

// allowedUploadContentTypes 上传 MIME 白名单，防 text/html 等存储型 XSS
var allowedUploadContentTypes = map[string]bool{
	"image/png":       true,
	"image/jpeg":      true,
	"image/webp":      true,
	"image/gif":       true,
	"video/mp4":       true,
	"video/webm":      true,
	"audio/mpeg":      true,
	"audio/wav":       true,
	"audio/mp4":       true,
	"application/pdf": true,
}

const (
	maxUploadImageSize = 20 << 20  // 20MB
	maxUploadVideoSize = 500 << 20 // 500MB
	maxUploadAudioSize = 100 << 20 // 100MB
	maxUploadOtherSize = 50 << 20  // 50MB
)

// uploadSizeLimit 按 MIME 主类型返回大小上限
func uploadSizeLimit(contentType string) int64 {
	switch {
	case strings.HasPrefix(contentType, "image/"):
		return maxUploadImageSize
	case strings.HasPrefix(contentType, "video/"):
		return maxUploadVideoSize
	case strings.HasPrefix(contentType, "audio/"):
		return maxUploadAudioSize
	default:
		return maxUploadOtherSize
	}
}

// Presign 生成上传 key 并预签名 PUT URL
func (s *UploadService) Presign(ctx context.Context, uploaderID string, in PresignInput) (*PresignResult, error) {
	if s.r2 == nil {
		return nil, fmt.Errorf("存储未配置")
	}
	contentType := strings.ToLower(strings.TrimSpace(in.ContentType))
	if !allowedUploadContentTypes[contentType] {
		return nil, fmt.Errorf("不支持的文件类型：%s", in.ContentType)
	}
	if in.SizeBytes > 0 {
		limit := uploadSizeLimit(contentType)
		if in.SizeBytes > limit {
			return nil, fmt.Errorf("文件大小超过上限（%dMB）", limit>>20)
		}
	}
	ext := strings.ToLower(path.Ext(strings.TrimSpace(in.Filename)))
	if ext == "" {
		// 没有 ext 时按 contentType 兜底
		switch {
		case strings.HasPrefix(contentType, "image/png"):
			ext = ".png"
		case strings.HasPrefix(contentType, "image/jpeg"):
			ext = ".jpg"
		case strings.HasPrefix(contentType, "image/webp"):
			ext = ".webp"
		case strings.HasPrefix(contentType, "video/mp4"):
			ext = ".mp4"
		case strings.HasPrefix(contentType, "video/webm"):
			ext = ".webm"
		}
	}
	purpose := sanitizePurpose(in.Purpose)
	key := fmt.Sprintf("uploads/%s/%s/%s%s", purpose, time.Now().UTC().Format("2006/01/02"), uuid.NewString(), ext)
	putURL, err := s.r2.PresignPut(ctx, key, contentType)
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

// ConfirmUpload 校验对象真实存在于 R2 且大小未超限后返回最终可访问 URL
func (s *UploadService) ConfirmUpload(ctx context.Context, key string) (string, error) {
	if s.r2 == nil {
		return "", fmt.Errorf("存储未配置")
	}
	size, contentType, err := s.r2.HeadObject(ctx, key)
	if err != nil {
		return "", fmt.Errorf("对象不存在或无法访问：%w", err)
	}
	if size > uploadSizeLimit(contentType) {
		_ = s.r2.DeleteObject(ctx, key) // 超限对象不暴露，尽力清理
		return "", fmt.Errorf("文件大小超过上限，已拒绝")
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
