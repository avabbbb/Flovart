import { describe, expect, it, vi } from 'vitest';
import { syncRuntimeAgentTextRoutes } from '../services/runtimeAgentTextRoutes';

describe('Runtime agent-text routes', () => {
  it('syncs ordered non-secret route metadata through the Runtime command contract', async () => {
    const invoke = vi.fn().mockResolvedValue({ target: 'runtime-capability:agent-text' });
    const keys = [{
      id: 'openai-main',
      provider: 'openai' as const,
      capabilities: ['text' as const],
      key: 'browser-secret',
      baseUrl: 'https://api.openai.com',
      customModels: ['gpt-test'],
      routeMappings: [{
        target: { kind: 'runtime-capability' as const, capability: 'agent-text' as const },
        routeId: 'gpt-test',
        order: 3,
      }],
      createdAt: 1,
      updatedAt: 1,
    }];

    await expect(syncRuntimeAgentTextRoutes(keys, invoke)).resolves.toBe(1);
    const envelope = invoke.mock.calls[0][1]?.envelope;
    expect(invoke).toHaveBeenCalledWith('runtime_execute', expect.any(Object));
    expect(envelope.command).toBe('agent-text.route.sync');
    expect(envelope.actor.kind).toBe('ui');
    expect(envelope.args.routes).toEqual([{
      provider: 'openai',
      credentialId: 'openai-main',
      model: 'gpt-test',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'openai-chat-completions',
      order: 0,
    }]);
    expect(JSON.stringify(envelope)).not.toContain('browser-secret');
    expect(JSON.stringify(envelope)).not.toContain('"key"');
  });

  it('falls back to the default text key model when no agent-text mapping exists', async () => {
    const invoke = vi.fn().mockResolvedValue({});
    const base = { provider: 'openai_compatible', capabilities: ['text'], key: 's', createdAt: 1, updatedAt: 1 };
    const keys = [
      { ...base, id: 'a', baseUrl: 'https://a.example.com/v1', models: [{ id: 'img', name: 'img', capability: 'image' }, { id: 'chat-a', name: 'chat-a', capability: 'text' }] },
      { ...base, id: 'b', baseUrl: 'https://b.example.com/v1', isDefault: true, defaultModel: 'chat-b', customModels: ['chat-b'] },
      { ...base, id: 'c', baseUrl: 'https://c.example.com/v1' },
    ];

    await expect(syncRuntimeAgentTextRoutes(keys as never, invoke)).resolves.toBe(2);
    const routes = invoke.mock.calls[0][1]?.envelope.args.routes as Array<{ credentialId: string; model: string; order: number }>;
    expect(routes.map(({ credentialId, model, order }) => ({ credentialId, model, order }))).toEqual([
      { credentialId: 'b', model: 'chat-b', order: 0 },
      { credentialId: 'a', model: 'chat-a', order: 1 },
    ]);
  });

  it('uses only explicit agent-text mappings when any exist', async () => {
    const invoke = vi.fn().mockResolvedValue({});
    const base = { provider: 'openai_compatible', capabilities: ['text'], key: 's', createdAt: 1, updatedAt: 1 };
    const keys = [
      { ...base, id: 'a', baseUrl: 'https://a.example.com/v1', customModels: ['chat-a'], routeMappings: [{ target: { kind: 'runtime-capability', capability: 'agent-text' }, routeId: 'picked', order: 0 }] },
      { ...base, id: 'b', baseUrl: 'https://b.example.com/v1', isDefault: true, defaultModel: 'chat-b' },
    ];

    await expect(syncRuntimeAgentTextRoutes(keys as never, invoke)).resolves.toBe(1);
    expect(invoke.mock.calls[0][1]?.envelope.args.routes[0]).toMatchObject({ credentialId: 'a', model: 'picked' });
  });
});
