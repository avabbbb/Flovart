// @vitest-environment node
// 插件直连上游：白名单与 Worker 代理一致、origin/配对校验、流式转发与取消。
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { LLM_PROXY_PUBLIC_DOC_UPSTREAMS, LLM_PROXY_UPSTREAMS } from '../server/llmProxy';
import {
  DIRECT_HOST_PERMISSIONS,
  DIRECT_PUBLIC_DOC_UPSTREAMS,
  DIRECT_UPSTREAMS,
  checkDirectUpstream,
} from '../extension/background/upstream-allowlist.js';
import { createDirectFetchHandler } from '../extension/background/direct-fetch.js';
import { fakePortPair } from './helpers/fakePortPair';

const ORIGIN = 'https://iris.avabbbb.com';
const CHAT = 'https://opencode.ai/zen/v1/chat/completions';
const DOC = 'https://www.runninghub.cn/runninghub-api-doc-cn/api-519905081.md';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async (n = 6) => { for (let i = 0; i < n; i += 1) await tick(); };
const b64 = (text: string) => Buffer.from(text).toString('base64');
const unb64 = (text: string) => Buffer.from(text, 'base64').toString();

function startRequest(options: {
  fetchImpl: typeof fetch;
  approved?: boolean;
  origin?: string;
  message?: Record<string, unknown>;
}) {
  const { web, ext } = fakePortPair('iris-fetch', options.origin ?? ORIGIN);
  const received: any[] = [];
  let disconnected = false;
  web.onMessage.addListener(message => received.push(message));
  web.onDisconnect.addListener(() => { disconnected = true; });
  const isApprovedOrigin = vi.fn(async (origin: string) => (options.approved ?? true) && origin === ORIGIN);
  createDirectFetchHandler({ fetchImpl: options.fetchImpl, isApprovedOrigin })(ext as any);
  web.postMessage({
    type: 'fetch.start',
    url: CHAT,
    method: 'POST',
    headers: [['authorization', 'Bearer sk-test'], ['content-type', 'application/json']],
    bodyBase64: b64('{"stream":true}'),
    ...options.message,
  });
  return { web, received, isApprovedOrigin, isDisconnected: () => disconnected };
}

describe('extension direct-fetch allowlist', () => {
  it('matches the Worker proxy allowlist exactly and the manifest grants only those hosts', () => {
    expect(DIRECT_UPSTREAMS).toEqual(LLM_PROXY_UPSTREAMS);
    expect(DIRECT_PUBLIC_DOC_UPSTREAMS).toEqual(LLM_PROXY_PUBLIC_DOC_UPSTREAMS);
    const manifest = JSON.parse(readFileSync('extension/manifest.json', 'utf8'));
    expect(manifest.host_permissions).toEqual(DIRECT_HOST_PERMISSIONS);
    expect(manifest.host_permissions.join(',')).not.toMatch(/<all_urls>|\*:\/\/\*|https?:\/\/\*\//);
  });

  it('accepts allowlisted host + path prefixes only', () => {
    expect(checkDirectUpstream(CHAT, 'POST').error).toBeUndefined();
    expect(checkDirectUpstream('https://opencode.ai/inference/go/openai/v1/chat/completions?x=1', 'post').error).toBeUndefined();
    expect(checkDirectUpstream(DOC, 'GET')).toMatchObject({ publicDoc: true });
    for (const url of [
      'https://evil.com/zen/v1',
      'http://opencode.ai/zen/v1',
      'https://opencode.ai/console/secret',
      'https://opencode.ai/zen/../console',
      'https://opencode.ai/zen/%2e%2e/console',
      'https://opencode.ai/zen/a%2fb',
      'https://opencode.ai@evil.com/zen/x',
      'https://user:pw@opencode.ai/zen/x',
      'https://opencode.ai:8443/zen/x',
      'https://OPENCODE.ai/zen/x',
      'https://opencode.ai.evil.com/zen/x',
      'https://www.runninghub.cn/runninghub-api-doc-cn/index.html',
      'https://www.runninghub.cn/openapi/v2/x',
    ]) expect(checkDirectUpstream(url, 'GET').error, url).toBe('upstream_not_allowed');
    expect(checkDirectUpstream(DOC, 'POST').error).toBe('upstream_not_allowed');
    expect(checkDirectUpstream(CHAT, 'DELETE').error).toBe('method_not_allowed');
  });
});

describe('extension direct-fetch handler', () => {
  it('refuses origins that are not paired/approved without calling upstream', async () => {
    const fetchImpl = vi.fn();
    const run = startRequest({ fetchImpl: fetchImpl as any, approved: false });
    await settle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.received).toEqual([expect.objectContaining({ type: 'fetch.error', code: 'forbidden_origin', beforeHead: true })]);
    await new Promise(resolve => setTimeout(resolve, 1100));
    expect(run.isDisconnected()).toBe(true);
  });

  it('refuses non-allowlisted upstreams (no open relay)', async () => {
    const fetchImpl = vi.fn();
    const run = startRequest({ fetchImpl: fetchImpl as any, message: { url: 'https://api.openai.com/v1/chat/completions' } });
    await settle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.received[0]).toMatchObject({ type: 'fetch.error', code: 'upstream_not_allowed', beforeHead: true });
  });

  it('requires an API key header for gateway calls', async () => {
    const fetchImpl = vi.fn();
    const run = startRequest({ fetchImpl: fetchImpl as any, message: { headers: [['content-type', 'application/json']] } });
    await settle();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(run.received[0]).toMatchObject({ code: 'missing_api_key' });
  });

  it('forwards only allowlisted headers, no cookies, no redirects, and streams chunks back', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"a":1}\n\n'));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream', 'set-cookie': 'a=b', 'x-request-id': 'r1' } }));
    const run = startRequest({
      fetchImpl: fetchImpl as any,
      message: { headers: [['authorization', 'Bearer sk-test'], ['cookie', 'sid=1'], ['x-evil', '1'], ['content-type', 'application/json']] },
    });
    await settle(10);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(CHAT);
    const headers = init.headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('x-evil')).toBeNull();
    expect(headers.get('x-opencode-session')).toMatch(/^ses_iris_/);
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', credentials: 'omit' });
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{"stream":true}');

    const types = run.received.map(message => message.type);
    expect(types).toEqual(['fetch.accepted', 'fetch.head', 'fetch.chunk', 'fetch.chunk', 'fetch.end']);
    const head = run.received[1];
    expect(head.status).toBe(200);
    expect(head.headers).toContainEqual(['content-type', 'text/event-stream']);
    expect(head.headers.map((entry: string[]) => entry[0])).not.toContain('set-cookie');
    expect(run.received.filter(m => m.type === 'fetch.chunk').map(m => unb64(m.data)).join('')).toBe('data: {"a":1}\n\ndata: [DONE]\n\n');
  });

  it('never forwards credentials to the public doc host', async () => {
    const fetchImpl = vi.fn(async () => new Response('# doc', { status: 200 }));
    startRequest({ fetchImpl: fetchImpl as any, message: { url: DOC, method: 'GET', bodyBase64: undefined } });
    await settle(10);
    const headers = (fetchImpl.mock.calls[0] as any)[1].headers as Headers;
    expect(headers.get('authorization')).toBeNull();
  });

  it('aborts the upstream request when the web side sends fetch.abort or disconnects', async () => {
    for (const how of ['abort', 'disconnect'] as const) {
      let upstreamSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
        upstreamSignal = init.signal ?? undefined;
        return new Promise<Response>(() => {});
      });
      const run = startRequest({ fetchImpl: fetchImpl as any });
      await settle();
      expect(upstreamSignal?.aborted).toBe(false);
      if (how === 'abort') run.web.postMessage({ type: 'fetch.abort' });
      else run.web.disconnect();
      await settle();
      expect(upstreamSignal?.aborted, how).toBe(true);
    }
  });

  it('reports upstream failure before head so the page can fall back', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('network'); });
    const run = startRequest({ fetchImpl: fetchImpl as any });
    await settle();
    expect(run.received.at(-1)).toMatchObject({ type: 'fetch.error', code: 'upstream_unreachable', beforeHead: true });
    expect(JSON.stringify(run.received)).not.toContain('sk-test');
  });
});
