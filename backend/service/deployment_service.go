package service

import "strings"

type DeploymentCapabilities struct {
	EnterpriseAdmin bool `json:"enterpriseAdmin"`
	PlatformAdmin   bool `json:"platformAdmin"`
	ServerWorkspace bool `json:"serverWorkspace"`
}

type DeploymentProfile struct {
	Mode         string                 `json:"mode"`
	AuthRequired bool                   `json:"authRequired"`
	Tenancy      string                 `json:"tenancy"`
	Capabilities DeploymentCapabilities `json:"capabilities"`
}

type DeploymentService struct {
	mode string
}

func NewDeploymentService(mode string) *DeploymentService {
	if strings.EqualFold(strings.TrimSpace(mode), "enterprise") {
		return &DeploymentService{mode: "enterprise"}
	}
	return &DeploymentService{mode: "local"}
}

func (s *DeploymentService) Profile() DeploymentProfile {
	if s.mode == "enterprise" {
		return DeploymentProfile{
			Mode:         "enterprise",
			AuthRequired: true,
			Tenancy:      "multi-tenant",
			Capabilities: DeploymentCapabilities{EnterpriseAdmin: true, PlatformAdmin: true, ServerWorkspace: true},
		}
	}
	return DeploymentProfile{Mode: "local", Tenancy: "single-user"}
}
