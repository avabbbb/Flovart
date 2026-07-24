import type { UserApiKey } from '../types';
import {
  clearAllKeyData,
  loadKeysDecrypted,
  migrateLegacyKeys,
} from '../utils/keyVault';
import {
  reportRuntimeCredentialVault,
  syncRuntimeCredentials,
} from './runtimeCredentials';

type BootstrapCredential = Pick<UserApiKey, 'id' | 'provider' | 'key' | 'name'>;

interface BootstrapDependencies {
  migrate(): Promise<void>;
  load(): Promise<unknown>;
  clear(): Promise<void>;
  report(count: number, persistenceEnabled: boolean): Promise<void>;
  sync(credentials: BootstrapCredential[]): Promise<number>;
  persistenceEnabled(): boolean;
}

const defaults: BootstrapDependencies = {
  migrate: migrateLegacyKeys,
  load: () => loadKeysDecrypted<unknown>(),
  clear: clearAllKeyData,
  report: reportRuntimeCredentialVault,
  sync: syncRuntimeCredentials,
  persistenceEnabled: () => localStorage.getItem('security.clearKeysOnExit') !== 'true',
};

export async function bootstrapRuntimeCredentials(
  dependencies: BootstrapDependencies = defaults,
): Promise<number> {
  await dependencies.migrate();
  const raw = await dependencies.load();
  const credentials = (Array.isArray(raw) ? raw : []).filter(
    (item): item is BootstrapCredential =>
      Boolean(item && typeof item === 'object'
        && typeof item.id === 'string'
        && typeof item.provider === 'string'
        && typeof item.key === 'string'
        && item.key),
  );
  const persistenceEnabled = dependencies.persistenceEnabled();
  await dependencies.report(credentials.length, persistenceEnabled);
  if (!persistenceEnabled) {
    await dependencies.clear();
    return 0;
  }
  return dependencies.sync(credentials);
}
