import { create } from 'zustand';

export type AgentReceiptKind = 'task' | 'artifact' | 'decision' | 'note';

export interface AgentReceipt {
  id: string;
  at: string;
  projectId: string;
  kind: AgentReceiptKind;
  title: string;
  summary: string | null;
  agentIdentity: string | null;
  externalRef: string | null;
  nodeIds: string[];
}

export const AGENT_RECEIPT_LIMIT = 200;

interface AgentReceiptState {
  byProject: Record<string, AgentReceipt[]>;
  upsert: (receipt: AgentReceipt) => void;
  replace: (projectId: string, receipts: AgentReceipt[]) => void;
}

const byTime = (a: AgentReceipt, b: AgentReceipt) => a.at.localeCompare(b.at);

// Project-level shared context, mirrored from the local Agent service. Read-only in the
// browser: receipts are written through the service, never by editing this store.
export const useAgentReceiptStore = create<AgentReceiptState>(set => ({
  byProject: {},
  upsert: receipt => set(state => {
    const current = state.byProject[receipt.projectId] || [];
    if (current.some(item => item.id === receipt.id)) return state;
    const next = [...current, receipt].sort(byTime).slice(-AGENT_RECEIPT_LIMIT);
    return { byProject: { ...state.byProject, [receipt.projectId]: next } };
  }),
  replace: (projectId, receipts) => set(state => {
    const merged = new Map<string, AgentReceipt>();
    receipts.forEach(item => merged.set(item.id, item));
    (state.byProject[projectId] || []).forEach(item => { if (!merged.has(item.id)) merged.set(item.id, item); });
    const next = [...merged.values()].sort(byTime).slice(-AGENT_RECEIPT_LIMIT);
    return { byProject: { ...state.byProject, [projectId]: next } };
  }),
}));
