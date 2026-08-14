package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"flovart/enterprise/model"
	"flovart/enterprise/repository"
	"gorm.io/gorm"
)

type ProxyService struct {
	db        *gorm.DB
	keys      *repository.ApiKeyRepository
	credits   *repository.CreditRepository
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

// Forward 核心代理逻辑：鉴权在 handler/middleware 完成；这里做 provider/path 校验、额度检查、上游请求与扣费。
func (s *ProxyService) Forward(orgID, userID string, req ProxyRequest) (*ProxyResult, error) {
	normalized, err := normalizeProxyRequest(req)
	if err != nil {
		return nil, err
	}
	req = normalized

	key, err := s.apiKeySvc.ResolveKeyForProxy(orgID, req.Provider)
	if err != nil {
		return nil, fmt.Errorf("无可用 API Key: %w", err)
	}

	pricing, _ := s.keys.FindPricing(orgID, req.Provider, req.Model)
	cost := int64(1)
	if pricing != nil && pricing.Enabled {
		cost = pricing.CostCredits
	}

	credit, err := s.credits.GetOrCreateCredit(orgID)
	if err != nil {
		return nil, fmt.Errorf("查询积分失败: %w", err)
	}
	if credit.Balance < cost {
		return nil, errors.New("积分余额不足")
	}

	ok, used, limit, err := s.apiKeySvc.CheckQuota(orgID, userID, cost)
	if err != nil {
		return nil, fmt.Errorf("查询额度失败: %w", err)
	}
	if !ok {
		return nil, fmt.Errorf("成员月度额度已超：已用 %d / 上限 %d", used, limit)
	}

	baseURL := strings.TrimRight(key.BaseURL, "/")
	if baseURL == "" {
		baseURL = defaultBaseURL(req.Provider)
	}
	upstreamURL, err := buildUpstreamURL(baseURL, req.Endpoint)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequest("POST", upstreamURL, bytes.NewReader(req.Body))
	if err != nil {
		return nil, fmt.Errorf("构造上游请求失败: %w", err)
	}
	applyProviderHeaders(httpReq, req.Provider, key.APIKey)

	client := &http.Client{Timeout: 120 * time.Second}
	start := time.Now()
	resp, err := client.Do(httpReq)
	duration := time.Since(start).Milliseconds()
	if err != nil {
		s.recordFailedUsage(orgID, userID, req, duration, err.Error())
		return nil, fmt.Errorf("上游请求失败: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		s.recordFailedUsage(orgID, userID, req, duration, "读取响应失败")
		return nil, errors.New("读取上游响应失败")
	}

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
			return nil, fmt.Errorf("扣分失败: %w", err)
		}
		return &ProxyResult{StatusCode: resp.StatusCode, Body: bodyBytes, UsageID: usage.ID}, nil
	}

	s.recordFailedUsage(orgID, userID, req, duration, fmt.Sprintf("上游 %d: %s", resp.StatusCode, string(bodyBytes[:minInt(len(bodyBytes), 200)])))
	return &ProxyResult{StatusCode: resp.StatusCode, Body: bodyBytes}, nil
}

func normalizeProxyRequest(req ProxyRequest) (ProxyRequest, error) {
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	if req.Provider == "runninghub" || req.Provider == "running_hub" {
		req.Provider = "runninghub"
	}
	req.Model = strings.TrimSpace(req.Model)
	req.Mode = strings.ToLower(strings.TrimSpace(req.Mode))
	req.Endpoint = strings.TrimSpace(req.Endpoint)
	if req.Provider == "" || req.Model == "" || req.Mode == "" || len(req.Body) == 0 {
		return req, errors.New("provider/model/mode/body 不能为空")
	}
	if err := validateProviderEndpoint(req.Provider, req.Endpoint); err != nil {
		return req, err
	}
	return req, nil
}

func validateProviderEndpoint(provider, endpoint string) error {
	if endpoint == "" || !strings.HasPrefix(endpoint, "/") || strings.Contains(endpoint, "://") || strings.Contains(endpoint, "..") || strings.ContainsAny(endpoint, "?#") {
		return errors.New("endpoint 不合法")
	}
	exact := map[string]map[string]bool{
		"openai": {
			"/v1/chat/completions":   true,
			"/v1/responses":          true,
			"/v1/images/generations": true,
			"/v1/images/edits":       true,
		},
		"anthropic": {
			"/v1/messages": true,
		},
		"volcengine": {
			"/contents/generations/tasks": true,
		},
		"custom": {
			"/v1/chat/completions":        true,
			"/v1/responses":               true,
			"/v1/images/generations":      true,
			"/v1/images/edits":            true,
			"/contents/generations/tasks": true,
		},
		"openai_compatible": {
			"/v1/chat/completions":   true,
			"/v1/responses":          true,
			"/v1/images/generations": true,
			"/v1/images/edits":       true,
		},
	}
	if allowed, ok := exact[provider]; ok {
		if allowed[endpoint] {
			return nil
		}
		return fmt.Errorf("provider %s 不允许转发 endpoint %s", provider, endpoint)
	}
	if provider == "runninghub" {
		if strings.HasPrefix(endpoint, "/openapi/v2/") {
			return nil
		}
		return fmt.Errorf("provider runninghub 不允许转发 endpoint %s", endpoint)
	}
	return fmt.Errorf("暂不支持 provider: %s", provider)
}

// isBlockedIP 判断 IP 是否属于不可访问的地址段（回环/内网/链路本地/云元数据/组播）
func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	// IPv4-mapped IPv6（::ffff:192.168.x.x）还原为 IPv4 再判断
	if v4 := ip.To4(); v4 != nil {
		return v4.IsLoopback() || v4.IsPrivate() || v4.IsLinkLocalUnicast() || v4.IsUnspecified() || v4.IsMulticast()
	}
	return false
}

func validateBaseURL(baseURL string) error {
	if baseURL == "" {
		return errors.New("baseURL 未配置")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("baseURL 不合法")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("baseURL 只允许 http/https")
	}
	host := parsed.Hostname()
	lowerHost := strings.ToLower(host)
	if lowerHost == "localhost" || strings.HasSuffix(lowerHost, ".local") || lowerHost == "metadata.google.internal" {
		return errors.New("baseURL 不允许指向本机或本地网络")
	}
	// 解析主机并拒绝内网/回环/链路本地/云元数据地址，防止 SSRF
	ips, err := net.LookupIP(host)
	if err != nil || len(ips) == 0 {
		return errors.New("baseURL 主机无法解析")
	}
	for _, ip := range ips {
		if isBlockedIP(ip) {
			return errors.New("baseURL 不允许指向内网/回环/链路本地地址")
		}
	}
	return nil
}

func buildUpstreamURL(baseURL, endpoint string) (string, error) {
	if err := validateBaseURL(baseURL); err != nil {
		return "", err
	}
	parsed, _ := url.Parse(strings.TrimRight(baseURL, "/"))
	basePath := strings.TrimRight(parsed.Path, "/")
	if basePath != "" && (endpoint == basePath || strings.HasPrefix(endpoint, basePath+"/")) {
		parsed.Path = endpoint
	} else {
		parsed.Path = basePath + endpoint
	}
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func applyProviderHeaders(req *http.Request, provider, apiKey string) {
	req.Header.Set("Content-Type", "application/json")
	switch provider {
	case "anthropic":
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

func (s *ProxyService) recordFailedUsage(orgID, userID string, req ProxyRequest, duration int64, errMsg string) {
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
	_ = s.credits.CreateUsage(usage)
}

func defaultBaseURL(provider string) string {
	switch provider {
	case "openai":
		return "https://api.openai.com"
	case "anthropic":
		return "https://api.anthropic.com"
	case "runninghub":
		return "https://www.runninghub.cn"
	case "volcengine":
		return "https://ark.cn-beijing.volces.com/api/v3"
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
