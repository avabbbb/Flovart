import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { INITIAL_WORKFLOW_VIEWPORT } from './constants';
import { workflowStorage } from './storage';
import type { WorkflowProject } from './types';

export const WORKFLOW_STORE_KEY = 'flovart:workflow:projects';

export function createWorkflowProject(title = '未命名工作流'): WorkflowProject {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    title,
    nodes: [],
    connections: [],
    selectedNodeIds: [],
    viewport: { ...INITIAL_WORKFLOW_VIEWPORT },
    backgroundMode: 'dots',
    agentSessions: [],
    activeAgentSessionId: null,
    createdAt: now,
    updatedAt: now,
  };
}

interface WorkflowStore {
  hydrated: boolean;
  projects: WorkflowProject[];
  activeProjectId: string | null;
  setHydrated: (hydrated: boolean) => void;
  createProject: (title?: string) => string;
  setActiveProject: (id: string | null) => void;
  renameProject: (id: string, title: string) => void;
  deleteProjects: (ids: string[]) => void;
  updateProject: (id: string, patch: Partial<Omit<WorkflowProject, 'id' | 'createdAt'>>) => void;
}

type PersistedWorkflowState = Pick<WorkflowStore, 'projects' | 'activeProjectId'>;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export function normalizeWorkflowProject(project: WorkflowProject): WorkflowProject {
  const nodeIds = new Set(project.nodes.map(node => node.id));
  return { ...project, selectedNodeIds: project.selectedNodeIds.filter(id => nodeIds.has(id)) };
}

const persistStorage: PersistStorage<WorkflowStore> = {
  async getItem(name) {
    return workflowStorage.get<StorageValue<WorkflowStore>>(name);
  },
  setItem(name, value) {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      writeTimer = null;
      void workflowStorage.set(name, value);
    }, 400);
  },
  removeItem(name) {
    return workflowStorage.remove(name);
  },
};

export const useWorkflowStore = create<WorkflowStore>()(
  persist(
    (set, get) => ({
      hydrated: false,
      projects: [],
      activeProjectId: null,
      setHydrated: hydrated => set({ hydrated }),
      createProject: (title) => {
        const project = createWorkflowProject(title);
        set(state => ({ projects: [project, ...state.projects], activeProjectId: project.id }));
        return project.id;
      },
      setActiveProject: activeProjectId => set({ activeProjectId }),
      renameProject: (id, title) => set(state => ({
        projects: state.projects.map(project => project.id === id
          ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() }
          : project),
      })),
      deleteProjects: (ids) => set(state => {
        const removed = new Set(ids);
        const projects = state.projects.filter(project => !removed.has(project.id));
        const activeProjectId = state.activeProjectId && !removed.has(state.activeProjectId)
          ? state.activeProjectId
          : projects[0]?.id || null;
        return { projects, activeProjectId };
      }),
      updateProject: (id, patch) => set(state => ({
        projects: state.projects.map(project => project.id === id
          ? { ...project, ...patch, updatedAt: new Date().toISOString() }
          : project),
      })),
    }),
    {
      name: WORKFLOW_STORE_KEY,
      storage: persistStorage,
      partialize: state => ({ projects: state.projects, activeProjectId: state.activeProjectId }) as WorkflowStore,
      merge: (persisted, current) => {
        const state = persisted as Partial<PersistedWorkflowState> | undefined;
        return {
          ...current,
          projects: Array.isArray(state?.projects) ? state.projects.map(normalizeWorkflowProject) : current.projects,
          activeProjectId: typeof state?.activeProjectId === 'string' || state?.activeProjectId === null
            ? state.activeProjectId
            : current.activeProjectId,
        };
      },
      onRehydrateStorage: () => state => state?.setHydrated(true),
    },
  ),
);

export function getActiveWorkflowProject(): WorkflowProject | null {
  const state = useWorkflowStore.getState();
  return state.projects.find(project => project.id === state.activeProjectId) || null;
}
