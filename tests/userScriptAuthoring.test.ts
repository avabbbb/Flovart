import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildUserScriptAuthoringBrief,
  getStoredUserScriptProvider,
  loadStoredUserScriptProviders,
  parseUserScriptDefinition,
  saveUserScriptProvider,
} from '../services/userScriptAuthoring';
import { clearUserScriptProviders, getUserScriptProvider } from '../services/userScriptProviderAdapter';

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

describe('user script authoring', () => {
  beforeEach(() => {
    localStorage.clear();
    clearUserScriptProviders();
  });

  it('parses agent output wrapped in a code fence', () => {
    const fence = String.fromCharCode(96).repeat(3);
    expect(parseUserScriptDefinition(fence + 'json\n' + JSON.stringify(definition) + '\n' + fence).id).toBe('demo-video');
  });

  it('rejects a loopback endpoint and unknown capabilities', () => {
    expect(() => parseUserScriptDefinition(JSON.stringify({ ...definition, endpoint: endpoint.replace('api.example.com', 'localhost') }))).toThrow(/本机/);
    expect(() => parseUserScriptDefinition(JSON.stringify({ ...definition, capabilities: ['make-magic'] }))).toThrow(/capability/);
    expect(() => parseUserScriptDefinition('not json')).toThrow(/JSON/);
  });

  it('persists a definition and re-registers it on load', () => {
    saveUserScriptProvider(parseUserScriptDefinition(JSON.stringify(definition)));
    clearUserScriptProviders();
    expect(getUserScriptProvider('demo-video')).toBeUndefined();

    expect(loadStoredUserScriptProviders()).toBe(1);
    expect(getUserScriptProvider('demo-video')?.id).toBe('demo-video');
    expect(getStoredUserScriptProvider('demo-video')?.endpoint).toBe(endpoint);
  });

  it('builds a brief with the model, mapping rules, examples and the current draft', () => {
    const brief = buildUserScriptAuthoringBrief({ modelName: 'demo-model', draft: '{"id":"draft-1"}' });
    expect(brief).toContain('demo-model');
    expect(brief).toContain('$path');
    expect(brief).toContain('{{taskId}}');
    expect(brief).toContain('{"id":"draft-1"}');
    for (const example of brief.split('\n\n')) expect(example).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
