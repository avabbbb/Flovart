import { describe, expect, it, vi } from 'vitest';

import { getKeySyncStatus, getRuntimeBridgeStatus } from '../services/runtimeBridgeState';
import type { ModelPreference, UserApiKey } from '../types';

const modelPreference: ModelPreference = {
  textModel: 'gemini-3-flash-preview',
  imageModel: 'gpt-image-1',
  videoModel: 'veo-3.1-generate-preview',
};

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
    (window as any).__TAURI_INTERNALS__ = { invoke: vi.fn() };

    expect(getRuntimeBridgeStatus()).toMatchObject({
      environment: 'tauri',
      runtimeApiAvailable: true,
      runtimeBridgeConnected: false,
    });

    delete (window as any).__TAURI_INTERNALS__;
    vi.unstubAllGlobals();
  });

  it('summarizes key sync state from vault keys and active model preference', () => {
    vi.stubGlobal('chrome', {
      runtime: { id: 'extension-id' },
      storage: { local: {} },
    });
    const userApiKeys = [{
      id: 'key_1',
      provider: 'openai',
      capabilities: ['image'],
      key: 'sk-test',
      createdAt: 1,
      updatedAt: 1,
    }] satisfies UserApiKey[];

    const status = getKeySyncStatus({ userApiKeys, modelPreference });

    expect(status).toMatchObject({
      source: 'merged',
      sharedWithExtension: true,
      keyCount: 1,
      activeProvider: 'google',
      activeModel: 'veo-3.1-generate-preview',
    });

    vi.unstubAllGlobals();
  });
});
