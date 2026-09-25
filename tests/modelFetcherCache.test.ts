import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModelsWithCache } from '../services/modelFetcher';

const cache = localforage.createInstance({ name: 'flovart', storeName: 'provider_model_cache' });
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: {
      get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
  } as Response;
}

describe('modelFetcher cache identity and auth', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reuses cache only for the same provider, key and endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));

    const first = await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');
    const second = await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('isolates cache entries for different credentials', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));

    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');
    await fetchModelsWithCache('custom', 'sk-cache-b', 'https://one.example/v1');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('isolates cache entries for different normalized base URLs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));

    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');
    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://two.example/v1');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh bypasses an otherwise valid cache entry', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));

    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');
    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1', true);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('expires cache entries after the one-hour TTL', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'model-a' }] }));

    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');
    now += 60 * 60 * 1000 + 1;
    await fetchModelsWithCache('custom', 'sk-cache-a', 'https://one.example/v1');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('sends Google model-discovery credentials in x-goog-api-key, not the URL', async () => {
    const secret = 'google-secret-key-value';
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({
      models: [{
        name: 'models/gemini-test',
        displayName: 'Gemini Test',
        supportedGenerationMethods: ['generateContent'],
      }],
    }));

    const result = await fetchModelsWithCache(
      'google',
      secret,
      'https://generativelanguage.googleapis.com/v1beta',
      true,
    );

    expect(result.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(String(url)).not.toContain(secret);
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': secret }),
      signal: expect.anything(),
    }));
  });
});
