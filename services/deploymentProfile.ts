import { api, HUB_BASE_URL } from './hubClient';

export type DeploymentMode = 'local' | 'enterprise';

export interface DeploymentProfile {
  mode: DeploymentMode;
  authRequired: boolean;
  tenancy: 'single-user' | 'multi-tenant';
  capabilities: {
    enterpriseAdmin: boolean;
    platformAdmin: boolean;
    serverWorkspace: boolean;
  };
}

export const localDeploymentProfile: DeploymentProfile = {
  mode: 'local',
  authRequired: false,
  tenancy: 'single-user',
  capabilities: {
    enterpriseAdmin: false,
    platformAdmin: false,
    serverWorkspace: false,
  },
};

const enterpriseDeploymentProfile: DeploymentProfile = {
  mode: 'enterprise',
  authRequired: true,
  tenancy: 'multi-tenant',
  capabilities: {
    enterpriseAdmin: true,
    platformAdmin: true,
    serverWorkspace: true,
  },
};

export function bundledDeploymentProfile(): DeploymentProfile {
  try {
    return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_DEPLOYMENT_MODE === 'enterprise'
      ? enterpriseDeploymentProfile
      : localDeploymentProfile;
  } catch {
    return localDeploymentProfile;
  }
}

export function normalizeDeploymentProfile(value: unknown): DeploymentProfile {
  if (!value || typeof value !== 'object' || (value as { mode?: unknown }).mode !== 'enterprise') {
    return localDeploymentProfile;
  }
  const input = value as Partial<DeploymentProfile>;
  const capabilities = input.capabilities || {} as DeploymentProfile['capabilities'];
  return {
    mode: 'enterprise',
    authRequired: input.authRequired === true,
    tenancy: input.tenancy === 'multi-tenant' ? 'multi-tenant' : 'single-user',
    capabilities: {
      enterpriseAdmin: capabilities.enterpriseAdmin === true,
      platformAdmin: capabilities.platformAdmin === true,
      serverWorkspace: capabilities.serverWorkspace === true,
    },
  };
}

export async function fetchDeploymentProfile(): Promise<DeploymentProfile> {
  try {
    return normalizeDeploymentProfile(await api.get<DeploymentProfile>(HUB_BASE_URL, '/deployment-profile'));
  } catch {
    return bundledDeploymentProfile();
  }
}
