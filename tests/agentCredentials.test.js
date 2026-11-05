import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCredentialStore, CredentialError, KEYRING_SERVICE, maskSecret } from '../agent/credentials.js';

function fakeKeyring() {
  const entries = new Map();
  return {
    entries,
    set: (service, account, secret) => { entries.set(`${service}|${account}`, secret); },
    get: (service, account) => entries.get(`${service}|${account}`) ?? null,
    delete: (service, account) => entries.delete(`${service}|${account}`),
  };
}

describe('AgentCredentialStore', () => {
  let dir;
  let keyring;
  let store;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flovart-cred-'));
    keyring = fakeKeyring();
    store = new AgentCredentialStore({ dir, backend: keyring, now: () => 1000 });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('stores the secret under the Tauri service and provider:keyId account', async () => {
    const entry = await store.set({ provider: 'volcengine', keyId: 'k1', secret: 'sk-abcdefgh12345678', label: 'Ark' });
    expect(keyring.entries.get(`${KEYRING_SERVICE}|volcengine:k1`)).toBe('sk-abcdefgh12345678');
    expect(entry).toEqual({ provider: 'volcengine', keyId: 'k1', label: 'Ark', mask: '****5678', updatedAt: 1000 });
    expect(await store.readSecret('volcengine', 'k1')).toBe('sk-abcdefgh12345678');
  });

  it('never writes the plaintext secret to the metadata file', async () => {
    await store.set({ provider: 'openai', keyId: 'main', secret: 'sk-very-secret-value-9999' });
    const raw = await fs.readFile(path.join(dir, 'credentials.json'), 'utf8');
    expect(raw).not.toContain('sk-very-secret-value');
    expect(await store.list()).toEqual([{ provider: 'openai', keyId: 'main', label: null, mask: '****9999', updatedAt: 1000 }]);
  });

  it('upserts by provider and keyId, and deletes from keyring and metadata', async () => {
    await store.set({ provider: 'google', keyId: 'g', secret: 'first-secret-0001' });
    await store.set({ provider: 'google', keyId: 'g', secret: 'second-secret-0002' });
    expect(await store.list('google')).toHaveLength(1);
    expect(await store.delete({ provider: 'google', keyId: 'g' })).toBe(true);
    expect(await store.list()).toEqual([]);
    expect(await store.readSecret('google', 'g')).toBeNull();
    expect(await store.delete({ provider: 'google', keyId: 'g' })).toBe(false);
  });

  it("rejects ':' injection and empty secrets", async () => {
    await expect(store.set({ provider: 'open:ai', keyId: 'k', secret: 'x'.repeat(12) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.set({ provider: 'openai', keyId: 'a:b', secret: 'x'.repeat(12) })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(store.set({ provider: 'openai', keyId: 'k', secret: '  ' })).rejects.toBeInstanceOf(CredentialError);
    expect(keyring.entries.size).toBe(0);
  });

  it('maps keyring write failures to KEYRING_UNAVAILABLE and keeps status readable', async () => {
    const broken = new AgentCredentialStore({ dir, backend: { set() { throw new Error('locked'); }, get() { return null; }, delete() { return false; } } });
    await expect(broken.set({ provider: 'openai', keyId: 'k', secret: 'sk-123456789' })).rejects.toMatchObject({ code: 'KEYRING_UNAVAILABLE' });
    const status = await broken.status();
    expect(status.keyring.available).toBe(true);
    expect(status.count).toBe(0);
  });

  it('masks short secrets completely', () => {
    expect(maskSecret('abc')).toBe('****');
  });
});
