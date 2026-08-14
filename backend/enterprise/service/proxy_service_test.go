package service

import (
	"encoding/json"
	"testing"
)

func TestNormalizeProxyRequestAllowsVideoProviders(t *testing.T) {
	cases := []ProxyRequest{
		{Provider: "runningHub", Model: "nano-banana-pro", Mode: "video", Endpoint: "/openapi/v2/nano-banana-pro/edit-channel-low-price", Body: json.RawMessage(`{}`)},
		{Provider: "volcengine", Model: "seedance-2-0-pro", Mode: "video", Endpoint: "/contents/generations/tasks", Body: json.RawMessage(`{}`)},
	}
	for _, tc := range cases {
		normalized, err := normalizeProxyRequest(tc)
		if err != nil {
			t.Fatalf("normalizeProxyRequest(%s) returned error: %v", tc.Provider, err)
		}
		if normalized.Provider != "runninghub" && normalized.Provider != "volcengine" {
			t.Fatalf("unexpected provider normalization: %q", normalized.Provider)
		}
	}
}

func TestNormalizeProxyRequestRejectsUnsafeEndpoint(t *testing.T) {
	cases := []string{
		"https://evil.example/v1/chat/completions",
		"/../admin",
		"/v1/chat/completions?debug=true",
		"/v1/unknown",
	}
	for _, endpoint := range cases {
		_, err := normalizeProxyRequest(ProxyRequest{
			Provider: "openai",
			Model:    "gpt-4.1",
			Mode:     "text",
			Endpoint: endpoint,
			Body:     json.RawMessage(`{}`),
		})
		if err == nil {
			t.Fatalf("endpoint %q should be rejected", endpoint)
		}
	}
}

func TestBuildUpstreamURLDoesNotDuplicateConfiguredProviderPath(t *testing.T) {
	cases := []struct {
		baseURL  string
		endpoint string
		want     string
	}{
		{"https://203.0.113.10", "/openapi/v2/rhart-image-g-2/text-to-image", "https://203.0.113.10/openapi/v2/rhart-image-g-2/text-to-image"},
		{"https://203.0.113.10/openapi/v2", "/openapi/v2/rhart-image-g-2/text-to-image", "https://203.0.113.10/openapi/v2/rhart-image-g-2/text-to-image"},
		{"https://203.0.113.10/api", "/v1/responses", "https://203.0.113.10/api/v1/responses"},
	}
	for _, tc := range cases {
		got, err := buildUpstreamURL(tc.baseURL, tc.endpoint)
		if err != nil {
			t.Fatalf("buildUpstreamURL(%q, %q) returned error: %v", tc.baseURL, tc.endpoint, err)
		}
		if got != tc.want {
			t.Fatalf("buildUpstreamURL(%q, %q) = %q, want %q", tc.baseURL, tc.endpoint, got, tc.want)
		}
	}
}

// TestValidateBaseURLBlocksPrivateTargets SSRF 防线：回环/内网/链路本地/云元数据一律拒绝
func TestValidateBaseURLBlocksPrivateTargets(t *testing.T) {
	blocked := []string{
		"http://127.0.0.1:8080",
		"http://localhost:11452",
		"http://10.0.0.5/api",
		"http://192.168.1.1/api",
		"http://172.16.0.1/api",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]:8080",
		"http://metadata.google.internal/computeMetadata/v1/",
		"http://0.0.0.0/api",
	}
	for _, base := range blocked {
		if err := validateBaseURL(base); err == nil {
			t.Fatalf("validateBaseURL(%q) should be blocked, got nil", base)
		}
	}
	allowed := []string{
		"https://203.0.113.10/api",
		"https://203.0.113.10/openapi/v2",
	}
	for _, base := range allowed {
		if err := validateBaseURL(base); err != nil {
			t.Fatalf("validateBaseURL(%q) should pass, got %v", base, err)
		}
	}
}
