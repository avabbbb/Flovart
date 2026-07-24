import type { UserApiKey } from '../types';
import { getFlovartRuntimeApi, isTauriRuntimeSurface } from './flovartRuntime';

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
  lastCheckedAt: number;
  error?: string | null;
}

function getGlobalWindow(): (Window & typeof globalThis) | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

export function getRuntimeBridgeStatus(): RuntimeBridgeStatus {
  const win = getGlobalWindow();
  const chromeStorageAvailable = Boolean((globalThis as any).chrome?.storage?.local);
  const tauriAvailable = Boolean(win) && isTauriRuntimeSurface();
  const runtimeApiAvailable = tauriAvailable && Boolean(getFlovartRuntimeApi());
  const isExtension = Boolean(chromeStorageAvailable && (globalThis as any).chrome?.runtime?.id);

  return {
    environment: tauriAvailable ? 'tauri' : isExtension ? 'extension-hosted' : 'standalone-web',
    chromeStorageAvailable,
    runtimeApiAvailable,
    runtimeBridgeConnected: runtimeApiAvailable && chromeStorageAvailable,
    lastCheckedAt: Date.now(),
  };
}

export function getKeySyncStatus(input: {
  userApiKeys: UserApiKey[];
  error?: string | null;
}): KeySyncStatus {
  const bridge = getRuntimeBridgeStatus();
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
    lastCheckedAt: Date.now(),
    error: input.error ?? null,
  };
}
