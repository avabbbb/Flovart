import { nanoid } from 'nanoid';
import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { INITIAL_WORKFLOW_VIEWPORT } from './constants';
import { pruneWorkflowMedia, setWorkflowMediaCanonicalProjects, setWorkflowMediaPruneGuard } from './media';
import { isWorkflowWriter, notifyWorkflowPersisted, startWorkflowWriterElection, whenWorkflowWriterDecided } from './writerLock';
import { migrateWorkflowPersistedState, migrateWorkflowProject, migrateWorkflowProjectsSafely, WORKFLOW_BACKUP_KEY, WORKFLOW_QUARANTINE_KEY, WORKFLOW_PERSISTENCE_VERSION } from './migrations';
import { workflowStorage } from './storage';
import type { WorkflowProject } from './types';

export const WORKFLOW_STORE_KEY = 'iris:workflow:projects';

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
let lastFailedWrite: PendingPersistWrite | null = null;
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
    // 只读标签页不落盘：否则会用自己的旧内存状态覆盖写入者的数据。
    await whenWorkflowWriterDecided();
    if (!isWorkflowWriter()) {
      write.waiters.forEach(resolve => resolve());
      return;
    }
    try {
      await workflowStorage.set(write.name, write.value);
      lastFailedWrite = null;
      setWorkflowPersistenceError(null);
      notifyWorkflowPersisted();
    } catch (error) {
      lastFailedWrite = write;
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

/** 持久化失败后的重试：有新修改先落盘新的，否则重写上次失败的快照；读取失败则重新水合。 */
export async function retryWorkflowPersistence(): Promise<void> {
  if (pendingWrite) return flushWorkflowPersistence();
  if (persistenceError?.operation === 'read') {
    await useWorkflowStore.persist.rehydrate();
    return;
  }
  if (lastFailedWrite) return persistWrite({ ...lastFailedWrite, waiters: [] });
  return activeWrite || undefined;
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
        // 逐项目容错：单个坏项目被隔离，不让整个 store 水合失败（否则所有工作流都停在「正在加载」）。
        const projects = Array.isArray(state?.projects) ? migrateWorkflowProjectsSafely(state.projects) : current.projects;
        setWorkflowMediaCanonicalProjects(projects);
        return {
          ...current,
          projects,
          activeProjectId: typeof state?.activeProjectId === 'string'
            ? (projects.some(project => project.id === state.activeProjectId) ? state.activeProjectId : projects[0]?.id || null)
            : state?.activeProjectId === null ? null : current.activeProjectId,
        };
      },
      // 水合出错时 state 为 undefined：仍然标记已水合，让界面打开（空列表 / 已加载部分），不永远卡在加载中。
      // 原始数据先完整备份到隔离键，再以空状态打开，避免后续写入覆盖掉无法解析的旧数据。
      onRehydrateStorage: () => (state, error) => {
        if (state && !error) {
          state.setHydrated(true);
          return;
        }
        console.warn('[Workflow] 水合失败，原始数据已备份，按空状态打开。', error);
        void workflowStorage.get(WORKFLOW_STORE_KEY)
          .then(raw => (raw ? workflowStorage.set(WORKFLOW_QUARANTINE_KEY + ':store', { raw, createdAt: new Date().toISOString() }) : undefined))
          .catch(() => undefined)
          .finally(() => useWorkflowStore.getState().setHydrated(true));
      },
    },
  ),
);

export function getActiveWorkflowProject(): WorkflowProject | null {
  const state = useWorkflowStore.getState();
  return state.projects.find(project => project.id === state.activeProjectId) || null;
}

if (typeof window !== 'undefined') {
  setWorkflowMediaPruneGuard(isWorkflowWriter);
  startWorkflowWriterElection({
    reloadFromStorage: async () => { await useWorkflowStore.persist.rehydrate(); },
    flush: flushWorkflowPersistence,
    canHandOff: () => !useWorkflowStore.getState().projects.some(project => project.nodes.some(node => node.metadata.status === 'loading')),
  });
}
