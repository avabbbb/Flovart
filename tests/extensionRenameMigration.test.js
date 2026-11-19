// @vitest-environment node
// 2026-11-20 Flovart → Iris：扩展 chrome.storage 旧 key 复制到新 key，不覆盖、不删除。
import { describe, expect, it } from 'vitest';
import { ensureRenamedExtensionStorage, migrateRenamedExtensionStorage } from '../extension/background/storage-migration.js';
import { readPairings } from '../extension/background/web-pairings.js';

function area(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) { return data.has(key) ? { [key]: data.get(key) } : {}; },
    async set(entries) { for (const [key, value] of Object.entries(entries)) data.set(key, value); },
  };
}

describe('extension storage rename migration', () => {
  it('copies legacy flovart* keys to iris* and keeps the old values', async () => {
    const storage = area({ flovartWebPairings: { 'https://flovart.avabbbb.com': { status: 'approved' } }, flovartImportHistory: [1], irisBridgeStatus: 'ok', flovartBridgeStatus: 'old' });
    expect(await migrateRenamedExtensionStorage(storage)).toBe(2);
    expect(storage.data.get('irisWebPairings')).toEqual({ 'https://flovart.avabbbb.com': { status: 'approved' } });
    expect(storage.data.get('irisImportHistory')).toEqual([1]);
    expect(storage.data.get('irisBridgeStatus')).toBe('ok');
    expect(storage.data.get('flovartWebPairings')).toBeTruthy();
  });

  it('readPairings sees pairings made before the rename', async () => {
    const storage = area({ flovartWebPairings: { 'https://flovart.avabbbb.com': { status: 'approved', updatedAt: 1 } } });
    expect(await readPairings(storage)).toEqual({ 'https://flovart.avabbbb.com': { status: 'approved', updatedAt: 1 } });
    await ensureRenamedExtensionStorage(storage);
    expect(storage.data.has('irisWebPairings')).toBe(true);
  });
});
