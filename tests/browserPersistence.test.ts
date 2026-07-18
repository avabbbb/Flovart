import { beforeEach, describe, expect, it } from 'vitest';
import {
  generationHistoryStorage,
  loadGenerationHistoryAsync,
  saveGenerationHistoryAsync,
} from '../utils/generationHistory';
import { clearAllKeyData, loadKeysDecrypted, saveKeysEncrypted } from '../utils/keyVault';
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
