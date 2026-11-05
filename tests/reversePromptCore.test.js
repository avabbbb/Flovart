// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildReversePromptBody,
  buildReversePromptInstruction,
  parseReversePromptResponse,
  reversePromptEndpoint,
} from '../extension/background/reverse-prompt-core.js';

const image = 'data:image/png;base64,QUJD';
const input = { model: 'm', instruction: 'describe', imageDataUrl: image, mimeType: 'image/png', temperature: 0.1 };

describe('reverse prompt core', () => {
  it('follows the UI language and folds in the aspect ratio', () => {
    const zh = buildReversePromptInstruction('zho', { width: 300, height: 200 });
    expect(zh).toContain('负面提示');
    expect(zh).toContain('1.50');
    expect(buildReversePromptInstruction('en')).not.toContain('aspect ratio ~');
  });

  it('builds the three wire formats', () => {
    expect(buildReversePromptBody('google', input)).toEqual({
      contents: [{ parts: [{ text: 'describe' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } }] }],
      generationConfig: { temperature: 0.1 },
    });
    const anthropic = buildReversePromptBody('anthropic', input);
    expect(anthropic.messages[0].content[1].source).toEqual({ type: 'base64', media_type: 'image/png', data: 'QUJD' });
    const openai = buildReversePromptBody('openai', input);
    expect(openai.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: image } });
    expect(openai.max_tokens).toBe(1024);
  });

  it('builds endpoints per format', () => {
    expect(reversePromptEndpoint('google', 'base', 'gemini 2')).toBe('base/models/gemini%202:generateContent');
    expect(reversePromptEndpoint('anthropic', 'base')).toBe('base/messages');
    expect(reversePromptEndpoint('openai', 'base')).toBe('base/chat/completions');
  });

  it('parses each response shape defensively', () => {
    expect(parseReversePromptResponse('google', { candidates: [{ content: { parts: [{ text: ' a ' }] } }] })).toBe('a');
    expect(parseReversePromptResponse('anthropic', { content: [{ text: 'a' }, { type: 'tool_use' }, { text: 'b' }] })).toBe('a\n\nb');
    expect(parseReversePromptResponse('openai', { choices: [{ message: { content: ' c ' } }] })).toBe('c');
    expect(parseReversePromptResponse('openai', null)).toBe('');
    expect(parseReversePromptResponse('google', { candidates: [] })).toBe('');
  });
});
