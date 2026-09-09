import { getManagedAgentConnection, type ManagedAgentConnection } from './managedAgentConnection';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

export interface AgentHostRecord {
  id: string;
  label: string;
  category: string;
  status: 'available' | 'unavailable' | 'planned' | string;
  available: boolean;
  executable: string | null;
  path: string | null;
  version: string | null;
  authStatus: 'not-inspected' | string;
  distributionTargets: string[];
  runtimeSurfaces: string[];
  directorBinding: 'supported' | 'not-supported' | string;
  diagnostic: string;
}

export interface AgentHostDiscovery {
  ok: boolean;
  state: 'ready' | 'offline' | 'error';
  scannedAt?: string;
  agents: AgentHostRecord[];
  activeHostWriter?: AgentHostWriter | null;
  error?: string;
}

export interface AgentHostWriter {
  agentIdentity: string;
  projectId: string | null;
  hasSessionId: boolean;
}

export interface AgentHostActivation {
  activeHostWriter: AgentHostWriter;
  switched: boolean;
}

export interface AgentHostProjection {
  ok: true;
  agentIdentity: { id: string; label: string };
  distributionTarget: { id: string | null; label: string; kind: string };
  projection: { status: 'ready' | 'external'; skillReady: boolean; bootstrapReady: boolean; message: string };
}

export interface AgentHostDiscoveryOptions {
  discover?: () => Promise<ManagedAgentConnection | null>;
  fetchImpl?: typeof fetch;
}

export async function discoverAgentHosts(options: AgentHostDiscoveryOptions = {}): Promise<AgentHostDiscovery> {
  const connection = await (options.discover || getManagedAgentConnection)().catch(() => null);
  if (!connection) return { ok: false, state: 'offline', agents: [] };

  try {
    const response = await (options.fetchImpl || fetch)(`${connection.url}/hosts?refresh=true&includeVersion=false`, {
      headers: { 'x-flovart-agent-token': connection.token },
      signal: AbortSignal.timeout(8000),
    });
    const body = await response.json() as Partial<AgentHostDiscovery>;
    if (!response.ok || body.ok !== true || !Array.isArray(body.agents)) {
      return { ok: false, state: 'error', agents: [], error: 'Agent Host discovery 返回无效结果。' };
    }
    const activeHostWriter = body.activeHostWriter || null;
    return {
      ok: true,
      state: 'ready',
      scannedAt: body.scannedAt,
      agents: body.agents,
      activeHostWriter,
    };
  } catch (error) {
    return {
      ok: false,
      state: 'error',
      agents: [],
      error: error instanceof Error ? error.message : 'Agent Host discovery 失败。',
    };
  }
}

export async function activateAgentHost(agentIdentity: string, options: AgentHostDiscoveryOptions = {}): Promise<AgentHostActivation> {
  const connection = await (options.discover || getManagedAgentConnection)().catch(() => null);
  const { projectId } = useAgentConnectionStore.getState();
  if (!connection) throw new Error('本地 Agent 尚未启动。');
  const response = await (options.fetchImpl || fetch)(`${connection.url}/host/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flovart-agent-token': connection.token },
    body: JSON.stringify({ agentIdentity, ...(projectId ? { projectId } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message || body.error || 'Agent Host 暂时无法激活。');
  const activation = body as AgentHostActivation;
  useAgentConnectionStore.getState().setStatus(useAgentConnectionStore.getState().status, {
    activeHostIdentity: activation.activeHostWriter?.agentIdentity || null,
    activeHostProjectId: activation.activeHostWriter?.projectId || null,
  });
  return activation;
}

export async function prepareAgentHostProjection(agentIdentity: string, options: AgentHostDiscoveryOptions = {}): Promise<AgentHostProjection> {
  const connection = await (options.discover || getManagedAgentConnection)().catch(() => null);
  if (!connection) throw new Error('本地 Agent 尚未启动。');
  const response = await (options.fetchImpl || fetch)(`${connection.url}/hosts/prepare`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flovart-agent-token': connection.token },
    body: JSON.stringify({ agentIdentity }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message || body.error || 'Agent Projection 暂时无法准备。');
  return body as AgentHostProjection;
}

export async function activateBrowserWorkflowWriter(options: AgentHostDiscoveryOptions = {}) {
  const connection = await (options.discover || getManagedAgentConnection)().catch(() => null);
  const { clientId, projectId } = useAgentConnectionStore.getState();
  if (!connection || !clientId) throw new Error('当前浏览器 Workflow 尚未连接。');
  const response = await (options.fetchImpl || fetch)(`${connection.url}/workflow/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-flovart-agent-token': connection.token },
    body: JSON.stringify({ clientId, projectId }),
    signal: AbortSignal.timeout(8000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) throw new Error(body.error?.message || body.error || '当前浏览器 Workflow 不可用。');
  useAgentConnectionStore.getState().setStatus(useAgentConnectionStore.getState().status, {
    writerStatus: 'active',
    writerClientId: body.activeWriter?.clientId || clientId,
    writerProjectId: body.activeWriter?.projectId || projectId || null,
    error: null,
  });
  return body.activeWriter;
}
