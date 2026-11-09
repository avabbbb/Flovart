import { afterEach, describe, expect, it, vi } from 'vitest';
import { rhRunTask, rhTaskPhase } from '../services/runningHubService';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const taskBody = (status: string) => ({ taskId: 'task-1', status, errorCode: '', errorMessage: '', results: null });
const isCancel = (input: unknown) => String(input).includes('/task/openapi/cancel');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rhTaskPhase', () => {
  it('把状态字符串映射为显式阶段，未知状态视为进行中', () => {
    expect(rhTaskPhase('SUCCESS')).toBe('succeeded');
    expect(rhTaskPhase('FAILED')).toBe('failed');
    expect(rhTaskPhase('CANCELLED')).toBe('cancelled');
    expect(rhTaskPhase('canceled')).toBe('cancelled');
    expect(rhTaskPhase('QUEUED')).toBe('pending');
    expect(rhTaskPhase('RUNNING')).toBe('pending');
    expect(rhTaskPhase('SOMETHING_NEW')).toBe('pending');
    expect(rhTaskPhase(undefined)).toBe('pending');
  });
});

describe('rhRunTask', () => {
  it('轮询耗尽后取消上游任务，并保留原超时错误', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => isCancel(input) ? json({ code: 0 }) : json(taskBody('RUNNING')));
    vi.stubGlobal('fetch', fetchMock);

    const assertion = expect(rhRunTask('key', 'endpoint', {} as never, { resumeTaskId: 'task-1' }))
      .rejects.toThrow('RunningHub task timed out after polling');
    await vi.advanceTimersByTimeAsync(5000 * 120 + 1000);
    await assertion;

    const cancelCalls = fetchMock.mock.calls.filter(([input]) => isCancel(input));
    expect(cancelCalls).toHaveLength(1);
    expect(JSON.parse(String(cancelCalls[0][1]?.body))).toMatchObject({ taskId: 'task-1' });
  });

  it('超时后取消失败只告警，不掩盖超时错误', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => isCancel(input) ? json('bad', 502) : json(taskBody('QUEUED'))));

    const assertion = expect(rhRunTask('key', 'endpoint', {} as never, { resumeTaskId: 'task-1' }))
      .rejects.toThrow('RunningHub task timed out after polling');
    await vi.advanceTimersByTimeAsync(5000 * 120 + 1000);
    await assertion;
    expect(warn).toHaveBeenCalledWith('[RunningHub] cancel request failed', expect.objectContaining({ taskId: 'task-1' }));
  });

  it('上游返回取消状态时立即结束轮询，不再发起取消', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => isCancel(input) ? json({ code: 0 }) : json(taskBody('CANCELLED')));
    vi.stubGlobal('fetch', fetchMock);

    const assertion = expect(rhRunTask('key', 'endpoint', {} as never, { resumeTaskId: 'task-1' }))
      .rejects.toThrow('RunningHub task cancelled: Unknown error');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([input]) => isCancel(input))).toBe(false);
  });
});
