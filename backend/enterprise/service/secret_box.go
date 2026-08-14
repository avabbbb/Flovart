package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"strings"
)

const encryptedSecretPrefix = "v1:"

func encryptSecret(plain string) (string, error) {
	secret, err := keyEncryptionSecret()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(secret)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return encryptedSecretPrefix + base64.RawURLEncoding.EncodeToString(sealed), nil
}

func decryptSecret(value string) (string, error) {
	if !strings.HasPrefix(value, encryptedSecretPrefix) {
		return "", errors.New("API Key 不是加密格式，请重新保存")
	}
	secret, err := keyEncryptionSecret()
	if err != nil {
		return "", err
	}
	blob, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(value, encryptedSecretPrefix))
	if err != nil {
		return "", errors.New("API Key 密文格式错误")
	}
	block, err := aes.NewCipher(secret)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(blob) < gcm.NonceSize() {
		return "", errors.New("API Key 密文长度错误")
	}
	nonce, ciphertext := blob[:gcm.NonceSize()], blob[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", errors.New("API Key 解密失败")
	}
	return string(plain), nil
}

func keyEncryptionSecret() ([]byte, error) {
	secret := strings.TrimSpace(os.Getenv("API_KEY_ENCRYPTION_SECRET"))
	if secret == "" {
		return nil, errors.New("API_KEY_ENCRYPTION_SECRET 未配置：必须单独设置，不能回退 JWT_SECRET（密钥分离）")
	}
	if len(secret) < 16 {
		return nil, errors.New("API_KEY_ENCRYPTION_SECRET 至少需要 16 个字符")
	}
	sum := sha256.Sum256([]byte(secret))
	return sum[:], nil
}

// RequireKeyEncryptionSecret 启动时校验加密密钥已配置，缺失则直接失败，
// 避免运行时才发现 API Key 无法加解密。
func RequireKeyEncryptionSecret() error {
	_, err := keyEncryptionSecret()
	return err
}
