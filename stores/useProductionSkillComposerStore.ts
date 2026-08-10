import { create } from 'zustand';

export interface PendingProductionSkill {
  projectId: string;
  skillId: string;
  skillVersion: string;
  skillName: string;
  prompt: string;
}

interface ProductionSkillComposerState {
  pendingByProject: Record<string, PendingProductionSkill>;
  queue: (pending: PendingProductionSkill) => void;
  consume: (projectId: string) => PendingProductionSkill | undefined;
}

export const useProductionSkillComposerStore = create<ProductionSkillComposerState>((set, get) => ({
  pendingByProject: {},
  queue: pending => set(state => ({
    pendingByProject: { ...state.pendingByProject, [pending.projectId]: pending },
  })),
  consume: projectId => {
    const pending = get().pendingByProject[projectId];
    if (!pending) return undefined;
    set(state => {
      const next = { ...state.pendingByProject };
      delete next[projectId];
      return { pendingByProject: next };
    });
    return pending;
  },
}));

export const queuePendingProductionSkill = (pending: PendingProductionSkill) => (
  useProductionSkillComposerStore.getState().queue(pending)
);

export const readPendingProductionSkill = (projectId: string) => (
  useProductionSkillComposerStore.getState().pendingByProject[projectId]
);

export const consumePendingProductionSkill = (projectId: string) => (
  useProductionSkillComposerStore.getState().consume(projectId)
);
