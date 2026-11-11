import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSearchQuery,
  formatSearchSources,
  parseParallelPayload,
  parseSearchResponse,
  resolveSearchCredential,
  searchAgentWeb,
  searchDeepSeekWeb,
  searchParallelWeb,
} from '../services/agentWebSearch';
import { branchEntryIndex, createBrowserAgentTools, entriesUpTo } from '../services/browserAgentKernel';
import type { UserApiKey } from '../types';

const key = (over: Partial<UserApiKey>): UserApiKey => ({
  id: 'k1', provider: 'deepseek', capabilities: ['text'], key: 'sk-deepseek', createdAt: 1, updatedAt: 1, ...over,
});

const jsonRpc = (id: string, payload: unknown) => new Response(JSON.stringify({
  jsonrpc: '2.0',
  id,
  result: { content: [{ type: 'text', text: JSON.stringify(payload) }] },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

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

  it('parses Parallel results from excerpts and publish_date', () => {
    const sources = parseParallelPayload({
      search_id: 's1',
      results: [
        { title: 'A', url: 'https://a.example/1', excerpts: ['first', 'second'], publish_date: '2026-11-01' },
        { title: 'B', url: 'javascript:alert(1)' },
        { title: 'C', url: 'https://c.example/3' },
      ],
    }, 2);
    expect(sources).toEqual([
      { title: 'A', url: 'https://a.example/1', snippet: 'first second', publishedDate: '2026-11-01' },
      { title: 'C', url: 'https://c.example/3', snippet: undefined, publishedDate: undefined },
    ]);
  });

  it('keeps the DeepSeek parser: summary over snippet, http only, capped', () => {
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

  it('posts the Parallel MCP contract keyless and reads the JSON-RPC result', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'web_search' } });
      expect(body.params.arguments.objective).toBe('Flovart');
      return jsonRpc(body.id, { search_id: 's', results: [{ title: 'T', url: 'https://t.example', excerpts: ['x'] }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const sources = await searchParallelWeb({ query: 'Flovart', limit: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://search.parallel.ai/mcp');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Accept).toContain('text/event-stream');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(sources).toEqual([{ title: 'T', url: 'https://t.example/', snippet: 'x', publishedDate: undefined }]);
  });

  it('reads an SSE-framed JSON-RPC response', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const event = JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { results: [{ title: 'S', url: 'https://s.example' }] } } });
      return new Response(`event: message\ndata: ${event}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }));
    const sources = await searchParallelWeb({ query: 'x' });
    expect(sources[0]).toMatchObject({ title: 'S', url: 'https://s.example/' });
  });

  it('falls back to DeepSeek when Parallel fails and a key exists', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.includes('parallel.ai')) return new Response('rate limited', { status: 429 });
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ results: [{ title: 'D', url: 'https://d.example', summary: 'ok' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchAgentWeb({
      query: 'x',
      credential: { key: 'sk-test', baseUrl: 'https://api.deepseek.com' },
    });
    expect(result.provider).toBe('deepseek');
    expect(result.sources[0]).toMatchObject({ title: 'D', url: 'https://d.example/' });
  });

  it('reports both failures when no fallback credential is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await expect(searchAgentWeb({ query: 'x' })).rejects.toThrow('Parallel 搜索失败（503）');
    await expect(searchAgentWeb({
      query: 'x',
      credential: { key: 'sk-test', baseUrl: 'https://api.deepseek.com' },
    })).rejects.toThrow('Parallel 与 DeepSeek 搜索都失败');
  });

  it('rejects an overlong DeepSeek query before calling the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchDeepSeekWeb({
      credential: { key: 'sk-test', baseUrl: 'https://api.deepseek.com' },
      query: '龙'.repeat(129),
    })).rejects.toThrow('128');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registers the search tool even without any credential', () => {
    const names = createBrowserAgentTools({ projectId: 'p', confirm: async () => true, activeChangeSetId: '' })
      .map(tool => tool.name);
    expect(names).toContain('flovart_web_search');
  });

  it('formats sources for the model', () => {
    expect(formatSearchSources([
      { title: 'A', url: 'https://a.example', snippet: 's', publishedDate: '2026-11-01' },
    ])).toBe('1. A (2026-11-01)\n   https://a.example\n   s');
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
