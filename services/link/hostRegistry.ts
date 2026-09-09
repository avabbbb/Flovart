import registry from '../../tools/flovart/contracts/host-registry.v1.json';
import {
  activateAgentHost,
  discoverAgentHosts,
  prepareAgentHostProjection,
} from '../agentHostDiscovery';
import { defineFlovartHost, type FlovartHostDefinition, type FlovartHostKind, type FlovartHostLifecycleAdapter } from './hostDefinition';

const kindOf = (category: string): FlovartHostKind => {
  if (category === 'harness') return 'native-plugin';
  if (category === 'mainstream-host') return 'assistant';
  return 'coding-agent';
};

const capabilities = (kind: FlovartHostKind) => ({
  inspect: true,
  mutate: true,
  run: true,
  selection: true,
  ...(kind === 'native-plugin' ? { plugin: true } : {}),
});

function defaultLifecycle(id: string): Partial<FlovartHostLifecycleAdapter> {
  return {
    detect: async () => {
      const result = await discoverAgentHosts();
      const detected = result.agents.find(host => host.id === id);
      return detected
        ? {
            id,
            available: detected.available,
            status: detected.status as 'available' | 'unavailable' | 'manual-import' | 'external-plugin' | 'unknown',
            version: detected.version,
            authStatus: (detected.authStatus || 'unknown') as 'ready' | 'needs-login' | 'not-inspected' | 'unknown',
          }
        : { id, available: false, status: 'unknown' };
    },
    ...(registry.agentIdentities.find(identity => identity.id === id)?.category === 'coding-agent' ? {
      prepare: async () => {
        try {
          const result = await prepareAgentHostProjection(id);
          return result.ok ? { ok: true } : { ok: false, error: { code: 'HOST_NEEDS_SETUP', message: '协作助手尚未准备完成。' } };
        } catch (error) {
          return { ok: false, error: { code: 'HOST_NEEDS_SETUP', message: error instanceof Error ? error.message : '协作助手尚未准备完成。' } };
        }
      },
      activate: async () => {
        try {
          const result = await activateAgentHost(id);
          return { ok: true, projectId: result.activeHostWriter?.projectId || null };
        } catch (error) {
          return { ok: false, error: { code: 'LINK_OFFLINE', message: error instanceof Error ? error.message : '协作助手暂时无法激活。' } };
        }
      },
    } : {}),
  };
}

export function createFlovartHostRegistry(adapters: Record<string, Partial<FlovartHostLifecycleAdapter>> = {}): FlovartHostDefinition[] {
  return registry.agentIdentities.map(identity => defineFlovartHost({
    id: identity.id,
    label: identity.label,
    kind: kindOf(identity.category),
    capabilities: capabilities(kindOf(identity.category)),
    ...defaultLifecycle(identity.id),
    ...adapters[identity.id],
  }));
}

export const flovartHostRegistry = createFlovartHostRegistry();

export function getFlovartHostDefinition(id: string): FlovartHostDefinition | null {
  return flovartHostRegistry.find(host => host.id === id) || null;
}
