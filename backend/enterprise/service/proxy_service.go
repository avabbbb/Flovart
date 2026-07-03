package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"gorm.io/gorm"
	"flovart/enterprise/model"
	"flovart/enterprise/repository"
)

type ProxyService struct {
	db      *gorm.DB
	keys    *repository.ApiKeyRepository
	credits *repository.CreditRepository
	creditSvc *CreditService
	apiKeySvc *ApiKeyService
}

func NewProxyService(db *gorm.DB, keys *repository.ApiKeyRepository, credits *repository.CreditRepository, creditSvc *CreditService, apiKeySvc *ApiKeyService) *ProxyService {
	return &ProxyService{db: db, keys: keys, credits: credits, creditSvc: creditSvc, apiKeySvc: apiKeySvc}
}

type ProxyRequest struct {
	Provider string          `json:"provider" binding:"required"`
	Model    string          `json:"model" binding:"required"`
	Mode     string          `json:"mode" binding:"required"`
	Endpoint string          `json:"endpoint" binding:"required"`
	Body     json.RawMessage `json:"body" binding:"required"`
}

type ProxyResult struct {
	StatusCode int             `json:"statusCode"`
	Body       json.RawMessage `json:"body"`
	UsageID    string          `json:"usageId,omitempty"`
}

// Forward 核心代理逻辑：
// 1. 解析 provider/model/mode/endpoint/body
// 2. 查 org 的 enabled API Key
// 3. 查 model 定价
// 4. 检查余额 + 成员额度
// 5. 转发 HTTP 请求到上游
// 6. 成功：扣积分 + 写 usage
// 7. 失败：写 failed usage（不扣积分）
func (s *ProxyService) Forward(orgID, userID string, req ProxyRequest) (*ProxyResult, error) {
	// 1. 解析 API Key
	key, err := s.apiKeySvc.ResolveKeyForProxy(orgID, req.Provider)
	if err != nil {
		return nil, fmt.Errorf("无可用 API Key: %w", err)
	}

	// 2. 查定价
	pricing, _ := s.keys.FindPricing(orgID, req.Provider, req.Model)
	cost := int64(1) // 默认 1 积分
	if pricing != nil && pricing.Enabled {
		cost = pricing.CostCredits
	}

	// 3. 检查余额
	credit, err := s.credits.GetOrCreateCredit(orgID)
	if err != nil {
		return nil, fmt.Errorf("查询积分失败: %w", err)
	}
	if credit.Balance < cost {
		return nil, errors.New("积分余额不足")
	}

	// 4. 检查成员额度
	ok, used, limit, err := s.apiKeySvc.CheckQuota(orgID, userID, cost)
	if err != nil {
		return nil, fmt.Errorf("查询额度失败: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("成员月度额度已超：已用 %d / 上限 %d", used, limit)
	}

	// 5. 构造上游请求
	baseURL := key.BaseURL
	if baseURL == "" {
		baseURL = defaultBaseURL(req.Provider)
	}
	upstreamURL := baseURL + req.Endpoint

	httpReq, err := http.NewRequest("POST", upstreamURL, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("构造上游请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+key.APIKey)

	client := &http.Client{Timeout: 120 * time.Second}
	start := time.Now()
	resp, err := client.Do(httpReq)
	duration := time.Since(start).Milliseconds()
	if err != nil {
		s.recordFailedUsage(orgID, userID, req, cost, duration, err.Error())
		return nil, fmt.Errorf("上游请求失败: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		s.recordFailedUsage(orgID, userID, req, cost, duration, "读取响应失败")
		return nil, errors.New("读取上游响应失败")
	}

	// 6. 成功：扣积分 + 写 usage
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		usage := &model.UsageRecord{
			OrgID:       orgID,
			UserID:      userID,
			Provider:    req.Provider,
			Endpoint:    req.Endpoint,
			Model:       req.Model,
			Mode:        req.Mode,
			CostCredits: cost,
			DurationMs:  duration,
			Status:      model.UsageStatusSuccess,
		}
		if err := s.creditSvc.ConsumeCredits(orgID, userID, usage); err != nil {
			// 扣分失败不阻塞返回，但记录错误
			usage.ErrorMsg = "扣分失败: " + err.Error()
		}
		return &ProxyResult{
			StatusCode: resp.StatusCode,
			Body:       bodyBytes,
			UsageID:    usage.ID,
		}, nil
	}

	// 7. 上游返回非 2xx：记录失败，不扣分
	s.recordFailedUsage(orgID, userID, req, 0, duration, fmt.Sprintf("上游 %d: %s", resp.StatusCode, string(bodyBytes[:minInt(len(bodyBytes), 200)])))
	return &ProxyResult{
		StatusCode: resp.StatusCode,
		Body:       bodyBytes,
	}, nil
}

func (s *ProxyService) recordFailedUsage(orgID, userID string, req ProxyRequest, cost int64, duration int64, errMsg string) {
	usage := &model.UsageRecord{
		OrgID:       orgID,
		UserID:      userID,
		Provider:    req.Provider,
		Endpoint:    req.Endpoint,
		Model:       req.Model,
		Mode:        req.Mode,
		CostCredits: 0,
		DurationMs:  duration,
		Status:      model.UsageStatusFailed,
		ErrorMsg:    errMsg,
	}
	s.credits.CreateUsage(usage)
}

func defaultBaseURL(provider string) string {
	switch provider {
	case "openai":
		return "https://api.openai.com"
	case "anthropic":
		return "https://api.anthropic.com"
	default:
		return ""
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
