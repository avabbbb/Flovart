package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-test-secret-test-secret"

type fakeReader struct {
	status string
	ver    int64
	err    error
}

func (f fakeReader) SessionState(context.Context, string) (string, int64, error) {
	return f.status, f.ver, f.err
}

func sign(t *testing.T, ver int64, exp time.Duration) string {
	t.Helper()
	claims := userClaims{TokenVersion: ver, RegisteredClaims: jwt.RegisteredClaims{
		Subject: "11111111-1111-1111-1111-111111111111", Audience: jwt.ClaimStrings{"user"},
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(exp)),
	}}
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func runAuth(reader AccountSessionReader, header string) int {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/", Auth(testSecret, reader), func(c *gin.Context) { c.Status(http.StatusOK) })
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		req.Header.Set("Authorization", header)
	}
	r.ServeHTTP(w, req)
	return w.Code
}

func TestAuth(t *testing.T) {
	ok := fakeReader{status: "active", ver: 1}
	cases := []struct {
		name   string
		reader AccountSessionReader
		header string
		want   int
	}{
		{"missing", ok, "", 401},
		{"valid", ok, "Bearer " + sign(t, 1, time.Hour), 200},
		{"lowercase scheme", ok, "bearer " + sign(t, 1, time.Hour), 200},
		{"expired", ok, "Bearer " + sign(t, 1, -time.Hour), 401},
		{"version bumped", fakeReader{status: "active", ver: 2}, "Bearer " + sign(t, 1, time.Hour), 401},
		{"suspended", fakeReader{status: "suspended", ver: 1}, "Bearer " + sign(t, 1, time.Hour), 401},
		{"user gone", fakeReader{}, "Bearer " + sign(t, 1, time.Hour), 401},
		{"db down is not logout", fakeReader{err: errors.New("db down")}, "Bearer " + sign(t, 1, time.Hour), 503},
		{"garbage", ok, "Bearer abc.def.ghi", 401},
	}
	for _, tc := range cases {
		if got := runAuth(tc.reader, tc.header); got != tc.want {
			t.Errorf("%s: got %d want %d", tc.name, got, tc.want)
		}
	}
}

func doCORS(allow, origin, method string) (http.Header, int) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(CORS(allow))
	r.GET("/", func(c *gin.Context) { c.Status(http.StatusOK) })
	w := httptest.NewRecorder()
	req := httptest.NewRequest(method, "/", nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	r.ServeHTTP(w, req)
	return w.Header(), w.Code
}

func TestCORS(t *testing.T) {
	h, _ := doCORS("*", "https://evil.example", http.MethodGet)
	if h.Get("Access-Control-Allow-Origin") != "*" || h.Get("Access-Control-Allow-Credentials") != "" {
		t.Errorf("wildcard: %v", h)
	}
	h, _ = doCORS("https://a.example, https://b.example", "https://b.example", http.MethodGet)
	if h.Get("Access-Control-Allow-Origin") != "https://b.example" || h.Get("Vary") != "Origin" {
		t.Errorf("whitelist list: %v", h)
	}
	h, _ = doCORS("https://a.example", "https://evil.example", http.MethodGet)
	if h.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("whitelist reject: %v", h)
	}
	h, code := doCORS("loopback", "http://localhost:5173", http.MethodOptions)
	if h.Get("Access-Control-Allow-Origin") != "http://localhost:5173" || code != http.StatusNoContent {
		t.Errorf("loopback preflight: %v %d", h, code)
	}
	h, _ = doCORS("off", "http://localhost:5173", http.MethodGet)
	if h.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("off: %v", h)
	}
}

func TestIsLoopbackOrigin(t *testing.T) {
	for o, want := range map[string]bool{
		"http://localhost:3000": true, "http://127.0.0.1": true, "tauri://localhost": true,
		"http://tauri.localhost": true, "http://localhost.evil.com": false, "https://example.com": false,
		"file://localhost": false, "": false,
	} {
		if got := IsLoopbackOrigin(o); got != want {
			t.Errorf("%q: got %v", o, got)
		}
	}
}
