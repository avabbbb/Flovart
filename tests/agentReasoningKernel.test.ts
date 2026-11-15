import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAgentStream, toOpenAIMessages } from '../services/browserAgentKernel';

type Messages = Parameters<typeof toOpenAIMessages>[0];

const history = [
  { role: 'user', content: '看画布', timestamp: 1 },
  { role: 'assistant', content: [{ type: 'text', text: '旧回答' }], timestamp: 2 },
  { role: 'user', content: '继续', timestamp: 3 },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '先 inspect', thinkingSignature: 'reasoning_content' },
      { type: 'toolCall', id: 'c1', name: 'flovart_workflow_inspect', arguments: {} },
    ],
    timestamp: 4,
  },
  { role: 'toolResult', toolCallId: 'c1', toolName: 'flovart_workflow_inspect', isError: false, timestamp: 5, content: [{ type: 'text', text: '{}' }] },
] as unknown as Messages;

describe('reasoning echo in toOpenAIMessages', () => {
  it('does not echo reasoning by default', () => {
    const out = toOpenAIMessages(history);
    expect(out.filter(item => 'reasoning_content' in item)).toHaveLength(0);
  });

  it('echoes reasoning_content for DeepSeek, with empty strings for assistant turns without thinking', () => {
    const out = toOpenAIMessages(history, { reasoningEcho: 'reasoning_content', emptyReasoningContent: true });
    const assistants = out.filter(item => item.role === 'assistant');
    expect(assistants.map(item => item.reasoning_content)).toEqual(['', '先 inspect']);
    expect(assistants[1].tool_calls).toHaveLength(1);
  });

  it('echoes only real thinking for Kimi', () => {
    const out = toOpenAIMessages(history, { reasoningEcho: 'reasoning_content' });
    expect(out.filter(item => item.role === 'assistant').map(item => item.reasoning_content)).toEqual([undefined, '先 inspect']);
  });
});

function sse(chunks: Array<Record<string, unknown>>) {
  const body = chunks.map(delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); controller.close(); } }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('createBrowserAgentStream reasoning', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function run(chunks: Array<Record<string, unknown>>, provider = 'deepseek') {
    const fetchMock = vi.fn(async () => sse(chunks));
    vi.stubGlobal('fetch', fetchMock);
    const stream = createBrowserAgentStream({ provider, model: 'm', baseUrl: 'https://api.example.com', apiKey: 'k' });
    const events = await stream({} as never, { messages: history, tools: [] } as never, {} as never);
    const types: string[] = [];
    const deltas: Record<string, string> = { thinking: '', text: '' };
    for await (const event of events as AsyncIterable<{ type: string; delta?: string }>) {
      types.push(event.type);
      if (event.type === 'thinking_delta') deltas.thinking += event.delta;
      if (event.type === 'text_delta') deltas.text += event.delta;
    }
    const final = await (events as unknown as { result(): Promise<{ content: Array<Record<string, unknown>> }> }).result();
    return { types, deltas, final, request: JSON.parse(String((fetchMock.mock.calls[0] as unknown[])[1] && ((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body)) };
  }

  it('echoes prior reasoning_content to DeepSeek on top of the streamed thinking block', async () => {
    const { types, deltas, final, request } = await run([{ reasoning_content: '先' }, { reasoning_content: '想' }, { content: '好的' }]);
    expect(types.filter(type => type.startsWith('thinking'))).toEqual(['thinking_start', 'thinking_delta', 'thinking_delta', 'thinking_end']);
    expect(types.indexOf('thinking_end')).toBeLessThan(types.indexOf('text_delta'));
    expect(deltas).toEqual({ thinking: '先想', text: '好的' });
    expect(final.content[0]).toMatchObject({ type: 'thinking', thinking: '先想' });
    expect(final.content[1]).toEqual({ type: 'text', text: '好的' });
    expect(request.messages.filter((item: { role: string }) => item.role === 'assistant').map((item: { reasoning_content?: string }) => item.reasoning_content)).toEqual(['', '先 inspect']);
  });


});

describe('reasoning echo for other providers', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('does not add reasoning_content for OpenAI-compatible routes', async () => {
    const fetchMock = vi.fn(async () => sse([{ content: 'ok' }]));
    vi.stubGlobal('fetch', fetchMock);
    const stream = createBrowserAgentStream({ provider: 'openai', model: 'm', baseUrl: 'https://api.openai.com/v1', apiKey: 'k' });
    const events = await stream({} as never, { messages: history, tools: [] } as never, {} as never);
    for await (const _ of events as AsyncIterable<unknown>) { /* drain */ }
    const request = JSON.parse(String(((fetchMock.mock.calls[0] as unknown[])[1] as RequestInit).body));
    expect(request.messages.some((item: Record<string, unknown>) => 'reasoning_content' in item)).toBe(false);
  });
});
