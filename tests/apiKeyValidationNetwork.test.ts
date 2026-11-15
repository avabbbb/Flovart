import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateApiKey } from '../services/aiGateway';
import { isNetworkFailure } from '../services/modelFetcher';
import { translations } from '../utils/translations';

/**
 * 回归：验证 Key 时断网 / 被 CORS 拦截，被报成「Key 无效」。
 * 根因：fetch 抛出的 TypeError（Failed to fetch）与 401 走了同一条失败路径；
 * RunningHub 的 rhTestApiKey 更是把任何异常都返回 false（= 无效）。
 */
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const corsFailure = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

describe('API key validation when the service cannot be reached', () => {
  it('classifies fetch-level failures as network, not as an invalid key', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isNetworkFailure(new TypeError('Load failed'))).toBe(true);
    expect(isNetworkFailure(new DOMException('timeout', 'TimeoutError'))).toBe(true);
    expect(isNetworkFailure(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isNetworkFailure(new Error('401 Unauthorized'))).toBe(false);
  });

  it.each([
    ['openai', 'https://api.openai.com/v1'],
    ['google', undefined],
    ['runningHub', undefined],
    ['anthropic', undefined],
    ['keling', undefined],
  ] as const)('%s: CORS/network failure reports cannot-connect and keeps the key un-judged', async (provider, baseUrl) => {
    globalThis.fetch = corsFailure() as never;
    const result = await validateApiKey(provider, 'test-key-1234567890abcdef', baseUrl);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network');
    expect(result.message).toMatch(/无法连接/);
    expect(result.message).toMatch(/未能判定 API Key 是否有效/);
    expect(result.message).not.toMatch(/无效或权限不足|API Key 无效$/);
  });

  it('still reports a real 401 as an invalid key (no network reason)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })) as never;
    const result = await validateApiKey('openai', 'sk-bad', 'https://api.openai.com/v1');
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('still reports RunningHub auth errors as invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errorCode: '802', errorMessage: 'apiKey invalid' }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as never;
    const result = await validateApiKey('runningHub', '0123456789abcdef0123456789abcdef');
    expect(result.ok).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(result.message).toContain('RunningHub API Key 无效');
  });

  it('has zh and en cannot-connect copy that says the key was not judged invalid', () => {
    const zh = (translations as Record<string, any>).zho.settingsExtra.keyDialog.cannotConnect as string;
    const en = (translations as Record<string, any>).en.settingsExtra.keyDialog.cannotConnect as string;
    expect(zh).toMatch(/无法连接/);
    expect(zh).toMatch(/不代表 API Key 无效/);
    expect(en).toMatch(/Cannot connect/);
    expect(en).toMatch(/not judged invalid/);
  });
});
