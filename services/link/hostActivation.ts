import {
  activateAgentHost,
  activateBrowserWorkflowWriter,
  prepareAgentHostProjection,
  type AgentHostDiscovery,
  type AgentHostActivation,
} from '../agentHostDiscovery';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import { getFlovartHostDefinition } from './hostRegistry';

export class LinkActivationError extends Error {
  readonly code: 'HOST_NOT_FOUND' | 'HOST_NEEDS_SETUP' | 'LINK_OFFLINE' | 'WORKSPACE_REQUIRED' | 'LEASE_TARGET_CHANGED';

  constructor(code: LinkActivationError['code'], message: string) {
    super(message);
    this.name = 'LinkActivationError';
    this.code = code;
  }
}

export interface HostActivationOptions {
  discover?: () => Promise<AgentHostDiscovery>;
  prepare?: typeof prepareAgentHostProjection;
  activateWriter?: typeof activateBrowserWorkflowWriter;
  activateHost?: typeof activateAgentHost;
}

export async function ensureHostReady(
  agentIdentity: string,
  options: HostActivationOptions = {},
): Promise<AgentHostActivation | { state: 'needs_setup'; hostId: string }> {
  const definition = getFlovartHostDefinition(agentIdentity);
  if (!definition) throw new LinkActivationError('HOST_NOT_FOUND', '这个协作助手暂不可用。');

  const current = useAgentConnectionStore.getState();
  if (!current.projectId) throw new LinkActivationError('WORKSPACE_REQUIRED', '请先打开一个 Flovart 项目。');
  if (current.status !== 'ready' || !current.clientId) {
    throw new LinkActivationError('LINK_OFFLINE', 'Flovart 本地服务暂时不可用。');
  }
  const targetProjectId = current.projectId;
  const assertTarget = () => {
    if (useAgentConnectionStore.getState().projectId !== targetProjectId) {
      throw new LinkActivationError('LEASE_TARGET_CHANGED', '当前项目已切换，请重新选择协作 Agent。');
    }
  };

  if (current.writerStatus === 'active' && current.activeHostIdentity === agentIdentity && current.activeHostProjectId === targetProjectId) {
    return { activeHostWriter: { agentIdentity, projectId: targetProjectId, hasSessionId: false }, switched: false };
  }

  const discovery = options.discover
    ? await options.discover()
    : { ok: true, state: 'ready' as const, agents: [await definition.detect()] };
  assertTarget();
  if (!discovery.ok || discovery.state !== 'ready') {
    const error = 'error' in discovery ? discovery.error : undefined;
    throw new LinkActivationError('LINK_OFFLINE', error || 'Flovart 本地服务暂时不可用。');
  }
  const detected = discovery.agents.find(host => host.id === agentIdentity);
  if (definition.kind !== 'coding-agent' || detected?.status === 'manual-import' || !detected?.available) {
    return { state: 'needs_setup', hostId: agentIdentity };
  }

  const activateWriter = options.activateWriter || activateBrowserWorkflowWriter;
  if (options.prepare) {
    await options.prepare(agentIdentity);
  } else {
    const prepared = await definition.prepare();
    if (!prepared.ok) {
      throw new LinkActivationError(
        prepared.error?.code === 'LINK_OFFLINE' ? 'LINK_OFFLINE' : 'HOST_NEEDS_SETUP',
        prepared.error?.message || `${definition.label} 尚未准备完成。`,
      );
    }
  }
  assertTarget();
  await activateWriter();
  assertTarget();
  if (options.activateHost) return options.activateHost(agentIdentity);
  const activation = await definition.activate();
  if (!activation.ok) {
    throw new LinkActivationError(
      activation.error?.code === 'LINK_OFFLINE' ? 'LINK_OFFLINE' : 'HOST_NEEDS_SETUP',
      activation.error?.message || `${definition.label} 暂时无法激活。`,
    );
  }
  return {
    activeHostWriter: { agentIdentity, projectId: activation.projectId || targetProjectId, hasSessionId: false },
    switched: true,
  };
}
