package service

import "testing"

func TestAccountCanAuthenticate(t *testing.T) {
	if !AccountCanAuthenticate("active") || !AccountCanAuthenticate("") {
		t.Fatal("active/default account should authenticate")
	}
	if AccountCanAuthenticate("suspended") || AccountCanAuthenticate("deleted") {
		t.Fatal("inactive account should not authenticate")
	}
}
