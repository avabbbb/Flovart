import { describe, expect, it } from 'vitest';

import {
  localDeploymentProfile,
  normalizeDeploymentProfile,
} from '../services/deploymentProfile';

describe('deployment profile', () => {
  it('fails closed to local mode when the server profile is missing or invalid', () => {
    expect(normalizeDeploymentProfile(null)).toEqual(localDeploymentProfile);
    expect(normalizeDeploymentProfile({ mode: 'preview' })).toEqual(localDeploymentProfile);
  });

  it('only enables enterprise capabilities for an explicit enterprise profile', () => {
    expect(normalizeDeploymentProfile({
      mode: 'enterprise',
      authRequired: true,
      tenancy: 'multi-tenant',
      capabilities: {
        enterpriseAdmin: true,
        platformAdmin: true,
        serverWorkspace: true,
      },
    })).toMatchObject({
      mode: 'enterprise',
      authRequired: true,
      tenancy: 'multi-tenant',
      capabilities: {
        enterpriseAdmin: true,
        platformAdmin: true,
        serverWorkspace: true,
      },
    });
  });
});
