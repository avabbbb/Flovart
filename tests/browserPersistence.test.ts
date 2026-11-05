import localforage from 'localforage';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  generationHistoryStorage,
  loadGenerationHistoryAsync,
  saveGenerationHistoryAsync,
} from '../utils/generationHistory';
import { clearAllKeyData, loadKeysDecrypted, readUnreadableVaultBackup, saveKeysEncrypted } from '../utils/keyVault';
import type { GenerationHistoryItem } from '../types';

describe('browser business persistence', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearAllKeyData();
    await generationHistoryStorage.clear();
  });

  it('stores encrypted Provider secrets outside localStorage', async () => {
    const keys = [{ id: 'key-1', provider: 'custom', key: 'secret-value' }];

    await saveKeysEncrypted(keys);

    expect(await loadKeysDecrypted()).toEqual(keys);
    expect(localStorage.getItem('userApiKeys.v1.vault')).toBeNull();
    expect(localStorage.getItem('userApiKeys.v1')).toBeNull();
  });

  it('writes v2 ciphertext that does not depend on the user agent', async () => {
    const vault = localforage.createInstance({ name: 'flovart', storeName: 'provider_secret_vault' });
    await saveKeysEncrypted([{ id: 'key-v2', provider: 'custom', key: 'v2-secret' }]);
    expect(await vault.getItem<string>('api_keys')).toMatch(/^v2:/);
  });

  it('keeps undecryptable ciphertext as a backup so a later save cannot destroy it', async () => {
    const vault = localforage.createInstance({ name: 'flovart', storeName: 'provider_secret_vault' });
    await vault.setItem('api_keys', 'not-a-valid-ciphertext');

    expect(await loadKeysDecrypted()).toBeNull();
    expect(await readUnreadableVaultBackup()).toBe('not-a-valid-ciphertext');

    await saveKeysEncrypted([{ id: 'key-2', provider: 'custom', key: 'new-secret' }]);
    expect(await readUnreadableVaultBackup()).toBe('not-a-valid-ciphertext');
    expect(await loadKeysDecrypted()).toEqual([{ id: 'key-2', provider: 'custom', key: 'new-secret' }]);
  });

  it('stores generation history metadata in localforage and rehydrates media', async () => {
    const item: GenerationHistoryItem = {
      id: 'history-1',
      dataUrl: 'data:image/png;base64,aGlzdG9yeQ==',
      mimeType: 'image/png',
      width: 16,
      height: 16,
      prompt: 'localforage history',
      createdAt: 1,
    };

    await saveGenerationHistoryAsync([item]);

    expect(await loadGenerationHistoryAsync()).toEqual([item]);
    expect(localStorage.getItem('making.generationHistory.v1')).toBeNull();
  });
});
