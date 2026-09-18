import registry from '../../tools/flovart/contracts/host-registry.v1.json';
import { createWorkBuddySkillPackage } from '../agentSkillPackage';
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

/**
 * Hosts whose Flovart entry ships as an external Skill/Plugin package rather
 * than a local CLI install. The definition hides the delivery mechanism — the
 * UI only sees `prepareAgent(id)` and the returned public state.
 */
const EXTERNAL_PACKAGE_HOSTS: Record<string, { fileName: string; installed: string }> = {
  workbuddy: {
    fileName: 'flovart-workbuddy.zip',
    installed: '安装包已下载，在 WorkBuddy 的技能页导入后即可使用 Flovart。',
  },
  'deepseek-harness': {
    fileName: '',
    installed: 'DeepSeek Harness 插件尚未在当前环境就绪，请先完成插件安装。',
  },
};

const externalPackageAdapters = (id: string): Partial<FlovartHostLifecycleAdapter> => {
  const entry = EXTERNAL_PACKAGE_HOSTS[id];
  if (!entry) return {};
  return {
    prepare: async () => {
      if (!entry.fileName) return { ok: false, message: entry.installed };
      const blob = await createWorkBuddySkillPackage();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      return { ok: true, message: entry.installed };
    },
  };
};

export function createFlovartHostRegistry(adapters: Record<string, Partial<FlovartHostLifecycleAdapter>> = {}): FlovartHostDefinition[] {
  return registry.agentIdentities.map(identity => {
    const kind = kindOf(identity.category);
    return defineFlovartHost({
      id: identity.id,
      label: identity.label,
      kind,
      capabilities: capabilities(kind),
      ...defaultLifecycle(identity.id),
      ...externalPackageAdapters(identity.id),
      ...adapters[identity.id],
    });
  });
}

export const flovartHostRegistry = createFlovartHostRegistry();

export function getFlovartHostDefinition(id: string): FlovartHostDefinition | null {
  return flovartHostRegistry.find(host => host.id === id) || null;
}
