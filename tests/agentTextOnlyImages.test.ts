import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAgentStream, isImageInputRejection, isRouteTextOnly, markRouteTextOnly, TEXT_ONLY_IMAGE_NOTE } from '../services/browserAgentKernel';

// 2026-11-16 内置 Agent 实测 P1-2：拖入的图片作为图片内容发给纯文本模型（glyph-cluster），整轮 400。
const PNG = 'iVBORw0KGgo=';
const messages = [{
  role: 'user',
  content: [{ type: 'text', text: '用这张图做风格参考' }, { type: 'image', data: PNG, mimeType: 'image/png' }],
  timestamp: 1,
}];

function sse(text: string) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('text-only agent models never receive image content', () => {
  const route = { provider: 'openai', model: 'stealth/glyph-cluster:free', baseUrl: 'https://cmd.example.com/v1', apiKey: 'k' };
  afterEach(() => {
    vi.unstubAllGlobals();
    markRouteTextOnly(route, false);
  });

  it('recognizes the provider error', () => {
    expect(isImageInputRejection(400, '{"error":{"message":"This model does not support image or file input"}}')).toBe(true);
    expect(isImageInputRejection(400, 'max_tokens too large')).toBe(false);
    expect(isImageInputRejection(500, 'image not supported')).toBe(false);
  });

  it('retries once without images after an image rejection and remembers the route', async () => {
    const bodies: Array<{ messages: Array<{ content: unknown }> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1
        ? new Response('{"error":{"message":"This model does not support image or file input"}}', { status: 400 })
        : sse('好的');
    }));
    const stream = createBrowserAgentStream(route);
    const events = await stream({} as never, { messages, tools: [] } as never, {} as never);
    for await (const _ of events as AsyncIterable<unknown>) { /* drain */ }
    const final = await (events as unknown as { result(): Promise<{ content: Array<{ type: string; text?: string }>; stopReason?: string }> }).result();
    expect(final.content).toContainEqual({ type: 'text', text: '好的' });
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[0])).toContain('image_url');
    expect(JSON.stringify(bodies[1])).not.toContain('image_url');
    expect(JSON.stringify(bodies[1])).toContain(TEXT_ONLY_IMAGE_NOTE.slice(0, 12));
    expect(isRouteTextOnly(route)).toBe(true);

    // 记住之后：下一轮直接不带图片，一次请求成功。
    bodies.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => { bodies.push(JSON.parse(String(init?.body))); return sse('ok'); }));
    const again = await createBrowserAgentStream(route)({} as never, { messages, tools: [] } as never, {} as never);
    for await (const _ of again as AsyncIterable<unknown>) { /* drain */ }
    expect(bodies).toHaveLength(1);
    expect(JSON.stringify(bodies[0])).not.toContain('image_url');
  });
});
