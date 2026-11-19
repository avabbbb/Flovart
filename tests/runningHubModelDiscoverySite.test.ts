import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchModelsWithCache, runningHubDocsModelUrl } from '../services/modelFetcher';

// 2026-11-15 评测：「获取模型」必须读取与用户 Base URL 同一站点的模型目录（国内站 / 国际站）。
const cache = localforage.createInstance({ name: 'iris', storeName: 'provider_model_cache' });
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function pageResponse(endpoint: string): Response {
  // 最小的 Nuxt 数据：一条图片模型
  const data = [{ name: 1, categoryName: 2, sourceTypeName: 3, description: 4 }, endpoint, '图片生成', '官方', 'demo'];
  return new Response(`<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

describe('RunningHub model discovery site', () => {
  beforeEach(async () => {
    await cache.clear();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('maps base URLs to the matching docs site', () => {
    expect(runningHubDocsModelUrl('https://www.runninghub.cn/openapi/v2')).toBe('https://www.runninghub.cn/page-api');
    expect(runningHubDocsModelUrl('https://runninghub.cn/openapi/v2')).toBe('https://www.runninghub.cn/page-api');
    expect(runningHubDocsModelUrl('https://www.runninghub.ai/openapi/v2')).toBe('https://www.runninghub.ai/page-api');
    expect(runningHubDocsModelUrl('https://runninghub.ai')).toBe('https://www.runninghub.ai/page-api');
    expect(runningHubDocsModelUrl(undefined)).toBe('https://www.runninghub.cn/page-api');
    expect(runningHubDocsModelUrl('https://evil-runninghub.ai.example.com/v2')).toBe('https://www.runninghub.cn/page-api');
  });

  for (const [site, baseUrl, expected] of [
    ['cn', 'https://www.runninghub.cn/openapi/v2', 'https://www.runninghub.cn/page-api'],
    ['ai', 'https://www.runninghub.ai/openapi/v2', 'https://www.runninghub.ai/page-api'],
  ] as const) {
    it(`reads the ${site} catalogue when the base URL is the ${site} site`, async () => {
      const calls: string[] = [];
      globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/query')) return jsonResponse({ code: 404, msg: 'task not found' });
        if (url.endsWith('/page-api')) return pageResponse(`rhart-image-${site}-only/text-to-image`);
        throw new Error(`unexpected ${url}`);
      }) as typeof fetch;

      const result = await fetchModelsWithCache('runningHub', `rh-key-${site}`, baseUrl, true);

      expect(result.ok).toBe(true);
      const pageCalls = calls.filter(url => url.includes('page-api'));
      expect(pageCalls).toEqual([expected]);
      expect(calls.some(url => url.startsWith(baseUrl))).toBe(true);
      expect(result.models.some(model => model.id.includes(`${site}-only`))).toBe(true);
    });
  }
});
