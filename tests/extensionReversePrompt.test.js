// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  bytesToDataUrl,
  resolveReverseRoute,
  reverseHeaders,
  reversePromptFromMedia,
} from '../extension/background/reverse-prompt.js';

const media = { bytes: new Uint8Array([65, 66, 67]), mimeType: 'image/png', width: 300, height: 200 };
const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

describe('extension reverse prompt', () => {
  it('prefers known providers in a fixed order and falls back to custom OpenAI-compatible keys', () => {
    const route = resolveReverseRoute([
      { id: 'a', provider: 'anthropic', key: 'sk-a' },
      { id: 'g', provider: 'google', key: 'g-key', defaultModel: 'gemini-x' },
    ]);
    expect(route.key.id).toBe('g');
    expect(route.format).toBe('google');
    expect(route.model).toBe('gemini-x');

    const custom = resolveReverseRoute([{ id: 'c', provider: 'custom', key: 'k', baseUrl: 'proxy/v1/', defaultModel: 'vl' }]);
    expect(custom).toMatchObject({ format: 'openai', baseUrl: 'proxy/v1', model: 'vl' });

    expect(resolveReverseRoute([{ provider: 'custom', key: 'k' }, { provider: 'openai', key: '' }])).toBeNull();
  });

  it('adds the browser-access header for Anthropic', () => {
    const headers = reverseHeaders({ format: 'anthropic', key: { key: 'sk-a' } });
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(reverseHeaders({ format: 'openai', key: { key: 'k' } }).Authorization).toBe('Bearer k');
  });

  it('encodes bytes as a data URL', () => {
    expect(bytesToDataUrl(media.bytes, 'image/png')).toBe('data:image/png;base64,QUJD');
  });

  it('sends one request and returns the parsed prompt', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: ' a cat ' } }] }));
    const result = await reversePromptFromMedia(media, [{ provider: 'openai', key: 'k' }], { fetchImpl });
    expect(result).toEqual({ prompt: 'a cat', provider: 'openai', model: 'gpt-5.4-mini' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.endsWith('/chat/completions')).toBe(true);
    expect(JSON.parse(init.body).messages[0].content[0].text).toContain('1.50');
  });

  it('fails clearly without a key, on HTTP errors and on empty output', async () => {
    await expect(reversePromptFromMedia(media, [])).rejects.toThrow('没有可用于反推的 API Key');
    const keys = [{ provider: 'openai', key: 'k' }];
    await expect(reversePromptFromMedia(media, keys, { fetchImpl: async () => jsonResponse({}, 401) })).rejects.toThrow('HTTP 401');
    await expect(reversePromptFromMedia(media, keys, { fetchImpl: async () => jsonResponse({ choices: [] }) })).rejects.toThrow('没有返回');
    const huge = { ...media, bytes: new Uint8Array(20971521) };
    await expect(reversePromptFromMedia(huge, keys)).rejects.toThrow('20 MB');
  });
});
