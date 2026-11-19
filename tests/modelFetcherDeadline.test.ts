import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModelsWithCache, MODEL_DISCOVERY_TIMEOUT_MS } from '../services/modelFetcher';

// GitHub #43：模型发现的截止时间必须覆盖读取响应体，而不只是等响应头。
const cache = localforage.createInstance({ name: 'iris', storeName: 'provider_model_cache' });
const originalFetch = globalThis.fetch;

function headersOnlyResponse(text: () => Promise<string>, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
  } as unknown as Response;
}

describe('model discovery deadline (#43)', () => {
  beforeEach(async () => {
    await cache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('times out when headers arrive but the body stalls', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(headersOnlyResponse(() => new Promise<string>(() => {})));

    const pending = fetchModelsWithCache('custom', 'sk-stalled-body', 'https://stall.example/v1', true);
    await vi.advanceTimersByTimeAsync(MODEL_DISCOVERY_TIMEOUT_MS + 10);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/超时/);
  });

  it('times out when the response headers never arrive', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise<Response>(() => {}));

    const pending = fetchModelsWithCache('custom', 'sk-stalled-head', 'https://stall-head.example/v1', true);
    await vi.advanceTimersByTimeAsync(MODEL_DISCOVERY_TIMEOUT_MS + 10);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/超时/);
  });

  it('still parses a normal response that finishes before the deadline', async () => {
    vi.useRealTimers();
    globalThis.fetch = vi.fn().mockResolvedValue(
      headersOnlyResponse(() => Promise.resolve(JSON.stringify({ data: [{ id: 'model-a' }] }))),
    );

    const result = await fetchModelsWithCache('custom', 'sk-normal', 'https://normal.example/v1', true);

    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.id)).toContain('model-a');
  });
});
