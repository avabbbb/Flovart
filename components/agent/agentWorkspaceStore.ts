import localforage from 'localforage';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type AgentPanelKind = 'brief' | 'flovart' | 'codex' | 'activity' | 'artifacts';
export type AgentPanelStatus = 'idle' | 'running' | 'waiting' | 'done' | 'error';

export interface AgentWorkspacePanel {
  id: string;
  kind: AgentPanelKind;
  title: string;
  status: AgentPanelStatus;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

export interface AgentWorkspaceLayout {
  viewport: { x: number; y: number; zoom: number };
  panels: AgentWorkspacePanel[];
}

interface AgentWorkspaceState {
  layouts: Record<string, AgentWorkspaceLayout>;
  ensureLayout: (projectId: string) => void;
  updatePanel: (projectId: string, panelId: string, patch: Partial<AgentWorkspacePanel>) => void;
  setViewport: (projectId: string, viewport: AgentWorkspaceLayout['viewport']) => void;
  addCodexPanel: (projectId: string) => void;
  removePanel: (projectId: string, panelId: string) => void;
  resetLayout: (projectId: string) => void;
}

const agentWorkspaceDb = localforage.createInstance({ name: 'flovart', storeName: 'agent_workspaces' });
const agentWorkspaceStorage: StateStorage = {
  getItem: name => agentWorkspaceDb.getItem<string>(name),
  setItem: async (name, value) => { await agentWorkspaceDb.setItem(name, value); },
  removeItem: async name => { await agentWorkspaceDb.removeItem(name); },
};

export const createDefaultAgentLayout = (): AgentWorkspaceLayout => ({
  viewport: { x: 42, y: 38, zoom: 1 },
  panels: [
    { id: 'brief', kind: 'brief', title: '项目 Brief', status: 'idle', x: 0, y: 0, width: 310, height: 220, z: 1 },
    { id: 'flovart-main', kind: 'flovart', title: 'Flovart Agent', status: 'idle', x: 336, y: 0, width: 520, height: 620, z: 4 },
    { id: 'activity', kind: 'activity', title: '任务状态', status: 'idle', x: 0, y: 246, width: 310, height: 374, z: 2 },
    { id: 'artifacts', kind: 'artifacts', title: '制作产物', status: 'idle', x: 882, y: 0, width: 360, height: 620, z: 3 },
  ],
});

const withFlovartMain = (layout: AgentWorkspaceLayout): AgentWorkspaceLayout => {
  if (layout.panels.some(panel => panel.kind === 'flovart')) return layout;
  const legacyMain = layout.panels.find(panel => panel.id === 'codex-main');
  const flovart: AgentWorkspacePanel = legacyMain
    ? { ...legacyMain, id: 'flovart-main', kind: 'flovart', title: 'Flovart Agent', status: 'idle' }
    : createDefaultAgentLayout().panels.find(panel => panel.kind === 'flovart')!;
  return {
    ...layout,
    panels: legacyMain
      ? layout.panels.map(panel => panel.id === legacyMain.id ? flovart : panel)
      : [...layout.panels, flovart],
  };
};

export const useAgentWorkspaceStore = create<AgentWorkspaceState>()(
  persist(
    set => ({
      layouts: {},
      ensureLayout: projectId => set(state => {
        const current = state.layouts[projectId];
        if (!current) return { layouts: { ...state.layouts, [projectId]: createDefaultAgentLayout() } };
        const layout = withFlovartMain(current);
        return layout === current ? state : { layouts: { ...state.layouts, [projectId]: layout } };
      }),
      updatePanel: (projectId, panelId, patch) => set(state => {
        const layout = state.layouts[projectId] || createDefaultAgentLayout();
        return { layouts: { ...state.layouts, [projectId]: { ...layout, panels: layout.panels.map(panel => panel.id === panelId ? { ...panel, ...patch } : panel) } } };
      }),
      setViewport: (projectId, viewport) => set(state => {
        const layout = state.layouts[projectId] || createDefaultAgentLayout();
        return { layouts: { ...state.layouts, [projectId]: { ...layout, viewport } } };
      }),
      addCodexPanel: projectId => set(state => {
        const layout = state.layouts[projectId] || createDefaultAgentLayout();
        const count = layout.panels.filter(panel => panel.kind === 'codex').length + 1;
        const z = Math.max(0, ...layout.panels.map(panel => panel.z)) + 1;
        const panel: AgentWorkspacePanel = { id: `codex-${nanoid(6)}`, kind: 'codex', title: `Codex · 子任务 ${count}`, status: 'idle', x: 120 + count * 34, y: 80 + count * 34, width: 500, height: 560, z };
        return { layouts: { ...state.layouts, [projectId]: { ...layout, panels: [...layout.panels, panel] } } };
      }),
      removePanel: (projectId, panelId) => set(state => {
        const layout = state.layouts[projectId];
        if (!layout) return state;
        return { layouts: { ...state.layouts, [projectId]: { ...layout, panels: layout.panels.filter(panel => panel.id !== panelId) } } };
      }),
      resetLayout: projectId => set(state => ({ layouts: { ...state.layouts, [projectId]: createDefaultAgentLayout() } })),
    }),
    {
      name: 'flovart:agent-workspaces',
      storage: createJSONStorage(() => agentWorkspaceStorage),
      partialize: state => ({ layouts: state.layouts }),
    },
  ),
);
