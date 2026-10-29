import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { INITIAL_WORKFLOW_VIEWPORT } from './constants';
import { pruneWorkflowMedia, setWorkflowMediaCanonicalProjects } from './media';
import { migrateWorkflowPersistedState, migrateWorkflowProject, WORKFLOW_BACKUP_KEY, WORKFLOW_PERSISTENCE_VERSION } from './migrations';
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
    draftLog: [],
    draftChangeSets: [],
    draftRedoStack: [],
    draftVersion: 1,
    workflowMutationReceipts: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface WorkflowStore {
  hydrated: boolean;
  projects: WorkflowProject[];
  activeProjectId: string | null;
  setHydrated: (hydrated: boolean) => void;
  createProject: (title?: string, seed?: Pick<WorkflowProject, 'nodes' | 'connections'>) => string;
  importProjects: (projects: WorkflowProject[]) => void;
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
let activeWrite: Promise<void> | null = null;
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

function persistWrite(write: PendingPersistWrite): Promise<void> {
  const task = (activeWrite || Promise.resolve()).then(async () => {
    try {
      await workflowStorage.set(write.name, write.value);
      setWorkflowPersistenceError(null);
    } catch (error) {
      setWorkflowPersistenceError({ operation: 'write', error });
    }
    write.waiters.forEach(resolve => resolve());
  });
  activeWrite = task;
  void task.then(() => {
    if (activeWrite === task) activeWrite = null;
  });
  return task;
}

export function flushWorkflowPersistence(): Promise<void> {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  const write = pendingWrite;
  pendingWrite = null;
  return write ? persistWrite(write) : activeWrite || Promise.resolve();
}

// 关闭/刷新标签页或切到后台时立即落盘，避免丢失 400ms 防抖窗口内的最后一次编辑。
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const flushOnHide = () => { if (pendingWrite) void flushWorkflowPersistence(); };
  window.addEventListener('pagehide', flushOnHide);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushOnHide(); });
}

export function normalizeWorkflowProject(project: WorkflowProject): WorkflowProject {
  return migrateWorkflowProject(project);
}

export const workflowPersistStorage: PersistStorage<PersistedWorkflowState, Promise<void>> = {
  async getItem(name) {
    try {
      const value = await workflowStorage.get<StorageValue<PersistedWorkflowState>>(name);
      setWorkflowPersistenceError(null);
      return value;
    } catch (error) {
      if (name === WORKFLOW_STORE_KEY) {
        try {
          const backup = await workflowStorage.get<{ version: number; state: PersistedWorkflowState }>(WORKFLOW_BACKUP_KEY);
          if (backup && typeof backup.version === 'number' && backup.state) {
            console.warn('[Workflow] Recovered a truncated persisted envelope from the migration backup.');
            setWorkflowPersistenceError(null);
            return { state: backup.state, version: backup.version };
          }
        } catch {
          // Preserve the original read error when the backup is unavailable too.
        }
      }
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
      writeTimer = setTimeout(() => { void flushWorkflowPersistence(); }, 400);
    });
  },
  async removeItem(name) {
    cancelPendingWrite();
    if (activeWrite) await activeWrite;
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
      createProject: (title, seed) => {
        const project = seed ? { ...createWorkflowProject(title), nodes: seed.nodes, connections: seed.connections } : createWorkflowProject(title);
        set(state => {
          const projects = [project, ...state.projects];
          setWorkflowMediaCanonicalProjects(projects);
          return { projects, activeProjectId: project.id };
        });
        return project.id;
      },
      importProjects: imported => set(state => {
        const projects = [...imported.map(normalizeWorkflowProject), ...state.projects];
        setWorkflowMediaCanonicalProjects(projects);
        return { projects, activeProjectId: imported[0]?.id || state.activeProjectId };
      }),
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
        setWorkflowMediaCanonicalProjects(projects);
        queueMicrotask(() => { void pruneWorkflowMedia(); });
        return { projects, activeProjectId };
      }),
      updateProject: (id, patch) => set(state => {
        const projects = state.projects.map(project => project.id === id
          ? { ...project, ...patch, updatedAt: new Date().toISOString() }
          : project);
        setWorkflowMediaCanonicalProjects(projects);
        return { projects };
      }),
    }),
    {
      name: WORKFLOW_STORE_KEY,
      version: WORKFLOW_PERSISTENCE_VERSION,
      storage: workflowPersistStorage,
      partialize: state => ({ projects: state.projects, activeProjectId: state.activeProjectId }),
      migrate: (persisted, version) => migrateWorkflowPersistedState(persisted, version),
      merge: (persisted, current) => {
        const state = persisted as Partial<PersistedWorkflowState> | undefined;
        const projects = Array.isArray(state?.projects) ? state.projects.map(normalizeWorkflowProject) : current.projects;
        setWorkflowMediaCanonicalProjects(projects);
        return {
          ...current,
          projects,
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
