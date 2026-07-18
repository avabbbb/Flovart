import { invoke } from '@tauri-apps/api/core';

export interface RuntimeStatus {
  protocolVersion: '1';
  runtimeVersion: string;
  runtimeInstanceId: string;
  registryHash: string;
  authority: 'desktop-runtime';
  state: 'ready' | 'starting' | 'degraded' | 'stopping';
}

export interface RuntimeCommandError {
  code?: string;
  message?: string;
}

export interface RuntimeCommandResult {
  ok?: boolean;
  error?: RuntimeCommandError | string;
  [key: string]: unknown;
}

export interface RuntimeCommandEnvelope {
  protocolVersion: '1';
  commandId: string;
  command: string;
  args: Record<string, unknown>;
  actor: {
    kind: 'ui';
    instanceId: string;
  };
}

export interface FlovartRuntimeApi {
  status(): Promise<RuntimeStatus>;
  execute(envelope: RuntimeCommandEnvelope): Promise<unknown>;
}

const tauriRuntime: FlovartRuntimeApi = {
  status: () => invoke<RuntimeStatus>('runtime_status'),
  execute: envelope => invoke('runtime_execute', { envelope }),
};

export function isTauriRuntimeSurface(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

export function getFlovartRuntimeApi(): FlovartRuntimeApi | null {
  return isTauriRuntimeSurface() ? tauriRuntime : null;
}

export function getRuntimeErrorMessage(
  result: RuntimeCommandResult | null | undefined,
  fallback: string,
): string {
  const error = result?.error;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && typeof error.message === 'string' && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
