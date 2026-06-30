package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	Port           string
	DatabaseURL    string
	JWTSecret      string
	JWTExpHours    string
	CORSAllow      string
	Storage        StorageConfig
}

type StorageConfig struct {
	Provider    string // "r2"
	AccountID   string
	AccessKey   string
	SecretKey   string
	Bucket      string
	PublicBase  string
}

func Load() (*Config, error) {
	_ = godotenv.Load()
	cfg := &Config{
		Port:        env("PORT", "8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		JWTSecret:   env("JWT_SECRET", ""),
		JWTExpHours: env("JWT_EXP_HOURS", "168"),
		CORSAllow:   env("CORS_ALLOW", "*"),
		Storage: StorageConfig{
			Provider:   env("STORAGE_PROVIDER", "r2"),
			AccountID:  os.Getenv("R2_ACCOUNT_ID"),
			AccessKey:  os.Getenv("R2_ACCESS_KEY"),
			SecretKey:  os.Getenv("R2_SECRET_KEY"),
			Bucket:     os.Getenv("R2_BUCKET"),
			PublicBase: os.Getenv("R2_PUBLIC_BASE"),
		},
	}
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.JWTSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	// R2 为可选：未配置 account_id 时 Storage 保持空，UploadService 会返回"存储未配置"
	return cfg, nil
}

// StorageReady 判断 R2 配置是否完整可用
func (c *Config) StorageReady() bool {
	return c.Storage.AccountID != "" && c.Storage.AccessKey != "" &&
		c.Storage.SecretKey != "" && c.Storage.Bucket != ""
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}