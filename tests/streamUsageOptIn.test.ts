import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchStreamWithUsageOptIn, isIncludeUsageRejection, resetStreamUsageOptIn, withIncludeUsage } from '../services/streamUsageOptIn';

const URL_A = 'https://gw.example/v1/chat/completions';
const sentBodies = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.map(call => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);

describe('stream usage opt-in', () => {
  beforeEach(() => resetStreamUsageOptIn());

  it('leaves passive requests untouched', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    await fetchStreamWithUsageOptIn(URL_A, { method: 'POST' }, { stream: true }, undefined, fetchImpl);
    await fetchStreamWithUsageOptIn(URL_A, { method: 'POST' }, { stream: true }, 'passive', fetchImpl);
    expect(sentBodies(fetchImpl)).toEqual([{ stream: true }, { stream: true }]);
    expect(withIncludeUsage({ a: 1 }, 'passive')).toEqual({ a: 1 });
  });

  it('adds include_usage when opted in', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const res = await fetchStreamWithUsageOptIn(URL_A, { method: 'POST' }, { stream: true }, 'request', fetchImpl);
    expect(res.status).toBe(200);
    expect(sentBodies(fetchImpl)).toEqual([{ stream: true, stream_options: { include_usage: true } }]);
  });

  it('retries once without the field on a matching 400 and remembers the fallback', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":"Unknown parameter: stream_options"}', { status: 400 }))
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const res = await fetchStreamWithUsageOptIn(URL_A, { method: 'POST' }, { stream: true }, 'request', fetchImpl);
    expect(res.status).toBe(200);
    await fetchStreamWithUsageOptIn(URL_A, { method: 'POST' }, { stream: true }, 'request', fetchImpl);
    expect(sentBodies(fetchImpl)).toEqual([
      { stream: true, stream_options: { include_usage: true } },
      { stream: true },
      { stream: true },
    ]);
  });

  it('does not retry unrelated 400s or other errors', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"image too large"}', { status: 400 }));
    const res = await fetchStreamWithUsageOptIn(URL_A, { method: 'POST' }, { stream: true }, 'request', fetchImpl);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('image too large');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(isIncludeUsageRejection(401, 'stream_options')).toBe(false);
    expect(isIncludeUsageRejection(400, 'extra fields not permitted')).toBe(true);
  });
});
