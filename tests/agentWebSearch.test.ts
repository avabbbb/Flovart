import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSearchQuery,
  formatSearchSources,
  parseSearchResponse,
  resolveSearchCredential,
  searchAgentWeb,
} from '../services/agentWebSearch';
import { branchEntryIndex, entriesUpTo } from '../services/browserAgentKernel';
import type { UserApiKey } from '../types';

const key = (over: Partial<UserApiKey>): UserApiKey => ({
  id: 'k1', provider: 'deepseek', capabilities: ['text'], key: 'sk-deepseek', createdAt: 1, updatedAt: 1, ...over,
});

describe('agent web search', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('finds a DeepSeek key by provider or base URL and ignores broken keys', () => {
    expect(resolveSearchCredential([key({})])).toEqual({ key: 'sk-deepseek', baseUrl: 'https://api.deepseek.com' });
    expect(resolveSearchCredential([key({ provider: 'custom', baseUrl: 'https://api.deepseek.com/v1/' })]))
      .toEqual({ key: 'sk-deepseek', baseUrl: 'https://api.deepseek.com/v1' });
    expect(resolveSearchCredential([key({ status: 'error' })])).toBeNull();
    expect(resolveSearchCredential([key({ provider: 'openai', baseUrl: 'https://api.openai.com' })])).toBeNull();
  });

  it('turns recency into an after: bound only when the query has none', () => {
    const query = buildSearchQuery('龙 喷火', 'week');
    expect(query).toMatch(/^龙 喷火 after:\d{4}-\d{2}-\d{2}$/);
    expect(buildSearchQuery('龙 after:2026-01-01', 'week')).toBe('龙 after:2026-01-01');
    expect(buildSearchQuery('龙', undefined)).toBe('龙');
  });

  it('keeps http(s) sources, prefers summary, and caps the count', () => {
    const sources = parseSearchResponse({
      results: [
        { title: 'A', url: 'https://a.example/1', summary: 'long excerpt', snippet: 'short' },
        { title: 'B', url: 'javascript:alert(1)' },
        { title: 'C', url: 'https://c.example/3', snippet: 'fallback' },
      ],
    }, 2);
    expect(sources).toEqual([
      { title: 'A', url: 'https://a.example/1', snippet: 'long excerpt', publishedDate: undefined },
      { title: 'C', url: 'https://c.example/3', snippet: 'fallback', publishedDate: undefined },
    ]);
  });

  it('posts the DeepSeek contract and formats the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{ title: '示例', url: 'https://example.com/a', summary: '摘要', date: '2026-11-01' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchAgentWeb({ credential: { key: 'sk-test', baseUrl: 'https://api.deepseek.com' }, query: '测试', limit: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body))).toEqual({ query: '测试', count: 3 });
    expect(result.sources[0]).toMatchObject({ url: 'https://example.com/a', snippet: '摘要' });
    expect(formatSearchSources(result.sources)).toContain('1. 示例 (2026-11-01)');
  });

  it('rejects an overlong query before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchAgentWeb({
      credential: { key: 'sk-test', baseUrl: 'https://api.deepseek.com' },
      query: '龙'.repeat(129),
    })).rejects.toThrow('128');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('branch point resolution', () => {
  const entries = [
    { id: 'e1', message: { id: 'm1' } },
    { id: 'e2', message: { id: 'm2' } },
    { id: 'e3', message: { id: 'm3' } },
  ];

  it('matches entry ids first, then message ids', () => {
    expect(branchEntryIndex(entries, ['e2'])).toBe(1);
    expect(branchEntryIndex(entries, ['m3'])).toBe(2);
  });

  it('tries candidates in order and reports a missing point', () => {
    expect(branchEntryIndex(entries, ['missing', 'm1'])).toBe(0);
    expect(branchEntryIndex(entries, ['missing'])).toBe(-1);
    expect(entriesUpTo(entries, 'e2')?.map(entry => entry.id)).toEqual(['e1', 'e2']);
  });
});
