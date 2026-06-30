package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awscfg "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Client Cloudflare R2 (S3 兼容) 客户端封装
type R2Client struct {
	svc        *s3.Client
	presigner  *s3.PresignClient
	bucket     string
	publicBase string
}

// NewR2Client 从 config 构建 R2 客户端
func NewR2Client(ctx context.Context, accountID, accessKey, secretKey, bucket, publicBase string) (*R2Client, error) {
	if accountID == "" || accessKey == "" || secretKey == "" || bucket == "" {
		return nil, errors.New("R2 配置不完整")
	}
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)
	cfg, err := awscfg.LoadDefaultConfig(ctx,
		awscfg.WithRegion("auto"),
		awscfg.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		return nil, err
	}
	svc := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = true
	})
	return &R2Client{
		svc:        svc,
		presigner:  s3.NewPresignClient(svc),
		bucket:     bucket,
		publicBase: publicBase,
	}, nil
}

// PutObject 直传字节流到 R2，返回可通过 publicBase 访问的 URL
func (c *R2Client) PutObject(ctx context.Context, key string, contentType string, data []byte) (string, error) {
	if c == nil {
		return "", errors.New("R2 client 未初始化")
	}
	_, err := c.svc.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", err
	}
	return c.PublicURL(key), nil
}

// PresignPut 生成预签名 PUT URL，前端直传用；默认 15 分钟过期
func (c *R2Client) PresignPut(ctx context.Context, key, contentType string) (string, error) {
	if c == nil {
		return "", errors.New("R2 client 未初始化")
	}
	req, err := c.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(c.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}, s3.WithPresignExpires(15*time.Minute))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

// PresignGet 生成预签名 GET URL，访问私有对象用；默认 1 小时过期
func (c *R2Client) PresignGet(ctx context.Context, key string) (string, error) {
	if c == nil {
		return "", errors.New("R2 client 未初始化")
	}
	req, err := c.presigner.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(time.Hour))
	if err != nil {
		return "", err
	}
	return req.URL, nil
}

// DeleteObject 删除对象
func (c *R2Client) DeleteObject(ctx context.Context, key string) error {
	if c == nil {
		return errors.New("R2 client 未初始化")
	}
	_, err := c.svc.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	return err
}

// HeadObject 探测对象是否存在与元信息
func (c *R2Client) HeadObject(ctx context.Context, key string) (int64, string, error) {
	if c == nil {
		return 0, "", errors.New("R2 client 未初始化")
	}
	out, err := c.svc.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return 0, "", err
	}
	size := 0
	if out.ContentLength != nil {
		size = int(*out.ContentLength)
	}
	ct := ""
	if out.ContentType != nil {
		ct = *out.ContentType
	}
	return int64(size), ct, nil
}

// PublicURL 拼出公开访问 URL；如果 publicBase 为空则返回空字符串
func (c *R2Client) PublicURL(key string) string {
	if c == nil || c.publicBase == "" {
		return ""
	}
	base := c.publicBase
	// strings.TrimSuffix 也行；这里手写避免额外 import
	if base[len(base)-1] == '/' {
		return base + key
	}
	return base + "/" + key
}

// DetectContentType 简单 Content-Type 嗅探（fallback）
func DetectContentType(data []byte) string {
	return http.DetectContentType(data)
}