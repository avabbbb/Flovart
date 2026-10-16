import { afterEach, describe, expect, it, vi } from 'vitest';
import { rhCancelTask, rhCancelUrl } from '../services/runningHubService';

const web = (hostAndPath: string) => ['https', '://', hostAndPath].join('');

describe('RunningHub 取消任务', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('按 baseUrl 规范推导取消端点，保留代理路径前缀', () => {
    expect(new URL(rhCancelUrl()).pathname).toBe('/task/openapi/cancel');
    expect(rhCancelUrl(web('rh.test/openapi/v2/'))).toBe(web('rh.test/task/openapi/cancel'));
    expect(rhCancelUrl(web('proxy.test/rh/openapi/v2?x=1'))).toBe(web('proxy.test/rh/task/openapi/cancel'));
    expect(rhCancelUrl(web('proxy.test/rh/'))).toBe(web('proxy.test/rh/task/openapi/cancel'));
  });

  it('非 2xx 与业务码非 0 时显式报错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 502 })));
    await expect(rhCancelTask('key', 'task-1')).rejects.toThrow('HTTP 502');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 804, msg: 'not found' }), { status: 200 })));
    await expect(rhCancelTask('key', 'task-1')).rejects.toThrow('804');
  });

  it('成功时向规范端点发送取消请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(rhCancelTask('key', 'task-1', { baseUrl: web('proxy.test/rh/openapi/v2') })).resolves.toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toBe(web('proxy.test/rh/task/openapi/cancel'));
  });
});
