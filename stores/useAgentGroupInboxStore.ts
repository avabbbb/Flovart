import { create } from 'zustand';

/** A canvas group handed to the side Agent panel (toolbar action '添加到 Agent'). */
export interface AgentGroupPayload {
  nodeIds: string[];
  label: string;
  batchId?: string;
}

interface AgentGroupInboxState {
  pendingGroup: AgentGroupPayload | null;
  push: (payload: AgentGroupPayload) => void;
  consume: () => AgentGroupPayload | null;
}

export const useAgentGroupInboxStore = create<AgentGroupInboxState>((set, get) => ({
  pendingGroup: null,
  push: payload => set({ pendingGroup: { ...payload, nodeIds: [...new Set(payload.nodeIds)] } }),
  consume: () => {
    const pending = get().pendingGroup;
    if (!pending) return null;
    set({ pendingGroup: null });
    return pending;
  },
}));

export const pushAgentGroup = (payload: AgentGroupPayload) => useAgentGroupInboxStore.getState().push(payload);

export const consumeAgentGroup = () => useAgentGroupInboxStore.getState().consume();
