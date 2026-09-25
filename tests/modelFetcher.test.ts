import localforage from 'localforage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchModelsForProvider, fetchModelsWithCache } from '../services/modelFetcher';

const modelCache = localforage.createInstance({ name: 'flovart', storeName: 'provider_model_cache' });

function responseFor(id: string) {
  return new Response(JSON.stringify({ data: [{ id, name: id }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(async () => {
  await modelCache.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('model discovery cache identity', () => {
  it('reuses a model list for the same provider, key, and normalized endpoint', async () => {
    const fetch = vi.fn(async () => responseFor('image-generation-model'));
    vi.stubGlobal('fetch', fetch);

    const first = await fetchModelsWithCache('custom', 'first-private-key-123456789', 'https://models.example.test/v1/');
    const second = await fetchModelsWithCache('custom', 'first-private-key-123456789', 'https://models.example.test/v1');

    expect(first.ok).toBe(true);
    expect(second.models.map(model => model.id)).toEqual(['image-generation-model']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('isolates cache entries for different keys at the same provider and endpoint', async () => {
    let requestNumber = 0;
    const fetch = vi.fn(async () => responseFor(`model-${++requestNumber}`));
    vi.stubGlobal('fetch', fetch);

    const first = await fetchModelsWithCache('custom', 'first-private-key-123456789', 'https://models.example.test/v1');
    const second = await fetchModelsWithCache('custom', 'second-private-key-987654321', 'https://models.example.test/v1');

    expect(first.models[0]?.id).toBe('model-1');
    expect(second.models[0]?.id).toBe('model-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('isolates cache entries for the same key at different base URLs', async () => {
    let requestNumber = 0;
    const fetch = vi.fn(async () => responseFor(`model-${++requestNumber}`));
    vi.stubGlobal('fetch', fetch);

    const first = await fetchModelsWithCache('custom', 'same-private-key-123456789', 'https://one.example.test/v1');
    const second = await fetchModelsWithCache('custom', 'same-private-key-123456789', 'https://two.example.test/v1');

    expect(first.models[0]?.id).toBe('model-1');
    expect(second.models[0]?.id).toBe('model-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses the existing cache entry', async () => {
    let requestNumber = 0;
    const fetch = vi.fn(async () => responseFor(`model-${++requestNumber}`));
    vi.stubGlobal('fetch', fetch);
    const credentials = ['custom', 'refresh-private-key-123456789', 'https://refresh.example.test/v1'] as const;

    const first = await fetchModelsWithCache(...credentials);
    const refreshed = await fetchModelsWithCache(...credentials, true);

    expect(first.models[0]?.id).toBe('model-1');
    expect(refreshed.models[0]?.id).toBe('model-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('fetches again after the cached entry expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    let requestNumber = 0;
    const fetch = vi.fn(async () => responseFor(`model-${++requestNumber}`));
    vi.stubGlobal('fetch', fetch);
    const credentials = ['custom', 'expiring-private-key-123456789', 'https://expiry.example.test/v1'] as const;

    const first = await fetchModelsWithCache(...credentials);
    now.mockReturnValue(3_601_001);
    const expired = await fetchModelsWithCache(...credentials);

    expect(first.models[0]?.id).toBe('model-1');
    expect(expired.models[0]?.id).toBe('model-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stores no recognizable API key fragment in localforage cache keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => responseFor('safe-model')));
    const credential = 'recognizable-private-key-123456789';

    await fetchModelsWithCache('custom', credential, 'https://safe.example.test/v1');

    const keys = await modelCache.keys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(credential);
    expect(keys[0]).not.toContain(credential.slice(0, 6));
    expect(keys[0]).not.toContain(credential.slice(-4));
  });
});

describe('Google model discovery authentication', () => {
  it('sends the key in x-goog-api-key and never in the URL or returned errors', async () => {
    const credential = 'google-private-key-not-for-url-123';
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ error: { message: `invalid key ${credential}` } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const result = await fetchModelsForProvider('google', credential, 'https://google-compatible.example.test/v1beta/models/');

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://google-compatible.example.test/v1beta/models');
    expect(requests[0].url).not.toContain(credential);
    expect(requests[0].headers.get('x-goog-api-key')).toBe(credential);
    expect(result.error).not.toContain(credential);
  });
});
