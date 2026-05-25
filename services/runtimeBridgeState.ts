import type { ModelPreference, UserApiKey } from '../types';
import { inferProviderFromModel } from './aiGateway';
import { getFlovartRuntimeApi } from './flovartRuntime';

export type RuntimeEnvironment = 'extension-hosted' | 'standalone-web' | 'tauri';
export type KeySyncSource = 'vault' | 'chrome-storage' | 'merged' | 'none';

export interface RuntimeBridgeStatus {
  environment: RuntimeEnvironment;
  chromeStorageAvailable: boolean;
  runtimeApiAvailable: boolean;
  runtimeBridgeConnected: boolean;
  lastCheckedAt: number;
}

export interface KeySyncStatus {
  source: KeySyncSource;
  sharedWithExtension: boolean;
  keyCount: number;
  activeProvider?: string;
  activeModel?: string;
  lastCheckedAt: number;
  error?: string | null;
}

function getGlobalWindow(): (Window & typeof globalThis) | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

export function getRuntimeBridgeStatus(): RuntimeBridgeStatus {
  const win = getGlobalWindow();
  const chromeStorageAvailable = Boolean((globalThis as any).chrome?.storage?.local);
  const runtimeApiAvailable = Boolean(win && getFlovartRuntimeApi());
  const isTauri = Boolean((win as any)?.__TAURI__ || (win as any)?.__TAURI_INTERNALS__);
  const isExtension = Boolean(chromeStorageAvailable && (globalThis as any).chrome?.runtime?.id);

  return {
    environment: isTauri ? 'tauri' : isExtension ? 'extension-hosted' : 'standalone-web',
    chromeStorageAvailable,
    runtimeApiAvailable,
    runtimeBridgeConnected: runtimeApiAvailable && chromeStorageAvailable,
    lastCheckedAt: Date.now(),
  };
}

export function getKeySyncStatus(input: {
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  error?: string | null;
}): KeySyncStatus {
  const bridge = getRuntimeBridgeStatus();
  const activeModel = input.modelPreference.videoModel
    || input.modelPreference.imageModel
    || input.modelPreference.textModel
    || undefined;
  const activeProvider = activeModel ? inferProviderFromModel(activeModel) : undefined;
  const hasVaultKeys = input.userApiKeys.length > 0;

  return {
    source: hasVaultKeys && bridge.chromeStorageAvailable
      ? 'merged'
      : hasVaultKeys
        ? 'vault'
        : bridge.chromeStorageAvailable
          ? 'chrome-storage'
          : 'none',
    sharedWithExtension: hasVaultKeys && bridge.chromeStorageAvailable,
    keyCount: input.userApiKeys.length,
    activeProvider,
    activeModel,
    lastCheckedAt: Date.now(),
    error: input.error ?? null,
  };
}
