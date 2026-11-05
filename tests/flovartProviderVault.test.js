import { describe, expect, it } from 'vitest';

import { readVaultProviderStatus } from '../tools/flovart/provider-vault.js';

const connection = { url: 'http://127.0.0.1:37522', token: 'agent-token-123' };

function fakeFetch(status, payload, calls = []) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
}

describe('provider vault status', () => {
  it('returns masked providers from the Agent vault and drops any secret field', async () => {
    const calls = [];
    const status = await readVaultProviderStatus({
      connection,
      fetchImpl: fakeFetch(200, {
        ok: true,
        keyring: { available: true },
        credentials: [
          { provider: 'volcengine', keyId: 'k1', label: 'Ark', mask: 'sk-…abcd', updatedAt: 1, secret: 'sk-live-should-not-leak' },
          { provider: 'volcengine', keyId: 'k2', label: null, mask: '…wxyz', updatedAt: 2 },
        ],
      }, calls),
    });

    expect(calls[0].url).toBe('http://127.0.0.1:37522/credentials');
    expect(calls[0].init.headers['x-flovart-agent-token']).toBe('agent-token-123');
    expect(status).toMatchObject({ ok: true, source: 'agent-vault', mirrorOf: 'browser-settings', ready: true, count: 2, providers: ['volcengine'] });
    expect(JSON.stringify(status)).not.toContain('sk-live-should-not-leak');
  });

  it('is not ready when the keyring is unavailable', async () => {
    const status = await readVaultProviderStatus({
      connection,
      fetchImpl: fakeFetch(200, { ok: true, keyring: { available: false, error: 'no backend' }, credentials: [{ provider: 'openai', keyId: 'k', mask: '…' }] }),
    });
    expect(status).toMatchObject({ ready: false, keyring: { available: false, error: 'no backend' } });
  });

  it('maps a rejected token to AGENT_AUTH_FAILED', async () => {
    await expect(readVaultProviderStatus({ connection, fetchImpl: fakeFetch(401, { ok: false }) }))
      .rejects.toMatchObject({ code: 'AGENT_AUTH_FAILED' });
  });

  it('maps a network failure to a retryable AGENT_UNAVAILABLE', async () => {
    const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
    await expect(readVaultProviderStatus({ connection, fetchImpl }))
      .rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE', retryable: true });
  });
});
