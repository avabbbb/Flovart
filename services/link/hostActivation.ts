import {
  activateAgentHost,
  activateBrowserWorkflowWriter,
  prepareAgentHostProjection,
  type AgentHostDiscovery,
  type AgentHostActivation,
} from '../agentHostDiscovery';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import { getFlovartHostDefinition } from './hostRegistry';
import { toLinkPublicStatus } from './publicStatus';
import { displayError } from '../displayError';

/**
 * Public result of preparing one agent host. The UI renders `state`/`action`
 * verbatim and never sees how the host delivers its Flovart entry.
 */
export type AgentPreparationResult =
  | { state: 'ready'; label: string; message: string; notice: string }
  | { state: 'needs_setup' | 'needs_login' | 'offline' | 'error'; label: string; message: string };

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


/**
 * Unified per-host entry point: resolves the host definition from the link
 * registry, runs detect → setup gate → prepare → activate through it, and
 * returns only the public state the picker should render.
 */
export async function prepareAgent(hostId: string): Promise<AgentPreparationResult> {
  const definition = getFlovartHostDefinition(hostId);
  if (!definition) {
    return { state: 'error', label: '出错', message: '这个协作助手暂不可用。' };
  }

  const current = useAgentConnectionStore.getState();
  const detected = await definition.detect().catch(() => null);
  const writerActive = current.writerStatus === 'active' && current.activeHostIdentity === hostId && current.activeHostProjectId === current.projectId;
  const status = toLinkPublicStatus({
    service: current.status === 'ready' ? 'ready' : current.status === 'connecting' ? 'connecting' : current.status === 'error' ? 'error' : 'offline',
    browserConnected: current.status === 'ready' && Boolean(current.clientId),
    writerActive: writerActive || current.status === 'ready',
    host: detected || { available: false, status: 'unknown' },
  });
  if (status.state !== 'ready') {
    if (status.state !== 'needs_setup') {
      return { state: status.state, label: status.label, message: status.message };
    }
    // The host needs its Flovart entry set up. The definition owns how that
    // happens — a local CLI projection, or an external Skill/Plugin hand-off —
    // so dispatch to it rather than branching on the host id here.
    try {
      const prepared = await definition.prepare();
      if (prepared.message) {
        return { state: 'needs_setup', label: status.label, message: prepared.message };
      }
      if (!prepared.ok) {
        return { state: 'needs_setup', label: status.label, message: prepared.error?.message || status.message };
      }
      return { state: 'needs_setup', label: status.label, message: status.message };
    } catch (error) {
      return { state: 'error', label: '出错', message: displayError(error, '暂时无法使用这个助手。') };
    }
  }
  // Host is detected as usable: hand off to the writer-lease coordinator,
  // which prepares and activates through the same definition.
  try {
    const result = await ensureHostReady(hostId);
    if ('state' in result) {
      return { state: 'needs_setup', label: '需安装', message: '这个助手尚未安装。' };
    }
    return { state: 'ready', label: '已准备', message: `${definition.label} 已选择并准备连接。`, notice: `${definition.label} 已选择并准备连接。` };
  } catch (error) {
    if (error instanceof LinkActivationError && error.code === 'LINK_OFFLINE') {
      return { state: 'offline', label: '离线', message: error.message };
    }
    if (error instanceof LinkActivationError && error.code === 'HOST_NEEDS_SETUP') {
      return { state: 'needs_setup', label: '需安装', message: error.message };
    }
    return { state: 'error', label: '出错', message: displayError(error, '暂时无法使用这个助手。') };
  }
}
