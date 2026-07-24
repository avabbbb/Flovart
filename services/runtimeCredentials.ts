import { invoke } from '@tauri-apps/api/core';

import type { UserApiKey } from '../types';

type RuntimeCredential = Pick<UserApiKey, 'id' | 'provider' | 'key' | 'name'>;

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function syncRuntimeCredentials(
  credentials: RuntimeCredential[],
  runtimeInvoke: Invoke = invoke,
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
  runtimeInvoke: Invoke = invoke,
): Promise<void> {
  await runtimeInvoke('keyring_report_sync', { credentialCount, persistenceEnabled });
}

export async function deleteRuntimeCredential(
  credential: Pick<RuntimeCredential, 'id' | 'provider'>,
  runtimeInvoke: Invoke = invoke,
): Promise<boolean> {
  return runtimeInvoke<boolean>('keyring_delete', {
    provider: credential.provider,
    keyId: credential.id,
  });
}
