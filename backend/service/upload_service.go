package service

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"flovart/hub/apperr"
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

// uploadExtensions 扩展名完全由白名单 MIME 决定，不信任客户端文件名
// （旧实现取文件名扩展，可得到 .html 或含 ?#空格 的 key，破坏公开 URL）
var uploadExtensions = map[string]string{
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"video/mp4":       ".mp4",
	"video/webm":      ".webm",
	"audio/mpeg":      ".mp3",
	"audio/wav":       ".wav",
	"audio/mp4":       ".m4a",
	"application/pdf": ".pdf",
}

// uploadKeyRe 合法上传 key：uploads/<purpose>/<uploaderID>/<yyyy>/<mm>/<dd>/<uuid><ext>
var uploadKeyRe = regexp.MustCompile(`^uploads/([a-z_]+)/([0-9a-f-]{36})/\d{4}/\d{2}/\d{2}/[0-9a-f-]{36}\.[a-z0-9]{2,5}$`)

const presignTTL = 15 * time.Minute

// Presign 生成上传 key 并预签名 PUT URL
func (s *UploadService) Presign(ctx context.Context, uploaderID string, in PresignInput) (*PresignResult, error) {
	if s.r2 == nil {
		return nil, apperr.New(503, "存储未配置")
	}
	contentType := normalizeContentType(in.ContentType)
	if !allowedUploadContentTypes[contentType] {
		return nil, apperr.BadRequest(fmt.Sprintf("不支持的文件类型：%s", in.ContentType))
	}
	if in.SizeBytes < 0 {
		return nil, apperr.BadRequest("文件大小不合法")
	}
	if limit := uploadSizeLimit(contentType); in.SizeBytes > limit {
		return nil, apperr.BadRequest(fmt.Sprintf("文件大小超过上限（%dMB）", limit>>20))
	}
	purpose := sanitizePurpose(in.Purpose)
	key := buildUploadKey(purpose, uploaderID, time.Now().UTC(), uuid.NewString(), uploadExtensions[contentType])
	putURL, err := s.r2.PresignPut(ctx, key, contentType, presignTTL)
	if err != nil {
		return nil, fmt.Errorf("presign put: %w", err)
	}
	return &PresignResult{
		Key:       key,
		PutURL:    putURL,
		PublicURL: s.r2.PublicURL(key),
		Expires:   time.Now().Add(presignTTL).Unix(),
	}, nil
}

func buildUploadKey(purpose, uploaderID string, now time.Time, id, ext string) string {
	return fmt.Sprintf("uploads/%s/%s/%s/%s%s", purpose, strings.ToLower(uploaderID), now.Format("2006/01/02"), id, ext)
}

// uploadKeyOwner 校验 key 格式并返回其中的上传者 ID；格式非法返回 false
func uploadKeyOwner(key string) (string, bool) {
	m := uploadKeyRe.FindStringSubmatch(key)
	if m == nil {
		return "", false
	}
	return m[2], true
}

// normalizeContentType 去掉参数（如 "; charset=..."）并小写
func normalizeContentType(ct string) string {
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	return strings.ToLower(strings.TrimSpace(ct))
}

// ConfirmUpload 校验 key 属于当前用户、对象真实存在、类型在白名单且大小未超限后返回最终可访问 URL。
// 旧实现不校验 key 归属：任何登录用户都可探测桶内任意对象，甚至让服务端删除他人的超限对象。
func (s *UploadService) ConfirmUpload(ctx context.Context, uploaderID, key string) (string, error) {
	if s.r2 == nil {
		return "", apperr.New(503, "存储未配置")
	}
	owner, ok := uploadKeyOwner(key)
	if !ok {
		return "", apperr.BadRequest("key 格式不正确")
	}
	if owner != strings.ToLower(uploaderID) {
		return "", apperr.Forbidden("无权确认该上传")
	}
	size, contentType, err := s.r2.HeadObject(ctx, key)
	if err != nil {
		return "", apperr.NotFound("对象不存在或尚未上传完成")
	}
	contentType = normalizeContentType(contentType)
	if !allowedUploadContentTypes[contentType] {
		_ = s.r2.DeleteObject(ctx, key)
		return "", apperr.BadRequest("文件类型不合法，已拒绝")
	}
	if size > uploadSizeLimit(contentType) {
		_ = s.r2.DeleteObject(ctx, key) // 超限对象不暴露，尽力清理
		return "", apperr.BadRequest("文件大小超过上限，已拒绝")
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
