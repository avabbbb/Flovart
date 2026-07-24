import { describe, expect, it, vi } from 'vitest';

import { getKeySyncStatus, getRuntimeBridgeStatus } from '../services/runtimeBridgeState';
import type { UserApiKey } from '../types';

describe('runtimeBridgeState', () => {
  it('reports standalone runtime state when chrome storage is unavailable', () => {
    vi.stubGlobal('chrome', undefined);
    (window as any).__flovartAPI = { session: {} };

    const status = getRuntimeBridgeStatus();

    expect(status).toMatchObject({
      environment: 'standalone-web',
      chromeStorageAvailable: false,
      runtimeApiAvailable: false,
      runtimeBridgeConnected: false,
    });

    delete (window as any).__flovartAPI;
    vi.unstubAllGlobals();
  });

  it('recognizes the restricted Tauri IPC adapter as the local runtime surface', () => {
    vi.stubGlobal('chrome', undefined);
    vi.stubGlobal('isTauri', true);

    expect(getRuntimeBridgeStatus()).toMatchObject({
      environment: 'tauri',
      runtimeApiAvailable: true,
      runtimeBridgeConnected: false,
    });

    vi.unstubAllGlobals();
  });

  it('summarizes key sync state without inventing one global active model', () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'extension-id' },
      storage: { local: {} },
    });
    const userApiKeys = [{
      id: 'key_1',
      provider: 'openai',
      capabilities: ['image'],
      key: 'sk-test',
      routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, routeId: 'gpt-image-2', order: 0 }],
      createdAt: 1,
      updatedAt: 1,
    }] satisfies UserApiKey[];

    const status = getKeySyncStatus({ userApiKeys });

    expect(status).toMatchObject({
      source: 'merged',
      sharedWithExtension: true,
      keyCount: 1,
    });
    expect(status).not.toHaveProperty('activeProvider');
    expect(status).not.toHaveProperty('activeModel');

    vi.unstubAllGlobals();
  });
});
