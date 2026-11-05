// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createWebKeyStore, REVISION_MISMATCH, sanitizeKeys, WEB_KEYS_KEY } from '../extension/background/web-keys.js';

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      return { [key]: data[key] === undefined ? undefined : structuredClone(data[key]) };
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
  };
}

function newKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function setup(storage = memoryStorage(), keyPromise = newKey()) {
  return { storage, store: createWebKeyStore({ storage, cryptoKey: () => keyPromise }) };
}

const ORIGIN = 'http' + '://localhost:37522';
const OTHER = 'http' + '://127.0.0.1:37522';
const k1 = { id: 'k1', provider: 'openai', key: 'sk-secret-one' };
const k2 = { id: 'k2', provider: 'google', key: 'secret-two', baseUrl: 'proxy', extra: 'drop-me' };

describe('extension web key store', () => {
  it('stores only ciphertext and round-trips a snapshot', async () => {
    const { storage, store } = setup();
    await store.snapshot(ORIGIN, 1, [k1]);
    expect(JSON.stringify(storage.data)).not.toContain('sk-secret-one');
    expect(await store.load(ORIGIN)).toEqual({ revision: 1, keys: [k1] });
  });

  it('applies a delta on the matching revision and drops unknown fields', async () => {
    const { store } = setup();
    await store.snapshot(ORIGIN, 1, [k1]);
    await store.delta(ORIGIN, 1, 2, [k2], ['k1']);
    expect(await store.load(ORIGIN)).toEqual({
      revision: 2,
      keys: [{ id: 'k2', provider: 'google', key: 'secret-two', baseUrl: 'proxy' }],
    });
  });

  it('rejects a delta whose base revision is stale', async () => {
    const { store } = setup();
    await store.snapshot(ORIGIN, 1, [k1]);
    await expect(store.delta(ORIGIN, 5, 6, [k2], [])).rejects.toThrow(REVISION_MISMATCH);
    expect((await store.load(ORIGIN)).revision).toBe(1);
  });

  it('clears one origin and prunes origins that are no longer approved', async () => {
    const { storage, store } = setup();
    await store.snapshot(ORIGIN, 1, [k1]);
    await store.snapshot(OTHER, 1, [k1]);
    await store.prune(new Set([ORIGIN]));
    expect(await store.load(OTHER)).toEqual({ revision: 0, keys: [] });
    expect((await store.allKeys()).length).toBe(1);
    await store.clear(ORIGIN);
    expect(storage.data[WEB_KEYS_KEY]).toEqual({});
  });

  it('treats ciphertext from a lost crypto key as empty', async () => {
    const storage = memoryStorage();
    await setup(storage).store.snapshot(ORIGIN, 3, [k1]);
    expect(await setup(storage).store.load(ORIGIN)).toEqual({ revision: 0, keys: [] });
  });

  it('sanitizes and de-duplicates entries by id', () => {
    expect(sanitizeKeys([k1, { id: 'broken' }, { ...k1, key: 'sk-newer' }])).toEqual([{ ...k1, key: 'sk-newer' }]);
    expect(sanitizeKeys('nope')).toEqual([]);
  });
});
