import { beforeEach, describe, expect, it } from 'vitest';
import { parseSseBlock, readSseEvents, readSseJson } from '../services/sse';
import { commitStreamUsage, createStreamUsageAccumulator, streamOutcome } from '../services/streamUsage';
import { clearTokenUsage, countUsageMissing, listTokenUsage, listUsageMissing, setTokenUsageStorage } from '../services/tokenUsage';

function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }));
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('sse reader (L2)', () => {
  it('parses event/data fields, tolerates missing space, joins multi-line data, ignores comments', () => {
    expect(parseSseBlock('event: x\ndata:{"a":1}')).toEqual({ event: 'x', data: '{"a":1}' });
    expect(parseSseBlock('data: a\ndata: b')).toEqual({ event: undefined, data: 'a\nb' });
    expect(parseSseBlock(': keep-alive')).toBeNull();
  });

  it('stitches a line split across reads and handles CRLF and a trailing block', async () => {
    const split = await collect(readSseEvents(streamOf(['data: {"a"', ':1}\n', '\ndata: [DONE]\n\n'])));
    expect(split.map(event => event.data)).toEqual(['{"a":1}', '[DONE]']);
    const crlf = await collect(readSseEvents(streamOf(['data: 1\r\n\r\ndata: 2\r\n\r\n'])));
    expect(crlf.map(event => event.data)).toEqual(['1', '2']);
    const trailing = await collect(readSseEvents(streamOf(['data: last'])));
    expect(trailing.map(event => event.data)).toEqual(['last']);
  });

  it('readSseJson skips [DONE] and malformed JSON', async () => {
    const items = await collect(readSseJson(streamOf(['data: {"n":1}\n\ndata: {broken\n\ndata: [DONE]\n\n'])));
    expect(items).toEqual([{ n: 1 }]);
  });
});

describe('stream usage accumulators (L1)', () => {
  it('gemini keeps the latest cumulative usageMetadata', () => {
    const acc = createStreamUsageAccumulator('gemini');
    acc.feed({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1 } });
    acc.feed({ candidates: [] });
    acc.feed({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } });
    expect(acc.result()).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  it('anthropic merges message_start input with the last message_delta output', () => {
    const acc = createStreamUsageAccumulator('anthropic');
    acc.feed({ type: 'message_start', message: { usage: { input_tokens: 20, cache_read_input_tokens: 4, output_tokens: 1 } } });
    acc.feed({ type: 'content_block_delta', delta: { text: 'hi' } });
    acc.feed({ type: 'message_delta', usage: { output_tokens: 7 } });
    acc.feed({ type: 'message_delta', usage: { output_tokens: 12 } });
    expect(acc.result()).toEqual({ inputTokens: 20, outputTokens: 12, totalTokens: 32, cachedInputTokens: 4 });

    const startOnly = createStreamUsageAccumulator('anthropic');
    startOnly.feed({ type: 'message_start', message: { usage: { input_tokens: 5, output_tokens: 1 } } });
    expect(startOnly.result()).toMatchObject({ inputTokens: 5, outputTokens: 1, totalTokens: 6 });
  });

  it('openai reads the final usage chunk and returns null when none is sent', () => {
    const acc = createStreamUsageAccumulator('openai');
    acc.feed({ choices: [{ delta: { content: 'a' } }], usage: null });
    acc.feed({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
    expect(acc.result()).toMatchObject({ inputTokens: 3, outputTokens: 4, totalTokens: 7 });

    const none = createStreamUsageAccumulator('openai');
    none.feed({ choices: [{ delta: { content: 'a' } }] });
    expect(none.result()).toBeNull();
  });
});

describe('commitStreamUsage (L3)', () => {
  beforeEach(() => {
    setTokenUsageStorage(undefined);
    clearTokenUsage();
  });

  it('records usage with outcome, or a missing-usage entry when the stream had none', () => {
    const meta = { provider: 'openai', model: 'gpt-5.4-mini', source: 'reverse-prompt-stream' };
    const withUsage = createStreamUsageAccumulator('openai');
    withUsage.feed({ usage: { prompt_tokens: 2, completion_tokens: 3 } });
    commitStreamUsage(meta, withUsage, 'aborted');
    expect(listTokenUsage()).toHaveLength(1);
    expect(listTokenUsage()[0]).toMatchObject({ source: 'reverse-prompt-stream', totalTokens: 5, outcome: 'aborted' });

    commitStreamUsage(meta, createStreamUsageAccumulator('openai'), 'ok');
    expect(listTokenUsage()).toHaveLength(1);
    expect(listUsageMissing()).toHaveLength(1);
    expect(countUsageMissing(listUsageMissing(), { source: 'reverse-prompt-stream' })).toBe(1);
    expect(countUsageMissing(listUsageMissing(), { source: 'browser-agent' })).toBe(0);

    clearTokenUsage();
    expect(listTokenUsage()).toHaveLength(0);
    expect(listUsageMissing()).toHaveLength(0);
  });

  it('classifies outcomes', () => {
    const controller = new AbortController();
    controller.abort();
    expect(streamOutcome(new Error('x'), controller.signal)).toBe('aborted');
    expect(streamOutcome(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('aborted');
    expect(streamOutcome(new Error('x'))).toBe('error');
  });
});
