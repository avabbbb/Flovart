import { invoke, isTauri } from '@tauri-apps/api/core';

import type { UserApiKey } from '../types';
import { getManagedAgentConnection } from './managedAgentConnection';

type RuntimeCredential = Pick<UserApiKey, 'id' | 'provider' | 'key' | 'name'>;

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

// Web builds have no Tauri Runtime: the same keyring commands go to the local
// Agent vault, which stores secrets in the OS keyring under the same
// service/account as the desktop Runtime.
const AGENT_CREDENTIAL_ROUTES: Record<string, string> = {
  keyring_set: '/credentials/set',
  keyring_delete: '/credentials/delete',
  keyring_report_sync: '/credentials/report-sync',
};

interface AgentCredentialResponse {
  ok?: boolean;
  credential?: unknown;
  removed?: unknown;
  sync?: unknown;
  error?: { message?: string } | string;
}

export async function invokeAgentCredentials<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const route = AGENT_CREDENTIAL_ROUTES[command];
  if (!route) throw new Error(`Unsupported Agent credential command: ${command}`);
  const connection = await getManagedAgentConnection();
  if (!connection) throw new Error('Flovart Agent is not connected.');
  const response = await fetch(new URL(route, connection.url), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flovart-agent-token': connection.token },
    body: JSON.stringify(args),
  });
  const body = await response.json().catch(() => null) as AgentCredentialResponse | null;
  if (!response.ok || !body?.ok) {
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
    throw new Error(message || `Agent credential request failed (${response.status})`);
  }
  if (command === 'keyring_delete') return body.removed as T;
  if (command === 'keyring_set') return body.credential as T;
  return body.sync as T;
}

const runtimeInvokeForSurface: Invoke = (command, args) => (
  typeof window !== 'undefined' && isTauri()
    ? invoke(command, args)
    : invokeAgentCredentials(command, args)
);

export async function syncRuntimeCredentials(
  credentials: RuntimeCredential[],
  runtimeInvoke: Invoke = runtimeInvokeForSurface,
): Promise<number> {
  const usable = credentials.filter(credential => credential.id && credential.provider && credential.key);
  await Promise.all(usable.map(credential => runtimeInvoke('keyring_set', {
    provider: credential.provider,
    keyId: credential.id,
    secret: credential.key,
    label: credential.name || credential.provider,
  })));
  return usable.length;
}

export async function reportRuntimeCredentialVault(
  credentialCount: number,
  persistenceEnabled: boolean,
  runtimeInvoke: Invoke = runtimeInvokeForSurface,
): Promise<void> {
  await runtimeInvoke('keyring_report_sync', { credentialCount, persistenceEnabled });
}

export async function deleteRuntimeCredential(
  credential: Pick<RuntimeCredential, 'id' | 'provider'>,
  runtimeInvoke: Invoke = runtimeInvokeForSurface,
): Promise<boolean> {
  return runtimeInvoke<boolean>('keyring_delete', {
    provider: credential.provider,
    keyId: credential.id,
  });
}
