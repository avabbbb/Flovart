package service

import "testing"

func TestDeploymentProfileLocal(t *testing.T) {
	profile := NewDeploymentService("local").Profile()
	if profile.Mode != "local" || profile.AuthRequired || profile.Capabilities.EnterpriseAdmin || profile.Capabilities.ServerWorkspace {
		t.Fatalf("unexpected local profile: %#v", profile)
	}
}

func TestDeploymentProfileEnterprise(t *testing.T) {
	profile := NewDeploymentService("enterprise").Profile()
	if profile.Mode != "enterprise" || !profile.AuthRequired || profile.Tenancy != "multi-tenant" {
		t.Fatalf("unexpected enterprise profile: %#v", profile)
	}
	if !profile.Capabilities.EnterpriseAdmin || !profile.Capabilities.PlatformAdmin || !profile.Capabilities.ServerWorkspace {
		t.Fatalf("enterprise capabilities are incomplete: %#v", profile.Capabilities)
	}
}
