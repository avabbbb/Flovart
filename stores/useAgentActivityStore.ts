import { create } from 'zustand';

export type AgentActivityStatus = 'running' | 'ok' | 'error';

export interface AgentActivityEntry {
  id: string;
  at: string;
  command: string;
  source: string;
  agentIdentity: string | null;
  projectId: string | null;
  summary: string | null;
  status: AgentActivityStatus;
  durationMs: number | null;
  error: { code: string | null; message: string } | null;
}

export interface AgentConnectedWindow {
  clientId: string;
  projectId: string | null;
  projectTitle: string | null;
  active: boolean;
  snapshotUpdatedAt: string | null;
}

export const AGENT_ACTIVITY_LIMIT = 200;

interface AgentActivityState {
  entries: AgentActivityEntry[];
  windows: AgentConnectedWindow[];
  lastSyncedAt: string | null;
  /** Entries at or before this time were cleared from the log view and are not re-added by history sync. */
  clearedAt: string | null;
  upsert: (entry: AgentActivityEntry) => void;
  replace: (entries: AgentActivityEntry[], windows: AgentConnectedWindow[]) => void;
  clear: () => void;
  /** Clear the run log only; connected windows stay. */
  clearEntries: () => void;
}

export const useAgentActivityStore = create<AgentActivityState>(set => ({
  entries: [],
  windows: [],
  lastSyncedAt: null,
  clearedAt: null,
  upsert: entry => set(state => {
    const index = state.entries.findIndex(item => item.id === entry.id);
    const entries = index >= 0
      ? state.entries.map((item, i) => (i === index ? entry : item))
      : [...state.entries, entry];
    return { entries: entries.slice(-AGENT_ACTIVITY_LIMIT) };
  }),
  replace: (entries, windows) => set(state => {
    const merged = new Map<string, AgentActivityEntry>();
    const cleared = state.clearedAt;
    entries.forEach(entry => { if (!cleared || entry.at > cleared) merged.set(entry.id, entry); });
    // Live events that arrived during the fetch are newer; keep them.
    state.entries.forEach(entry => {
      const existing = merged.get(entry.id);
      if (!existing || existing.status === 'running') merged.set(entry.id, entry);
    });
    const sorted = [...merged.values()].sort((a, b) => a.at.localeCompare(b.at));
    return { entries: sorted.slice(-AGENT_ACTIVITY_LIMIT), windows, lastSyncedAt: new Date().toISOString() };
  }),
  clear: () => set({ entries: [], windows: [], lastSyncedAt: null, clearedAt: null }),
  clearEntries: () => set({ entries: [], clearedAt: new Date().toISOString() }),
}));
