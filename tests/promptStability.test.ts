import { afterEach, describe, expect, it, vi } from 'vitest';
import { enhancePromptWithProvider, STABLE_TEXT_TEMPERATURE } from '../services/aiGateway';
import type { UserApiKey } from '../types';

// 润色路径只读取 provider 与 key，其余字段与本测试无关。
const key = { id: 'k1', name: 'test', provider: 'openai', key: 'sk-test' } as UserApiKey;

const chatResponse = (content: string) => new Response(
  JSON.stringify({ choices: [{ message: { content } }] }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
);
const validJson = JSON.stringify({ enhancedPrompt: 'a red fox, golden hour', negativePrompt: 'blur', suggestions: ['fox'], notes: '' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enhancePromptWithProvider 输出稳定性', () => {
  it('格式损坏时只重试一次，并使用低温度', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(chatResponse('not json'))
      .mockResolvedValueOnce(chatResponse(validJson));
    vi.stubGlobal('fetch', fetchMock);

    const result = await enhancePromptWithProvider({ prompt: 'fox', mode: 'smart' }, 'gpt-5.4-mini', key);

    expect(result.enhancedPrompt).toBe('a red fox, golden hour');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(STABLE_TEXT_TEMPERATURE);
  });

  it('两次格式失败后降级为原提示词，不再继续请求', async () => {
    const fetchMock = vi.fn(async () => chatResponse('not json'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await enhancePromptWithProvider({ prompt: 'fox', mode: 'smart' }, 'gpt-5.4-mini', key);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ enhancedPrompt: 'fox', notes: 'not json' });
  });

  it('HTTP 错误直接抛出，不重试', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream down', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(enhancePromptWithProvider({ prompt: 'fox', mode: 'smart' }, 'gpt-5.4-mini', key)).rejects.toThrow('500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
