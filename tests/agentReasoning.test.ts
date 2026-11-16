import { describe, expect, it } from 'vitest';
import { reasoningEchoFor, requiresEmptyReasoningContent } from '../services/agentReasoning';

describe('agentReasoning echo rules', () => {
  it('echoes reasoning_content only for DeepSeek and Kimi', () => {
    expect(reasoningEchoFor({ provider: 'deepseek' })).toBe('reasoning_content');
    expect(reasoningEchoFor({ provider: 'custom', baseUrl: 'https://api.moonshot.cn/v1' })).toBe('reasoning_content');
    expect(reasoningEchoFor({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' })).toBe('none');
    expect(requiresEmptyReasoningContent({ provider: 'custom', baseUrl: 'https://api.deepseek.com' })).toBe(true);
    expect(requiresEmptyReasoningContent({ provider: 'moonshot' })).toBe(false);
  });
});
