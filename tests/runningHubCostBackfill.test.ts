import { afterEach, describe, expect, it, vi } from 'vitest';
import { runningHubTaskCost } from '../services/runningHubService';
import { generateImageWithProvider, reportRunningHubTaskCost, type ProviderTaskLifecycleEvent } from '../services/aiGateway';

/**
 * 回归：RunningHub 运行的计费状态一直停在 unknown。
 * 根因：RunningHub 任务结果里带 usage.consumeMoney（实际扣费，元），但成功路径从未发出 usage 生命周期事件，
 * Workflow 的用量记录因此永远拿不到 actualCost。
 */
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runningHubTaskCost', () => {
  it('reads consumeMoney, falls back to thirdPartyConsumeMoney, ignores coins and garbage', () => {
    expect(runningHubTaskCost({ usage: { consumeMoney: '0.11', consumeCoins: '11', taskCostTime: '9', thirdPartyConsumeMoney: null } })).toEqual({ amount: 0.11, currency: 'CNY' });
    expect(runningHubTaskCost({ usage: { consumeMoney: null, consumeCoins: null, taskCostTime: '9', thirdPartyConsumeMoney: '2.5' } })).toEqual({ amount: 2.5, currency: 'CNY' });
    expect(runningHubTaskCost({ usage: { consumeMoney: 0.012 as never, consumeCoins: null, taskCostTime: '1', thirdPartyConsumeMoney: null } })).toEqual({ amount: 0.012, currency: 'CNY' });
    expect(runningHubTaskCost({ usage: { consumeMoney: null, consumeCoins: '30', taskCostTime: '9', thirdPartyConsumeMoney: null } })).toBeUndefined();
    expect(runningHubTaskCost({ usage: { consumeMoney: 'n/a', consumeCoins: null, taskCostTime: '9', thirdPartyConsumeMoney: '' } })).toBeUndefined();
    expect(runningHubTaskCost({})).toBeUndefined();
    expect(runningHubTaskCost(null)).toBeUndefined();
  });
});

describe('reportRunningHubTaskCost', () => {
  it('emits a usage lifecycle event with the actual cost', async () => {
    const events: ProviderTaskLifecycleEvent[] = [];
    await reportRunningHubTaskCost({ taskId: 'rh-1', usage: { consumeMoney: '0.11' } }, event => { events.push(event); });
    expect(events).toEqual([{ phase: 'usage', providerTaskId: 'rh-1', status: 'succeeded', amount: 0.11, currency: 'CNY' }]);
  });

  it('stays silent (billing remains unknown) when RunningHub returns no money field', async () => {
    const onLifecycle = vi.fn();
    await reportRunningHubTaskCost({ taskId: 'rh-1', usage: { consumeCoins: '11' } }, onLifecycle);
    await reportRunningHubTaskCost({ taskId: 'rh-1' }, onLifecycle);
    expect(onLifecycle).not.toHaveBeenCalled();
  });

  it('backfills cost from a completed RunningHub image task end to end', async () => {
    vi.useFakeTimers();
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/query')) {
        return new Response(JSON.stringify({
          taskId: 'rh-task-9', status: 'SUCCESS', errorCode: '', errorMessage: '',
          results: [{ url: 'https://rh-images.example.com/out.png', outputType: 'png', nodeId: '1', text: null }],
          usage: { consumeMoney: '0.11', consumeCoins: null, taskCostTime: '12', thirdPartyConsumeMoney: null },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(png, { status: 200, headers: { 'Content-Type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const events: ProviderTaskLifecycleEvent[] = [];
    const pending = generateImageWithProvider('a cat', 'seedream-v5-flash/text-to-image', {
      id: 'k1', provider: 'runningHub', key: 'rh-secret', name: 'RH', status: 'ok',
    } as never, [], { resumeProviderTaskId: 'rh-task-9', onProviderTaskLifecycle: event => { events.push(event); } });
    await vi.advanceTimersByTimeAsync(6000);
    const result = await pending;
    expect(result.newImageBase64).toBeTruthy();
    expect(events.find(event => event.phase === 'usage')).toEqual({ phase: 'usage', providerTaskId: 'rh-task-9', status: 'succeeded', amount: 0.11, currency: 'CNY' });
  });
});
