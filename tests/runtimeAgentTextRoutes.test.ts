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
});
