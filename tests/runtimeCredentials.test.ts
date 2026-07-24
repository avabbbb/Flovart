import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteRuntimeCredential,
  reportRuntimeCredentialVault,
  syncRuntimeCredentials,
} from '../services/runtimeCredentials';

describe('runtimeCredentials', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('propagates an unavailable IPC boundary without falling back to a network bridge', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('IPC unavailable'));

    await expect(reportRuntimeCredentialVault(1, true, invoke))
      .rejects.toThrow('IPC unavailable');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('writes each credential directly to the operating-system keyring', async () => {
    vi.stubGlobal('isTauri', true);
    const invoke = vi.fn().mockResolvedValue({});

    await expect(syncRuntimeCredentials([{
      id: 'google-1',
      provider: 'google',
      key: 'secret',
      name: 'Google primary',
    }], invoke)).resolves.toBe(1);
    expect(invoke).toHaveBeenCalledWith('keyring_set', {
      provider: 'google',
      keyId: 'google-1',
      secret: 'secret',
      label: 'Google primary',
    });
  });

  it('reports only credential count and persistence policy', async () => {
    vi.stubGlobal('isTauri', true);
    const invoke = vi.fn().mockResolvedValue({});

    await reportRuntimeCredentialVault(2, false, invoke);

    expect(invoke).toHaveBeenCalledWith('keyring_report_sync', {
      credentialCount: 2,
      persistenceEnabled: false,
    });
  });

  it('deletes the matching provider and key ID without returning a secret', async () => {
    vi.stubGlobal('isTauri', true);
    const invoke = vi.fn().mockResolvedValue(true);

    await expect(deleteRuntimeCredential({
      id: 'google-1',
      provider: 'google',
    }, invoke)).resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('keyring_delete', {
      provider: 'google',
      keyId: 'google-1',
    });
  });
});
