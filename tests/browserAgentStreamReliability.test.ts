import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { AGENT_ABORTED_MESSAGE, buildBrowserAgentRequestBody, createBrowserAgentStream } from '../services/browserAgentKernel';
import { extractTokenUsage } from '../services/tokenUsage';

const userMessage = { role: 'user', content: [{ type: 'text', text: 'hi' }], timestamp: 0 } as unknown as AgentMessage;
const route = { provider: 'openai_compatible', model: 'm', baseUrl: 'https://gw.example/v1', apiKey: 'k' };

function sse(chunks: unknown[]): Response {
  const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** 发出响应头后永不出字（模拟「正在思考…」卡住）。 */
function hangingResponse(signal?: AbortSignal | null): Response {
  const body = new ReadableStream({
    start(controller) {
      const fail = () => controller.error(signal?.reason ?? new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail);
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const reply = (text: string) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 64 } }]);

async function run(timeouts: Record<string, number> = {}, signal?: AbortSignal, systemPrompt = 'SYSTEM') {
  const stream = await createBrowserAgentStream({ ...route, timeouts: { retryBaseMs: 1, ...timeouts } })(
    {} as never,
    { systemPrompt, messages: [userMessage], tools: [] } as never,
    { signal } as never,
  );
  const events: Array<{ type: string }> = [];
  for await (const event of stream) events.push(event as { type: string });
  return { events, message: await stream.result() };
}

afterEach(() => vi.unstubAllGlobals());

describe('browser agent request structure', () => {
  it('sends the system prompt as the first message so every request shares a stable prefix', () => {
    const body = buildBrowserAgentRequestBody(route, { systemPrompt: '你是 Iris Agent', messages: [userMessage] });
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]).toEqual({ role: 'system', content: '你是 Iris Agent' });
    expect(messages[1].role).toBe('user');
    // 同一会话追加一轮：之前的请求必须是新请求的前缀（前缀缓存才能命中）。
    const longer = buildBrowserAgentRequestBody(route, { systemPrompt: '你是 Iris Agent', messages: [userMessage, { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', timestamp: 1 } as never, userMessage] });
    const prefix = JSON.stringify(messages);
    expect(JSON.stringify(longer.messages).startsWith(prefix.slice(0, -1))).toBe(true);
  });
});

describe('browser agent stream reliability', () => {
  it('emits start before the first delta so the panel streams text instead of waiting for the whole reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('第一句。第二句。')));
    const { events, message } = await run();
    expect(events.map(event => event.type)).toEqual(['start', 'text_delta', 'done']);
    expect(message.usage.cacheRead).toBe(64);
    expect(message.usage.input).toBe(36);
  });

  it('retries a 503 before any token and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"busy"}', { status: 503 }))
      .mockResolvedValueOnce(reply('好的'));
    vi.stubGlobal('fetch', fetchMock);
    const { message } = await run();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(message.stopReason).toBe('stop');
  });

  it('retries a network failure with a fresh AbortController per attempt', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      if (signals.length === 1) throw new TypeError('fetch failed');
      return reply('ok');
    }));
    const { message } = await run();
    expect(message.stopReason).toBe('stop');
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it('turns a stalled stream into a retry instead of thinking forever', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => (++calls === 1 ? hangingResponse(init.signal) : reply('恢复了'))));
    const { message } = await run({ firstChunkMs: 30, idleMs: 30 });
    expect(calls).toBe(2);
    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([{ type: 'text', text: '恢复了' }]);
  });

  it('reports a clear timeout (not an abort) when every attempt stalls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => hangingResponse(init.signal)));
    const { message } = await run({ firstChunkMs: 20, idleMs: 20, retries: 1 });
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toMatch(/没有开始输出/);
    expect(message.errorMessage).not.toMatch(/aborted/i);
  });

  it('does not retry after text was already streamed', async () => {
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半句"}}]}\n\n'));
        setTimeout(() => controller.error(new TypeError('network reset')), 5);
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { message } = await run();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(message.stopReason).toBe('error');
  });

  it('marks a user stop as aborted with a clean 已中止 message', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      setTimeout(() => controller.abort(), 5);
      return hangingResponse(init.signal);
    }));
    const { message } = await run({}, controller.signal);
    expect(message.stopReason).toBe('aborted');
    expect(message.errorMessage).toBe(AGENT_ABORTED_MESSAGE);
  });
});

describe('cache usage', () => {
  it('reads DeepSeek prompt_cache_hit_tokens and ignores a zero sibling field', () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_cache_hit_tokens: 896, prompt_cache_miss_tokens: 104 } })?.cachedInputTokens).toBe(896);
    expect(extractTokenUsage({ usage: { prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 0 }, prompt_cache_hit_tokens: 640 } })?.cachedInputTokens).toBe(640);
    expect(extractTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 8 } } })?.cachedInputTokens).toBe(8);
  });

});
