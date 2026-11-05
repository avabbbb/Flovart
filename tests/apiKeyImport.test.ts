import { describe, expect, it } from 'vitest';

import { parseApiKeyText, providerFromEnvName } from '../utils/apiKeyImport';

describe('parseApiKeyText', () => {
  it('reads .env lines with comments, export and quotes, ignoring non-key variables', () => {
    const text = [
      '\uFEFF# Flovart keys',
      'export OPENAI_API_KEY="sk-openai-1"',
      "ARK_API_KEY='ark-2' # volcengine",
      'OPENAI_BASE_URL=https://example.com/v1',
      '',
      'RUNNINGHUB_API_KEY=rh-3',
    ].join('\r\n');
    expect(parseApiKeyText(text)).toEqual([
      { name: 'OPENAI_API_KEY', key: 'sk-openai-1', provider: 'openai' },
      { name: 'ARK_API_KEY', key: 'ark-2', provider: 'volcengine' },
      { name: 'RUNNINGHUB_API_KEY', key: 'rh-3', provider: 'runningHub' },
    ]);
  });

  it('accepts bare one-line keys and infers the provider from the key', () => {
    const infer = (key: string) => (key.startsWith('AIzaSy') ? 'google' : null);
    expect(parseApiKeyText('AIzaSyABC\nunknown-key\n', infer)).toEqual([
      { name: null, key: 'AIzaSyABC', provider: 'google' },
      { name: null, key: 'unknown-key', provider: null },
    ]);
  });

  it('drops duplicates, empty values and prose lines', () => {
    expect(parseApiKeyText('OPENAI_API_KEY=\nsk-a\nsk-a\nthis is not a key')).toEqual([
      { name: null, key: 'sk-a', provider: null },
    ]);
  });

  it('maps common variable names to providers', () => {
    expect(providerFromEnvName('GEMINI_API_KEY')).toBe('google');
    expect(providerFromEnvName('VOLCENGINE_API_KEY')).toBe('volcengine');
    expect(providerFromEnvName('SOMETHING_ELSE')).toBeNull();
  });
});
