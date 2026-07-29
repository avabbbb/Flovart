import { invoke } from '@tauri-apps/api/core';
import type { UserApiKey } from '../types';
import { isOpenAICompatibleProvider, resolveProviderBaseUrl } from './baseUrl';

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type RuntimeAgentTextRouteKey = Pick<
  UserApiKey,
  'id' | 'provider' | 'baseUrl' | 'routeMappings' | 'isDefault' | 'capabilities' | 'status'
>;

export async function syncRuntimeAgentTextRoutes(
  keys: RuntimeAgentTextRouteKey[],
  runtimeInvoke: Invoke = invoke,
): Promise<number> {
  const routes = keys
    .filter(key => (
      isOpenAICompatibleProvider(key.provider)
      && key.id
      && key.status !== 'error'
      && (!key.capabilities || key.capabilities.includes('text'))
    ))
    .flatMap(key => (key.routeMappings || [])
      .filter(mapping => mapping.target.kind === 'runtime-capability' && mapping.target.capability === 'agent-text')
      .map(mapping => ({
        provider: key.provider,
        credentialId: key.id,
        model: mapping.routeId.trim(),
        baseUrl: resolveProviderBaseUrl(key.provider, key.baseUrl),
        protocol: 'openai-chat-completions',
        sourceOrder: mapping.order,
        preferred: Boolean(key.isDefault),
      })))
    .filter(route => route.model && route.baseUrl)
    .sort((left, right) => (
      left.sourceOrder - right.sourceOrder
      || Number(right.preferred) - Number(left.preferred)
      || left.credentialId.localeCompare(right.credentialId)
    ))
    .map(({ sourceOrder: _sourceOrder, preferred: _preferred, ...route }, order) => ({ ...route, order }));

  await runtimeInvoke('runtime_execute', {
    envelope: {
      protocolVersion: '1',
      commandId: `cmd_${crypto.randomUUID()}`,
      command: 'agent-text.route.sync',
      args: { routes },
      actor: { kind: 'ui', instanceId: 'flovart-webui' },
    },
  });
  return routes.length;
}
