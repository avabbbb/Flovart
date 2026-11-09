import { invoke } from '@tauri-apps/api/core';
import { resolveAgentTextRoutes, type AgentTextRouteKey } from './agentTextRoutes';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export async function syncRuntimeAgentTextRoutes(
  keys: readonly AgentTextRouteKey[],
  runtimeInvoke: Invoke = invoke,
): Promise<number> {
  // 与浏览器内核同一解析：显式 agent-text 映射优先，否则回退到默认文本 Key 的默认模型。
  const routes = resolveAgentTextRoutes(keys).map((route, order) => ({
    provider: route.key.provider,
    credentialId: route.key.id,
    model: route.model,
    baseUrl: route.baseUrl,
    protocol: 'openai-chat-completions',
    order,
  }));

  await runtimeInvoke('runtime_execute', {
    envelope: {
      protocolVersion: '1',
      commandId: 'cmd_' + crypto.randomUUID(),
      command: 'agent-text.route.sync',
      args: { routes },
      actor: { kind: 'ui', instanceId: 'flovart-webui' },
    },
  });
  return routes.length;
}
