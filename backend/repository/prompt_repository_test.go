package repository

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"flovart/hub/internal/testdb"
	"flovart/hub/model"
	"github.com/lib/pq"
)

func seedUser(t *testing.T, r *UserRepository, name string) *model.User {
	t.Helper()
	u := &model.User{Username: name, Email: name + "@x.io", Password: "h", Status: "active", TokenVersion: 1}
	if err := r.Create(context.Background(), u); err != nil {
		t.Fatal(err)
	}
	return u
}

func TestPromptRepositoryIntegration(t *testing.T) {
	db := testdb.Open(t, "repo_test")
	ctx := context.Background()
	users := NewUserRepository(db)
	repo := NewPromptRepository(db)
	alice := seedUser(t, users, "alice")
	bob := seedUser(t, users, "bob")

	// 1. tags 为 text[]：旧模型用 []string 时 INSERT 直接失败
	pack := &model.PromptPack{Slug: "rain", Title: "100% rain_shot", AuthorID: alice.ID, Mode: "video",
		Tags: pq.StringArray{"rain", "night"}, Items: []model.PromptItem{{Name: "a", Prompt: "pa", Sort: 0}, {Name: "b", Prompt: "pb", Sort: 1}}}
	if err := repo.Create(ctx, pack); err != nil {
		t.Fatalf("create: %v", err)
	}
	other := &model.PromptPack{Slug: "sun", Title: "sunny", AuthorID: bob.ID, Mode: "image",
		Items: []model.PromptItem{{Name: "victim", Prompt: "keep me"}}}
	if err := repo.Create(ctx, other); err != nil {
		t.Fatal(err)
	}
	got, err := repo.FindByID(ctx, pack.ID)
	if err != nil || got == nil {
		t.Fatalf("find: %v", err)
	}
	if len(got.Tags) != 2 || len(got.Items) != 2 || got.Items[0].Name != "a" {
		t.Fatalf("round trip: tags=%v items=%v", got.Tags, got.Items)
	}

	// 2. 公开查询不应带出作者邮箱
	raw, _ := json.Marshal(got)
	if strings.Contains(string(raw), "alice@x.io") {
		t.Fatalf("author email leaked: %s", raw)
	}

	// 3. 非法 UUID 视为不存在而不是 500
	if p, err := repo.FindByID(ctx, "not-a-uuid"); p != nil || err != nil {
		t.Fatalf("bad uuid: %v %v", p, err)
	}

	// 4. List：tags 过滤、关键词通配符按字面匹配、items 非 nil
	res, err := repo.List(ctx, model.Query{Tags: []string{"night"}})
	if err != nil || res.Total != 1 || res.List[0].ID != pack.ID || len(res.List[0].Items) != 2 {
		t.Fatalf("list tags: %+v %v", res, err)
	}
	res, _ = repo.List(ctx, model.Query{Keyword: "%"})
	if res.Total != 1 {
		t.Fatalf("keyword %% should match literally, got %d", res.Total)
	}
	res, _ = repo.List(ctx, model.Query{Keyword: "_"})
	if res.Total != 1 {
		t.Fatalf("keyword _ should match literally, got %d", res.Total)
	}

	// 5. Update 整体替换条目（旧实现只增不减），非作者被拒
	if err := repo.UpdateOwned(ctx, pack.ID, bob.ID, model.PromptPack{Title: "x"}); !errors.Is(err, ErrNotOwner) {
		t.Fatalf("non-owner update: %v", err)
	}
	err = repo.UpdateOwned(ctx, pack.ID, alice.ID, model.PromptPack{Title: "new", Mode: "image", Tags: pq.StringArray{"x"},
		Items: []model.PromptItem{{Name: "only", Prompt: "one"}}})
	if err != nil {
		t.Fatal(err)
	}
	got, _ = repo.FindByID(ctx, pack.ID)
	if got.Title != "new" || len(got.Items) != 1 || got.Items[0].Name != "only" || len(got.Tags) != 1 {
		t.Fatalf("after update: %+v", got)
	}
	victim, _ := repo.FindByID(ctx, other.ID)
	if len(victim.Items) != 1 || victim.Items[0].Prompt != "keep me" {
		t.Fatalf("other pack items changed: %+v", victim.Items)
	}

	// 6. ToggleLike 并发安全且计数一致
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = repo.ToggleLike(ctx, bob.ID, pack.ID) }()
	}
	wg.Wait()
	var likes int64
	db.Model(&model.PromptLike{}).Where("pack_id = ?", pack.ID).Count(&likes)
	got, _ = repo.FindByID(ctx, pack.ID)
	if int64(got.LikeCount) != likes {
		t.Fatalf("like_count %d != likes %d", got.LikeCount, likes)
	}
	if _, err := repo.ToggleLike(ctx, bob.ID, "00000000-0000-0000-0000-000000000000"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("like missing pack: %v", err)
	}
	if likes == 0 {
		if liked, err := repo.ToggleLike(ctx, bob.ID, pack.ID); err != nil || !liked {
			t.Fatal(liked, err)
		}
	}

	// 7. Delete：旧实现被外键拒绝；现在连同条目与收藏一并删除，非作者被拒
	if err := repo.DeleteOwned(ctx, pack.ID, bob.ID); !errors.Is(err, ErrNotOwner) {
		t.Fatalf("non-owner delete: %v", err)
	}
	if err := repo.DeleteOwned(ctx, pack.ID, alice.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	var n int64
	db.Model(&model.PromptItem{}).Where("pack_id = ?", pack.ID).Count(&n)
	if n != 0 {
		t.Fatalf("orphan items: %d", n)
	}
	if err := repo.DeleteOwned(ctx, pack.ID, alice.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete: %v", err)
	}

	// 8. SessionState
	st, ver, err := users.SessionState(ctx, alice.ID)
	if err != nil || st != "active" || ver != 1 {
		t.Fatalf("session: %s %d %v", st, ver, err)
	}
	if st, _, err := users.SessionState(ctx, "00000000-0000-0000-0000-000000000000"); st != "" || err != nil {
		t.Fatalf("missing user session: %q %v", st, err)
	}
}
