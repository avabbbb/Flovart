package service

import "testing"

func TestNormalizeLifecycleStatuses(t *testing.T) {
	if got, ok := NormalizeAccountStatus(" SUSPENDED "); !ok || got != "suspended" {
		t.Fatalf("account status got=%q ok=%v", got, ok)
	}
	if _, ok := NormalizeAccountStatus("invited"); ok {
		t.Fatal("unsupported account status accepted")
	}
	if got, ok := NormalizeMembershipStatus("active"); !ok || got != "active" {
		t.Fatalf("membership status got=%q ok=%v", got, ok)
	}
	if _, ok := NormalizeMembershipStatus("deleted"); ok {
		t.Fatal("unsupported membership status accepted")
	}
}
