import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTokenUsage,
  extractTokenUsage,
  listTokenUsage,
  recordTokenUsage,
  setTokenUsageStorage,
  summarizeTokenUsage,
  TOKEN_USAGE_MAX_RECORDS,
} from '../services/tokenUsage';

function memoryStorage() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}

describe('extractTokenUsage', () => {
  it('normalizes OpenAI chat usage with details', () => {
    expect(extractTokenUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 2 } } }))
      .toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 4, reasoningTokens: 2 });
  });
  it('normalizes Anthropic / Responses usage and derives total', () => {
    expect(extractTokenUsage({ usage: { input_tokens: 7, output_tokens: 3, cache_read_input_tokens: 1 } }))
      .toMatchObject({ inputTokens: 7, outputTokens: 3, totalTokens: 10, cachedInputTokens: 1 });
  });
  it('normalizes Gemini usageMetadata including thoughts', () => {
    expect(extractTokenUsage({ usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, thoughtsTokenCount: 4, totalTokenCount: 32 } }))
      .toMatchObject({ inputTokens: 20, outputTokens: 12, totalTokens: 32, reasoningTokens: 4 });
  });
  it('handles Ark total-only and missing usage', () => {
    expect(extractTokenUsage({ usage: { total_tokens: 99 } })).toMatchObject({ inputTokens: 0, outputTokens: 0, totalTokens: 99 });
    expect(extractTokenUsage({ choices: [] })).toBeNull();
    expect(extractTokenUsage(null)).toBeNull();
  });
});

describe('token usage ledger', () => {
  beforeEach(() => { setTokenUsageStorage(memoryStorage()); clearTokenUsage(); });

  it('records, persists and summarizes by provider/model', () => {
    recordTokenUsage({ provider: 'openai', model: 'gpt-x', source: 'text', raw: { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } });
    recordTokenUsage({ provider: 'openai', model: 'gpt-x', source: 'text', raw: { usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } } });
    recordTokenUsage({ provider: 'google', model: 'gemini', source: 'text', raw: { usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3 } } });
    expect(recordTokenUsage({ provider: 'openai', model: 'gpt-x', source: 'text', raw: {} })).toBeNull();
    const summary = summarizeTokenUsage(listTokenUsage());
    expect(summary[0]).toMatchObject({ provider: 'openai', model: 'gpt-x', calls: 2, totalTokens: 17 });
    expect(summary[1]).toMatchObject({ provider: 'google', calls: 1, totalTokens: 6 });
  });

  it('filters by since and caps record count', () => {
    recordTokenUsage({ provider: 'p', model: 'm', source: 's', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, at: new Date('2020-01-01') });
    expect(summarizeTokenUsage(listTokenUsage(), { since: new Date('2021-01-01') })).toEqual([]);
    for (let i = 0; i < TOKEN_USAGE_MAX_RECORDS + 5; i += 1) recordTokenUsage({ provider: 'p', model: 'm', source: 's', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 1 } });
    expect(listTokenUsage()).toHaveLength(TOKEN_USAGE_MAX_RECORDS);
  });
});
