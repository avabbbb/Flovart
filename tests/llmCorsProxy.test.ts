// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleLlmProxy, resolveUpstreamUrl } from '../server/llmProxy';
import { toProxiedUrl } from '../services/llmCorsProxy';

const ORIGIN = 'https://iris.avabbbb.com';
const CHAT = `${ORIGIN}/api/llm-proxy/opencode.ai/inference/go/openai/v1/chat/completions`;

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(url, {
    method: 'POST',
    ...init,
    headers: { origin: ORIGIN, authorization: 'Bearer sk-test', 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

describe('toProxiedUrl', () => {
  it('rewrites opencode.ai to same-origin proxy', () => {
    expect(toProxiedUrl('https://opencode.ai/inference/go/openai/v1/chat/completions', ORIGIN))
      .toBe(CHAT);
  });
  it('leaves other providers alone', () => {
    expect(toProxiedUrl('https://api.openai.com/v1/chat/completions', ORIGIN)).toBeNull();
    expect(toProxiedUrl('/api/llm-proxy/opencode.ai/x', ORIGIN)).toBeNull();
  });
});

describe('resolveUpstreamUrl', () => {
  it('allows allowlisted host + prefix and keeps query', () => {
    expect(resolveUpstreamUrl(new URL(`${ORIGIN}/api/llm-proxy/opencode.ai/zen/go/v1/models?a=1`))?.toString())
      .toBe('https://opencode.ai/zen/go/v1/models?a=1');
  });
  it('rejects other hosts, other paths and traversal', () => {
    for (const p of [
      '/api/llm-proxy/evil.com/inference/x',
      '/api/llm-proxy/opencode.ai/console/secret',
      '/api/llm-proxy/opencode.ai/inference/../console',
      '/api/llm-proxy/opencode.ai/inference/%2e%2e/console',
      '/api/llm-proxy/opencode.ai@evil.com/inference/x',
    ]) expect(resolveUpstreamUrl(new URL(`${ORIGIN}${p}`))).toBeNull();
  });
});

describe('handleLlmProxy', () => {
  it('forwards allowed headers, sets UA, streams SSE back', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const h = init.headers as Headers;
      expect(h.get('authorization')).toBe('Bearer sk-test');
      expect(h.get('x-opencode-session')).toBe('ses_abc');
      expect(h.get('cookie')).toBeNull();
      expect(h.get('user-agent')).toMatch(/^iris-web\//);
      return new Response('data: {"x":1}\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const res = await handleLlmProxy(req(CHAT, { body: '{}', headers: { 'x-opencode-session': 'ses_abc', cookie: 'a=b' } }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledWith('https://opencode.ai/inference/go/openai/v1/chat/completions', expect.anything());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toContain('[DONE]');
  });
  it('passes upstream errors through', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":{"message":"Invalid API key"}}', { status: 401, headers: { 'content-type': 'application/json' } }));
    const res = await handleLlmProxy(req(CHAT, { body: '{}' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid API key');
  });
  it('rejects cross-origin callers, missing key, other methods', async () => {
    const fetchImpl = vi.fn();
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    expect((await handleLlmProxy(req(CHAT, { body: '{}', headers: { origin: 'https://evil.com' } }), opts)).status).toBe(403);
    const noKey = new Request(CHAT, { method: 'POST', body: '{}', headers: { origin: ORIGIN } });
    expect((await handleLlmProxy(noKey, opts)).status).toBe(401);
    expect((await handleLlmProxy(req(CHAT, { method: 'DELETE' }), opts)).status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('handleLlmProxy — RunningHub public docs', () => {
  const DOC_CN = `${ORIGIN}/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-cn/api-519905081.md`;
  const LLMS_EN = `${ORIGIN}/api/llm-proxy/www.runninghub.ai/runninghub-api-doc-en/llms.txt`;
  const docReq = (url: string, init: RequestInit & { headers?: Record<string, string> } = {}) => new Request(url, {
    method: 'GET',
    ...init,
    headers: { origin: ORIGIN, ...(init.headers || {}) },
  });

  it('allows key-less GET of doc markdown and llms.txt, without forwarding credentials', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const h = init.headers as Headers;
      expect(h.get('authorization')).toBeNull();
      expect(h.get('cookie')).toBeNull();
      return new Response('# doc', { status: 200, headers: { 'content-type': 'text/markdown' } });
    });
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    const res = await handleLlmProxy(docReq(DOC_CN, { headers: { authorization: 'Bearer sk-should-not-leak', cookie: 'a=b' } }), opts);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# doc');
    expect((await handleLlmProxy(docReq(LLMS_EN), opts)).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith('https://www.runninghub.cn/runninghub-api-doc-cn/api-519905081.md', expect.anything());
    expect(fetchImpl).toHaveBeenCalledWith('https://www.runninghub.ai/runninghub-api-doc-en/llms.txt', expect.anything());
  });

  it('rejects POST, non-doc resources, other doc prefixes and cross-origin callers', async () => {
    const fetchImpl = vi.fn();
    const opts = { fetchImpl: fetchImpl as unknown as typeof fetch };
    expect((await handleLlmProxy(docReq(DOC_CN, { method: 'POST', body: '{}', headers: { authorization: 'Bearer x' } }), opts)).status).toBe(400);
    expect((await handleLlmProxy(docReq(`${ORIGIN}/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-cn/index.html`), opts)).status).toBe(400);
    expect((await handleLlmProxy(docReq(`${ORIGIN}/api/llm-proxy/www.runninghub.cn/openapi/v2/seedream-v5-flash/text-to-image`), opts)).status).toBe(400);
    expect((await handleLlmProxy(docReq(`${ORIGIN}/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-en/llms.txt`), opts)).status).toBe(400);
    expect((await handleLlmProxy(docReq(DOC_CN, { headers: { origin: 'https://evil.com' } }), opts)).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
