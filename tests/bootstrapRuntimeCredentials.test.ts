import { describe, expect, it, vi } from 'vitest';

import { bootstrapRuntimeCredentials } from '../services/bootstrapRuntimeCredentials';

describe('bootstrapRuntimeCredentials', () => {
  it('syncs persisted credentials before any business route mounts', async () => {
    const report = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn().mockResolvedValue(1);

    await expect(bootstrapRuntimeCredentials({
      migrate: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue([{
        id: 'google-1',
        provider: 'google',
        key: 'secret',
        name: 'Google',
      }]),
      clear: vi.fn(),
      report,
      sync,
      persistenceEnabled: () => true,
    })).resolves.toBe(1);

    expect(report).toHaveBeenCalledWith(1, true);
    expect(sync).toHaveBeenCalledWith([{
      id: 'google-1',
      provider: 'google',
      key: 'secret',
      name: 'Google',
    }]);
  });

  it('reports and clears an ephemeral vault without writing to keyring', async () => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const report = vi.fn().mockResolvedValue(undefined);
    const sync = vi.fn();

    await expect(bootstrapRuntimeCredentials({
      migrate: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue([{
        id: 'google-1',
        provider: 'google',
        key: 'secret',
      }]),
      clear,
      report,
      sync,
      persistenceEnabled: () => false,
    })).resolves.toBe(0);

    expect(report).toHaveBeenCalledWith(1, false);
    expect(clear).toHaveBeenCalledOnce();
    expect(sync).not.toHaveBeenCalled();
  });
});
