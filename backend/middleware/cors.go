package middleware

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	corsMethods = "GET, POST, PUT, DELETE, OPTIONS"
	corsHeaders = "Content-Type, Authorization"
)

// CORS 根据 CORS_ALLOW 配置输出跨域头：
//   - "loopback"：仅放行回环与 Tauri WebView 来源（开发端口动态，无法写死白名单）
//   - "*"：通配，不回显 Origin、不携带凭据
//   - ""/"off"：不输出任何 CORS 头
//   - 其余：逗号分隔的 Origin 白名单，精确匹配后回显并携带凭据
func CORS(allow string) gin.HandlerFunc {
	allow = strings.ToLower(strings.TrimSpace(allow))
	whitelist := map[string]bool{}
	for _, o := range strings.Split(allow, ",") {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			whitelist[o] = true
		}
	}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		h := c.Writer.Header()
		echo := func() {
			h.Set("Access-Control-Allow-Origin", origin)
			h.Set("Access-Control-Allow-Methods", corsMethods)
			h.Set("Access-Control-Allow-Headers", corsHeaders)
			h.Set("Access-Control-Allow-Credentials", "true")
		}
		switch allow {
		case "", "off":
		case "*":
			h.Set("Access-Control-Allow-Origin", "*")
			h.Set("Access-Control-Allow-Methods", corsMethods)
			h.Set("Access-Control-Allow-Headers", corsHeaders)
		case "loopback":
			h.Add("Vary", "Origin")
			if IsLoopbackOrigin(origin) {
				echo()
			}
		default:
			h.Add("Vary", "Origin")
			if origin != "" && whitelist[strings.ToLower(origin)] {
				echo()
			}
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// IsLoopbackOrigin 判断 Origin 是否为本机回环或 Tauri WebView 来源。
// tauri://localhost（macOS/Linux WebView）与 http://tauri.localhost（Windows）
// 都是桌面壳的本地来源；其余非回环来源一律不放行。
func IsLoopbackOrigin(origin string) bool {
	u, err := url.Parse(strings.ToLower(origin))
	if err != nil || u.Host == "" {
		return false
	}
	host := u.Hostname()
	if u.Scheme == "tauri" {
		return host == "localhost"
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	switch host {
	case "localhost", "127.0.0.1", "::1", "tauri.localhost":
		return true
	}
	return false
}

// BodyLimit 限制请求体大小，超限时读取会失败并以 400 结束绑定
func BodyLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}
