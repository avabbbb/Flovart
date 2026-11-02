import type { ManagedAgentConnection } from './managedAgentConnection';
import {
  useAgentActivityStore,
  type AgentActivityEntry,
  type AgentActivityStatus,
  type AgentConnectedWindow,
} from '../stores/useAgentActivityStore';

const STATUSES: AgentActivityStatus[] = ['running', 'ok', 'error'];

const str = (value: unknown) => (typeof value === 'string' && value ? value : null);

export function toActivityEntry(payload: unknown): AgentActivityEntry | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const id = str(raw.id);
  const at = str(raw.at);
  const command = str(raw.command);
  if (!id || !at || !command) return null;
  const status = STATUSES.includes(raw.status as AgentActivityStatus) ? raw.status as AgentActivityStatus : 'running';
  const error = raw.error && typeof raw.error === 'object'
    ? { code: str((raw.error as Record<string, unknown>).code), message: String((raw.error as Record<string, unknown>).message || '') }
    : null;
  return {
    id,
    at,
    command,
    source: str(raw.source) || 'agent',
    agentIdentity: str(raw.agentIdentity),
    projectId: str(raw.projectId),
    summary: str(raw.summary),
    status,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
    error,
  };
}

function toWindow(payload: unknown): AgentConnectedWindow | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  const clientId = str(raw.clientId);
  if (!clientId) return null;
  return {
    clientId,
    projectId: str(raw.projectId),
    projectTitle: str(raw.projectTitle),
    active: raw.active === true,
    snapshotUpdatedAt: str(raw.snapshotUpdatedAt),
  };
}

/** Read-only history fetch; live updates arrive through the canvas event stream. */
export async function hydrateAgentActivity(connection: Pick<ManagedAgentConnection, 'url' | 'token'>, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(new URL('/activity?limit=200', connection.url).toString(), {
    headers: { 'x-flovart-agent-token': connection.token },
  });
  if (!response.ok) throw new Error('Agent activity unavailable: ' + response.status);
  const body = await response.json() as { activity?: unknown[]; clients?: unknown[] };
  const entries = (body.activity || []).map(toActivityEntry).filter((item): item is AgentActivityEntry => Boolean(item));
  const windows = (body.clients || []).map(toWindow).filter((item): item is AgentConnectedWindow => Boolean(item));
  useAgentActivityStore.getState().replace(entries, windows);
  return { entries, windows };
}
