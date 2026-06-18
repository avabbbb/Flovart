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

export type PersistedWorkflowState = Pick<WorkflowStore, 'projects' | 'activeProjectId'>;
export interface WorkflowPersistenceError {
  operation: 'read' | 'write' | 'remove';
  error: unknown;
}

type WorkflowPersistenceErrorListener = (error: WorkflowPersistenceError | null) => void;
type PendingPersistWrite = {
  name: string;
  value: StorageValue<PersistedWorkflowState>;
  waiters: Array<() => void>;
};
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: PendingPersistWrite | null = null;
let persistenceError: WorkflowPersistenceError | null = null;
const persistenceErrorListeners = new Set<WorkflowPersistenceErrorListener>();

export const getWorkflowPersistenceError = () => persistenceError;

export function subscribeWorkflowPersistenceError(listener: WorkflowPersistenceErrorListener): () => void {
  persistenceErrorListeners.add(listener);
  return () => persistenceErrorListeners.delete(listener);
}

function setWorkflowPersistenceError(error: WorkflowPersistenceError | null) {
  if (persistenceError === error) return;
  persistenceError = error;
  persistenceErrorListeners.forEach(listener => {
    try {
      listener(error);
    } catch (listenerError) {
      console.error('[Workflow] Persistence error listener failed.', listenerError);
    }
  });
}

function cancelPendingWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  const write = pendingWrite;
  pendingWrite = null;
  write?.waiters.forEach(resolve => resolve());
}

export function normalizeWorkflowProject(project: WorkflowProject): WorkflowProject {
  const nodeIds = new Set(project.nodes.map(node => node.id));
  return { ...project, selectedNodeIds: project.selectedNodeIds.filter(id => nodeIds.has(id)) };
}

export const workflowPersistStorage: PersistStorage<PersistedWorkflowState, Promise<void>> = {
  async getItem(name) {
    try {
      const value = await workflowStorage.get<StorageValue<PersistedWorkflowState>>(name);
      setWorkflowPersistenceError(null);
      return value;
    } catch (error) {
      console.warn('[Workflow] Failed to read persisted projects.', error);
      setWorkflowPersistenceError({ operation: 'read', error });
      return null;
    }
  },
  setItem(name, value) {
    return new Promise<void>(resolve => {
      if (pendingWrite) {
        pendingWrite.name = name;
        pendingWrite.value = value;
        pendingWrite.waiters.push(resolve);
      } else {
        pendingWrite = { name, value, waiters: [resolve] };
      }
      if (writeTimer) clearTimeout(writeTimer);
      writeTimer = setTimeout(async () => {
        const write = pendingWrite;
        pendingWrite = null;
        writeTimer = null;
        if (!write) return;
        try {
          await workflowStorage.set(write.name, write.value);
          setWorkflowPersistenceError(null);
        } catch (error) {
          setWorkflowPersistenceError({ operation: 'write', error });
        }
        write.waiters.forEach(resolveWrite => resolveWrite());
      }, 400);
    });
  },
  async removeItem(name) {
    cancelPendingWrite();
    try {
      await workflowStorage.remove(name);
      setWorkflowPersistenceError(null);
    } catch (error) {
      setWorkflowPersistenceError({ operation: 'remove', error });
    }
  },
};

export const useWorkflowStore = create<WorkflowStore>()(
  persist<WorkflowStore, [], [], PersistedWorkflowState>(
    set => ({
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
      storage: workflowPersistStorage,
      partialize: state => ({ projects: state.projects, activeProjectId: state.activeProjectId }),
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
