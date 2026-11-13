package service

import (
	"context"
	"strings"
	"testing"

	"flovart/hub/apperr"
	"flovart/hub/internal/testdb"
	"flovart/hub/model"
	"flovart/hub/repository"
)

func TestAuthServiceIntegration(t *testing.T) {
	db := testdb.Open(t, "svc_test")
	ctx := context.Background()
	svc := NewAuthService(repository.NewUserRepository(db), "secret-secret-secret-secret-secret", 1)

	if _, _, err := svc.Register(ctx, "carol", "Carol@Example.com", "pw123456"); err != nil {
		t.Fatal(err)
	}
	// 注册时邮箱小写存储；旧实现登录不小写，大小写不同的邮箱无法登录
	if _, tok, err := svc.Login(ctx, "CAROL@example.com", "pw123456"); err != nil || tok == "" {
		t.Fatalf("mixed-case email login: %v", err)
	}
	if _, _, err := svc.Login(ctx, "carol", "wrong"); apperr.As(err) == nil || apperr.As(err).Status != 401 {
		t.Fatalf("wrong password: %v", err)
	}
	if _, _, err := svc.Login(ctx, "nobody", "x"); apperr.As(err) == nil || apperr.As(err).Status != 401 {
		t.Fatalf("unknown user: %v", err)
	}
	if _, _, err := svc.Register(ctx, "carol", "c2@example.com", "pw123456"); apperr.As(err) == nil {
		t.Fatalf("duplicate username should be business error: %v", err)
	}
	if _, _, err := svc.Register(ctx, "dave", "d@example.com", strings.Repeat("x", 73)); apperr.As(err) == nil {
		t.Fatalf("overlong password should be business error: %v", err)
	}
	// 停用账号：密码正确才提示停用，密码错误只说账号或密码错误
	db.Model(&model.User{}).Where("username = ?", "carol").Update("status", "suspended")
	if _, _, err := svc.Login(ctx, "carol", "wrong"); apperr.As(err) == nil || apperr.As(err).Status != 401 {
		t.Fatalf("suspended+wrong pw should not reveal status: %v", err)
	}
	if _, _, err := svc.Login(ctx, "carol", "pw123456"); apperr.As(err) == nil || apperr.As(err).Status != 403 {
		t.Fatalf("suspended: %v", err)
	}
}

func TestPromptServiceIntegration(t *testing.T) {
	db := testdb.Open(t, "svc_prompt_test")
	ctx := context.Background()
	users := repository.NewUserRepository(db)
	u := &model.User{Username: "erin", Email: "e@x.io", Password: "h", Status: "active", TokenVersion: 1}
	if err := users.Create(ctx, u); err != nil {
		t.Fatal(err)
	}
	svc := NewPromptService(repository.NewPromptRepository(db))
	in := CreateInput{Slug: "dup", Title: "t", Items: []model.PromptItem{{Name: "n", Prompt: "p"}}}
	if _, err := svc.Create(ctx, u.ID, in); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, u.ID, in); apperr.As(err) == nil || apperr.As(err).Status != 409 {
		t.Fatalf("duplicate slug: %v", err)
	}
	if _, err := svc.List(ctx, model.Query{AuthorID: "bad"}); apperr.As(err) == nil || apperr.As(err).Status != 400 {
		t.Fatalf("bad authorId: %v", err)
	}
	if err := svc.Delete(ctx, u.ID, "nope"); apperr.As(err) == nil || apperr.As(err).Status != 404 {
		t.Fatalf("delete bad id: %v", err)
	}
}
