import { describe, expect, it, vi } from 'vitest';
import type { UserApiKey } from '../types';
import {
  WebDavError,
  buildSyncPayload,
  joinWebDavUrl,
  mergeSyncPayload,
  parseSyncPayload,
  syncWebDav,
  testWebDavConnection,
  type WebDavConfig,
} from '../services/webdavSync';

// URL 用拼接构造，避免字面量在传输中被吞。
const DAV = 'https' + String.fromCharCode(58) + '//dav.example.com';

const config: WebDavConfig = { url: DAV + '/dav/', remoteDir: '/flovart/', username: 'u', password: 'p' };

function key(patch: Partial<UserApiKey> = {}): UserApiKey {
  return {
    id: 'k1',
    provider: 'openai',
    capabilities: ['text'],
    key: 'sk-secret',
    name: 'Default',
    baseUrl: '',
    extraConfig: { requestFormat: 'openai', apiKeyHeader: 'x', remark: 'r' },
    createdAt: 1,
    updatedAt: 10,
    ...patch,
  };
}

describe('webdavSync', () => {
  it('joins urls and encodes segments', () => {
    expect(joinWebDavUrl(config.url, '/flovart/', 'a b.json')).toBe(DAV + '/dav/flovart/a%20b.json');
    expect(joinWebDavUrl(config.url, '')).toBe(DAV + '/dav');
  });

  it('never puts api keys or secret-like extra fields into the payload', () => {
    const payload = buildSyncPayload([key(), key({ id: 'k2', runtimeManaged: { credentialId: 'c' } })], 99);
    const text = JSON.stringify(payload);
    expect(text).not.toContain('sk-secret');
    expect(payload.channels).toHaveLength(1);
    expect(payload.channels[0].extraConfig).toEqual({ requestFormat: 'openai', remark: 'r' });
  });

  it('merges newer remote channels but keeps the local key', () => {
    const payload = buildSyncPayload([key({ name: 'Remote', updatedAt: 20, key: 'other' }), key({ id: 'k3', updatedAt: 5 })]);
    const result = mergeSyncPayload([key()], payload);
    expect(result.updatedIds).toEqual(['k1']);
    expect(result.merged[0].name).toBe('Remote');
    expect(result.merged[0].key).toBe('sk-secret');
    expect(result.merged[0].extraConfig?.apiKeyHeader).toBe('x');
    expect(result.missingLocally.map(item => item.id)).toEqual(['k3']);
  });

  it('keeps local channels that are newer than remote', () => {
    const payload = buildSyncPayload([key({ name: 'Old', updatedAt: 3 })]);
    expect(mergeSyncPayload([key()], payload).merged[0].name).toBe('Default');
  });

  it('rejects foreign or newer payloads', () => {
    expect(() => parseSyncPayload('{"app":"x","channels":[]}')).toThrow(WebDavError);
    expect(() => parseSyncPayload({ app: 'flovart', version: 99, channels: [] })).toThrow(/版本/);
  });

  it('creates the remote dir when PROPFIND returns 404 and sends basic auth', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    await expect(testWebDavConnection(config, fetchImpl)).resolves.toEqual({ dirCreated: true });
    expect(fetchImpl.mock.calls[0][0]).toBe(DAV + '/dav/flovart/');
    expect(fetchImpl.mock.calls[1][1].method).toBe('MKCOL');
    expect((fetchImpl.mock.calls[0][1].headers as Headers).get('Authorization')).toBe('Basic ' + btoa('u:p'));
  });

  it('maps 401 to UNAUTHORIZED and network failures to NETWORK', async () => {
    await expect(testWebDavConnection(config, vi.fn().mockResolvedValue(new Response(null, { status: 401 })))).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(testWebDavConnection(config, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(testWebDavConnection({ ...config, url: 'ftp://x' }, vi.fn())).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('syncs: pull (404 = empty) then push a secret-free payload', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 207 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const result = await syncWebDav(config, [key()], fetchImpl, 123);
    expect(result.updatedIds).toEqual([]);
    const put = fetchImpl.mock.calls[2];
    expect(put[1].method).toBe('PUT');
    expect(put[0]).toBe(DAV + '/dav/flovart/flovart-settings.json');
    expect(String(put[1].body)).not.toContain('sk-secret');
  });
});
