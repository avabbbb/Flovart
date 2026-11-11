import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_BUNDLE_KIND, buildConfigBundle, parseConfigBundle } from '../services/configMigration';
import { parseUserScriptDefinition, saveUserScriptProvider } from '../services/userScriptAuthoring';
import { clearUserScriptProviders } from '../services/userScriptProviderAdapter';
import type { UserApiKey } from '../types';

const endpoint = ['https:', '', 'api.example.com', 'v1'].join('/');
const definition = {
  id: 'demo-video',
  endpoint,
  capabilities: ['text-to-video'],
  supportedReferenceKinds: [],
  supportedReferenceRoles: [],
  maxReferences: { image: 0, video: 0, audio: 0 },
  auth: { header: 'Authorization', prefix: 'Bearer ' },
  request: { method: 'POST', path: 'tasks', body: { prompt: { $path: 'input.prompt' } } },
  response: { kind: 'video', taskIdPath: 'id' },
  poll: { request: { method: 'GET', path: 'tasks/{{taskId}}' }, response: { kind: 'video', statusPath: 'status', mediaUrlPath: 'video_url' } },
};

const apiKey = {
  id: 'k1', provider: 'openai', capabilities: ['text'], key: 'sk-test', name: '测试',
  baseUrl: 'https://api.openai.com/v1', routeMappings: [], pricingRules: [], createdAt: 1, updatedAt: 1,
} as UserApiKey;

beforeEach(() => {
  localStorage.clear();
  clearUserScriptProviders();
  saveUserScriptProvider(parseUserScriptDefinition(JSON.stringify(definition)));
});

describe('config migration bundle', () => {
  it('carries API keys and provider scripts with an explicit schema', () => {
    const bundle = buildConfigBundle([apiKey], true);
    expect(bundle.kind).toBe(CONFIG_BUNDLE_KIND);
    expect(bundle.providerScripts.map(script => script.id)).toEqual(['demo-video']);

    const parsed = parseConfigBundle(JSON.stringify(bundle));
    expect(parsed).toMatchObject({ legacy: false, invalidScripts: 0, noSecrets: false });
    expect(parsed.apiKeys).toHaveLength(1);
    expect(parsed.providerScripts[0]?.id).toBe('demo-video');
  });

  it('marks a no-secret export so import can point at the right export action', () => {
    const parsed = parseConfigBundle(JSON.stringify(buildConfigBundle([apiKey], false)));
    expect(parsed.noSecrets).toBe(true);
    expect(parsed.apiKeys).toHaveLength(1);
  });

  it('still accepts the legacy top-level key array', () => {
    const parsed = parseConfigBundle(JSON.stringify([{ provider: 'openai', key: 'sk-legacy' }]));
    expect(parsed).toMatchObject({ legacy: true, invalidScripts: 0, noSecrets: false });
    expect(parsed.apiKeys).toHaveLength(1);
    expect(parsed.providerScripts).toEqual([]);
  });

  it('skips one broken script without rejecting the whole migration file', () => {
    const bundle = buildConfigBundle([apiKey], true) as unknown as Record<string, unknown>;
    bundle.providerScripts = [definition, { id: 'broken' }];
    const parsed = parseConfigBundle(JSON.stringify(bundle));
    expect(parsed.providerScripts.map(script => script.id)).toEqual(['demo-video']);
    expect(parsed.invalidScripts).toBe(1);
  });
});
