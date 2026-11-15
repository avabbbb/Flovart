import { create } from 'zustand';
import type { AgentLinkIssue } from '../services/agentLinkIssue';

export type AgentConnectionStatus = 'connecting' | 'ready' | 'offline' | 'auth_failed' | 'error';
export type AgentWriterStatus = 'unknown' | 'active' | 'inactive' | 'revoked';

/** One connection transition, kept so the run log can show link history next to agent steps. */
export interface AgentLinkEvent {
  id: string;
  at: string;
  status: AgentConnectionStatus;
  issueKind: AgentLinkIssue['kind'] | null;
  url: string | null;
}

export const AGENT_LINK_EVENT_LIMIT = 50;

interface AgentConnectionState {
  status: AgentConnectionStatus;
  url: string | null;
  clientId: string | null;
  projectId: string | null;
  revision: number | null;
  writerStatus: AgentWriterStatus;
  writerClientId: string | null;
  writerProjectId: string | null;
  activeHostIdentity: string | null;
  activeHostProjectId: string | null;
  error: string | null;
  /** Classified reason the link is not ready; null while ready or not yet diagnosed. */
  issue: AgentLinkIssue | null;
  /** ISO time the status last changed. */
  statusSince: string | null;
  events: AgentLinkEvent[];
  /** Bumped by requestReconnect(); the workspace adapter restarts when it changes. */
  reconnectNonce: number;
  setStatus: (status: AgentConnectionStatus, patch?: Partial<Pick<AgentConnectionState, 'url' | 'clientId' | 'projectId' | 'revision' | 'writerStatus' | 'writerClientId' | 'writerProjectId' | 'activeHostIdentity' | 'activeHostProjectId' | 'error' | 'issue'>>) => void;
  requestReconnect: () => void;
  clearEvents: () => void;
  reset: () => void;
}

const initialState = {
  status: 'offline' as AgentConnectionStatus,
  url: null,
  clientId: null,
  projectId: null,
  revision: null,
  writerStatus: 'unknown' as AgentWriterStatus,
  writerClientId: null,
  writerProjectId: null,
  activeHostIdentity: null,
  activeHostProjectId: null,
  error: null,
  issue: null,
  statusSince: null,
  events: [] as AgentLinkEvent[],
  reconnectNonce: 0,
};

let eventSequence = 0;

export const useAgentConnectionStore = create<AgentConnectionState>(set => ({
  ...initialState,
  setStatus: (status, patch = {}) => set(state => {
    // A ready link has no issue; callers only need to pass `issue` when they classified one.
    const issue = status === 'ready' ? null : patch.issue !== undefined ? patch.issue : state.issue;
    const statusChanged = status !== state.status;
    const issueKind = issue?.kind || null;
    const next: Partial<AgentConnectionState> = { status, ...patch, issue };
    if (statusChanged || !state.statusSince) next.statusSince = new Date().toISOString();
    // Log distinct transitions only: the bridge's backoff loop flips
    // error → connecting → error with the same cause and must not flood the log.
    const last = state.events[state.events.length - 1];
    const reconnectFlap = Boolean(last && last.status === 'error' && (status === 'connecting' || status === 'error') && last.issueKind === issueKind);
    if (!reconnectFlap && (!last || last.status !== status || last.issueKind !== issueKind)) {
      const event: AgentLinkEvent = {
        id: `link-${Date.now().toString(36)}-${(eventSequence += 1)}`,
        at: new Date().toISOString(),
        status,
        issueKind,
        url: patch.url !== undefined ? patch.url : state.url,
      };
      next.events = [...state.events, event].slice(-AGENT_LINK_EVENT_LIMIT);
    }
    return next;
  }),
  requestReconnect: () => set(state => ({ reconnectNonce: state.reconnectNonce + 1 })),
  clearEvents: () => set({ events: [] }),
  reset: () => set({ ...initialState, events: [] }),
}));
