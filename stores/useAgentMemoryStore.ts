// 内置 Agent 的项目记忆存储：每个 Iris 项目一份列表，localforage 持久化（浏览器业务数据不放 localStorage）。
// 读写规则（脱敏、去重、100 条上限淘汰最旧）在 services/agentProjectMemory.ts。
import { create } from 'zustand';
import localforage from 'localforage';
import {
  addMemoryEntry,
  removeMemoryEntry,
  type AddMemoryResult,
  type AgentMemoryBackend,
  type AgentMemoryEntry,
} from '../services/agentProjectMemory';

const memoryStore = localforage.createInstance({ name: 'iris', storeName: 'agent-memory' });
const memoryKey = (projectId: string) => `project.${projectId}`;

interface AgentMemoryState {
  byProject: Record<string, AgentMemoryEntry[]>;
  load: (projectId: string) => Promise<AgentMemoryEntry[]>;
  add: (projectId: string, input: { text: string; tags?: string[] }) => Promise<AddMemoryResult>;
  remove: (projectId: string, id: string) => Promise<AgentMemoryEntry | null>;
  clear: (projectId: string) => Promise<void>;
}

const loaded = new Set<string>();
// 同一项目的写入串行，避免两次 add 读到同一份旧列表互相覆盖。
const queues = new Map<string, Promise<unknown>>();
function serial<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(projectId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(projectId, next);
  return next;
}

export const useAgentMemoryStore = create<AgentMemoryState>((set, get) => ({
  byProject: {},

  load: async (projectId) => {
    if (loaded.has(projectId)) return get().byProject[projectId] || [];
    const stored = await memoryStore.getItem<AgentMemoryEntry[]>(memoryKey(projectId)).catch(() => null);
    const entries = Array.isArray(stored) ? stored : [];
    loaded.add(projectId);
    set(state => ({ byProject: { ...state.byProject, [projectId]: entries } }));
    return entries;
  },

  add: (projectId, input) => serial(projectId, async () => {
    const current = await get().load(projectId);
    const result = addMemoryEntry(current, input);
    if (!result.ok) return result;
    set(state => ({ byProject: { ...state.byProject, [projectId]: result.entries } }));
    await memoryStore.setItem(memoryKey(projectId), result.entries);
    return result;
  }),

  remove: (projectId, id) => serial(projectId, async () => {
    const current = await get().load(projectId);
    const { entries, removed } = removeMemoryEntry(current, id);
    set(state => ({ byProject: { ...state.byProject, [projectId]: entries } }));
    await memoryStore.setItem(memoryKey(projectId), entries);
    return removed;
  }),

  clear: (projectId) => serial(projectId, async () => {
    set(state => ({ byProject: { ...state.byProject, [projectId]: [] } }));
    await memoryStore.removeItem(memoryKey(projectId));
  }),
}));

/** 内核用的记忆读写接口（与面板共用同一个 store，面板里删掉的条目下一轮提示词就不再出现）。 */
export const agentMemoryStoreBackend: AgentMemoryBackend = {
  list: projectId => useAgentMemoryStore.getState().load(projectId),
  add: (projectId, input) => useAgentMemoryStore.getState().add(projectId, input),
  remove: (projectId, id) => useAgentMemoryStore.getState().remove(projectId, id),
};
