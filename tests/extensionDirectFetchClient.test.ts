// @vitest-environment node
// 网页侧 LLM 传输层：插件可用时直连（流式、可取消），否则或首字节前失败时回退 /api/llm-proxy。
import { describe, expect, it, vi } from 'vitest';
import { createLlmProxyFetch, getLlmTransportMode, upstreamFromProxyUrl } from '../services/llmCorsProxy';
import { extensionDirectFetch, ExtensionDirectUnavailableError } from '../services/extensionDirectFetch';
import { createDirectFetchHandler } from '../extension/background/direct-fetch.js';
import { fakePortPair } from './helpers/fakePortPair';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }));

const ORIGIN = 'https://iris.avabbbb.com';
const CHAT = 'https://opencode.ai/zen/v1/chat/completions';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** 一个“已批准、声明了 llm.fetch”的桥，Port 直接连到真实的插件端 handler。 */
function bridgeTo(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, options: { capable?: boolean; approved?: boolean } = {}) {
  const handler = createDirectFetchHandler({ fetchImpl: fetchImpl as any, isApprovedOrigin: async () => options.approved ?? true });
  const opened: string[] = [];
  return {
    opened,
    supports: (capability: string) => (options.capable ?? true) && capability === 'llm.fetch',
    openChannel(name: string) {
      opened.push(name);
      const { web, ext } = fakePortPair(name, ORIGIN);
      handler(ext as any);
      return web as any;
    },
  };
}

function sse(chunks: string[], hold?: Promise<void>) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(chunks[0]));
      if (hold) await hold;
      for (const chunk of chunks.slice(1)) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const chatInit = (signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { authorization: 'Bearer sk-test', 'content-type': 'application/json' },
  body: JSON.stringify({ stream: true }),
  signal,
});

describe('LLM transport (extension direct vs proxy)', () => {
  it('maps same-origin proxy URLs back to their upstream', () => {
    expect(upstreamFromProxyUrl('/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-cn/llms.txt', ORIGIN))
      .toBe('https://www.runninghub.cn/runninghub-api-doc-cn/llms.txt');
    expect(upstreamFromProxyUrl('https://other.example/api/llm-proxy/opencode.ai/zen/x', ORIGIN)).toBeNull();
    expect(upstreamFromProxyUrl('/api/other', ORIGIN)).toBeNull();
  });

  it('reports the mode from the bridge capability', () => {
    expect(getLlmTransportMode(bridgeTo(vi.fn()))).toBe('extension');
    expect(getLlmTransportMode(bridgeTo(vi.fn(), { capable: false }))).toBe('proxy');
    expect(getLlmTransportMode(null)).toBe('proxy');
  });

  it('uses the proxy unchanged when no capable extension is paired', async () => {
    const nativeFetch = vi.fn(async () => new Response('ok'));
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridgeTo(vi.fn(), { capable: false }) });
    await fetcher(CHAT, chatInit());
    expect((nativeFetch.mock.calls[0] as any)[0]).toBe(`${ORIGIN}/api/llm-proxy/opencode.ai/zen/v1/chat/completions`);
    const docUrl = '/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-cn/llms.txt';
    await fetcher(docUrl);
    expect((nativeFetch.mock.calls[1] as any)[0]).toBe(docUrl);
    // 非网关请求原样透传
    await fetcher('https://api.openai.com/v1/models');
    expect((nativeFetch.mock.calls[2] as any)[0]).toBe('https://api.openai.com/v1/models');
  });

  it('streams through the extension and never touches the Worker proxy', async () => {
    const nativeFetch = vi.fn();
    const upstream = vi.fn(async () => new Response(sse(['data: 1\n\n', 'data: 2\n\n']), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    const bridge = bridgeTo(upstream);
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridge });
    const response = await fetcher(CHAT, chatInit());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('x-flovart-transport')).toBe('extension');
    expect(await response.text()).toBe('data: 1\n\ndata: 2\n\n');
    expect(nativeFetch).not.toHaveBeenCalled();
    const [url, init] = upstream.mock.calls[0] as any;
    expect(url).toBe(CHAT);
    expect((init.headers as Headers).get('x-opencode-session')).toMatch(/^ses_iris_/);
    expect(new TextDecoder().decode(init.body)).toBe('{"stream":true}');
  });

  it('carries the RunningHub doc proxy path directly too', async () => {
    const nativeFetch = vi.fn();
    const upstream = vi.fn(async () => new Response('# llms', { status: 200 }));
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridgeTo(upstream) });
    const response = await fetcher('/api/llm-proxy/www.runninghub.cn/runninghub-api-doc-cn/llms.txt');
    expect(await response.text()).toBe('# llms');
    expect((upstream.mock.calls[0] as any)[0]).toBe('https://www.runninghub.cn/runninghub-api-doc-cn/llms.txt');
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('falls back to the proxy with the same body when the extension fails before the first byte', async () => {
    for (const bridge of [
      bridgeTo(async () => { throw new TypeError('network'); }),
      bridgeTo(vi.fn(), { approved: false }),
      { supports: () => true, openChannel: () => null },
    ]) {
      const nativeFetch = vi.fn(async () => new Response('via proxy'));
      const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridge as any });
      const response = await fetcher(CHAT, chatInit());
      expect(await response.text()).toBe('via proxy');
      const [url, init] = nativeFetch.mock.calls[0] as any;
      expect(url).toBe(`${ORIGIN}/api/llm-proxy/opencode.ai/zen/v1/chat/completions`);
      expect(new TextDecoder().decode(init.body)).toBe('{"stream":true}');
      expect((init.headers as Headers).get('authorization')).toBe('Bearer sk-test');
    }
  });

  it('falls back when the extension never accepts the request', async () => {
    vi.useFakeTimers();
    try {
      const silent = { supports: () => true, openChannel: () => fakePortPair('iris-fetch', ORIGIN).web as any };
      const pending = extensionDirectFetch(silent, { url: CHAT, method: 'POST', headers: new Headers() });
      const assertion = expect(pending).rejects.toBeInstanceOf(ExtensionDirectUnavailableError);
      await vi.advanceTimersByTimeAsync(5000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts mid-stream: the page sees AbortError and the upstream request is cancelled', async () => {
    let upstreamSignal: AbortSignal | undefined;
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal ?? undefined;
      return new Response(sse(['data: 1\n\n', 'data: 2\n\n'], hold), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const nativeFetch = vi.fn();
    const controller = new AbortController();
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridgeTo(upstream) });
    const response = await fetcher(CHAT, chatInit(controller.signal));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('data: 1\n\n');
    controller.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    for (let i = 0; i < 5; i += 1) await tick();
    expect(upstreamSignal?.aborted).toBe(true);
    release();
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('does not fall back (or resend) once the response has started', async () => {
    const nativeFetch = vi.fn();
    const upstream = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: 1\n\n'));
        setTimeout(() => controller.error(new Error('reset')), 0);
      },
    }), { status: 200 }));
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridgeTo(upstream) });
    const response = await fetcher(CHAT, chatInit());
    await expect(response.text()).rejects.toThrow();
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('rejects with AbortError and no fallback when aborted before the head', async () => {
    const nativeFetch = vi.fn();
    const upstream = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const controller = new AbortController();
    const fetcher = createLlmProxyFetch({ nativeFetch: nativeFetch as any, origin: ORIGIN, getDirectBridge: () => bridgeTo(upstream) });
    const pending = fetcher(CHAT, chatInit(controller.signal));
    for (let i = 0; i < 5; i += 1) await tick();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(nativeFetch).not.toHaveBeenCalled();
  });
});
