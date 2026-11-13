package service

import (
	"strings"
	"testing"
	"time"

	"flovart/hub/apperr"
	"flovart/hub/model"
)

func TestNormalizeInputDropsClientItemIDs(t *testing.T) {
	in := CreateInput{Slug: " s ", Title: " T ", Mode: "bogus", Tags: []string{" a ", "a", ""},
		Items: []model.PromptItem{{ID: "victim-item", PackID: "victim-pack", Name: " n ", Prompt: " p ", Sort: 9}}}
	if err := normalizeInput(&in, true); err != nil {
		t.Fatal(err)
	}
	it := in.Items[0]
	if it.ID != "" || it.PackID != "" || it.Name != "n" || it.Prompt != "p" || it.Sort != 0 {
		t.Fatalf("item not sanitized: %+v", it)
	}
	if in.Mode != "image" || len(in.Tags) != 1 || in.Tags[0] != "a" || in.Slug != "s" || in.Title != "T" {
		t.Fatalf("unexpected normalize: %+v", in)
	}
}

func TestNormalizeInputLimits(t *testing.T) {
	item := []model.PromptItem{{Name: "n", Prompt: "p"}}
	bad := []CreateInput{
		{Slug: "", Title: "t", Items: item},
		{Slug: "a/b", Title: "t", Items: item},
		{Slug: "s", Title: strings.Repeat("长", 121), Items: item},
		{Slug: "s", Title: "t"},
		{Slug: "s", Title: "t", Items: []model.PromptItem{{Name: " ", Prompt: "p"}}},
		{Slug: "s", Title: "t", Items: make([]model.PromptItem, 201)},
	}
	for i, in := range bad {
		err := normalizeInput(&in, true)
		if e := apperr.As(err); e == nil || e.Status != 400 {
			t.Errorf("case %d: want 400, got %v", i, err)
		}
	}
	ok := CreateInput{Slug: "夜雨-镜头", Title: strings.Repeat("长", 120), Items: item}
	if err := normalizeInput(&ok, true); err != nil {
		t.Errorf("unicode slug/title within limits rejected: %v", err)
	}
}

func TestUploadKeyOwnership(t *testing.T) {
	uid := "8a7b2c3d-1111-2222-3333-444455556666"
	key := buildUploadKey("avatar", strings.ToUpper(uid), time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
		"0f0e0d0c-aaaa-bbbb-cccc-ddddeeeeffff", uploadExtensions["image/png"])
	if key != "uploads/avatar/"+uid+"/2026/01/02/0f0e0d0c-aaaa-bbbb-cccc-ddddeeeeffff.png" {
		t.Fatalf("key: %s", key)
	}
	owner, ok := uploadKeyOwner(key)
	if !ok || owner != uid {
		t.Fatalf("owner: %q %v", owner, ok)
	}
	for _, k := range []string{"", "uploads/x.png", "other/avatar/" + uid + "/2026/01/02/0f0e0d0c-aaaa-bbbb-cccc-ddddeeeeffff.png",
		"uploads/avatar/" + uid + "/2026/01/02/../../secret.png"} {
		if _, ok := uploadKeyOwner(k); ok {
			t.Errorf("accepted bad key %q", k)
		}
	}
}

func TestNormalizeContentTypeAndExtensions(t *testing.T) {
	if got := normalizeContentType(" Image/PNG; charset=binary "); got != "image/png" {
		t.Fatalf("got %q", got)
	}
	for ct := range allowedUploadContentTypes {
		if uploadExtensions[ct] == "" {
			t.Errorf("no extension for allowed type %s", ct)
		}
	}
}
