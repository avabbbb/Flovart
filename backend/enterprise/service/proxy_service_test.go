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
		{"https://www.runninghub.cn", "/openapi/v2/rhart-image-g-2/text-to-image", "https://www.runninghub.cn/openapi/v2/rhart-image-g-2/text-to-image"},
		{"https://www.runninghub.cn/openapi/v2", "/openapi/v2/rhart-image-g-2/text-to-image", "https://www.runninghub.cn/openapi/v2/rhart-image-g-2/text-to-image"},
		{"https://gateway.example.com/api", "/v1/responses", "https://gateway.example.com/api/v1/responses"},
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
