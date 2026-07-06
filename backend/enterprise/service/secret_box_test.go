package service

import "testing"

func TestEncryptSecretRoundTrip(t *testing.T) {
	t.Setenv("API_KEY_ENCRYPTION_SECRET", "0123456789abcdef")
	t.Setenv("JWT_SECRET", "")
	plain := "sk-test-secret"
	encrypted, err := encryptSecret(plain)
	if err != nil {
		t.Fatalf("encryptSecret returned error: %v", err)
	}
	if encrypted == plain || len(encrypted) < len(encryptedSecretPrefix) || encrypted[:len(encryptedSecretPrefix)] != encryptedSecretPrefix {
		t.Fatalf("secret was not encrypted with expected prefix: %q", encrypted)
	}
	decrypted, err := decryptSecret(encrypted)
	if err != nil {
		t.Fatalf("decryptSecret returned error: %v", err)
	}
	if decrypted != plain {
		t.Fatalf("decryptSecret = %q, want %q", decrypted, plain)
	}
}

func TestDecryptSecretRejectsPlaintext(t *testing.T) {
	t.Setenv("API_KEY_ENCRYPTION_SECRET", "0123456789abcdef")
	if _, err := decryptSecret("sk-plain"); err == nil {
		t.Fatal("decryptSecret should reject plaintext values")
	}
}
