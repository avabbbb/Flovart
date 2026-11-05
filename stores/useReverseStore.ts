import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../utils/helpers';
import type { ReverseDirection, ReverseOutputRef, ReverseProject, ReverseVideoProject } from '../services/reverse/types';

// 逆向工作台只保存工作台状态；生成仍走 Workflow 节点 / production 闸门。
// 外部 Agent 不直接写这个 store，后续如需 Agent 操作，经 registry 暴露。

export function createVideoProject(id: string, title: string, now: string): ReverseVideoProject {
  return {
    id,
    title,
    direction: 'video',
    status: 'draft',
    references: [],
    anchors: [],
    outputs: [],
    gates: [],
    slots: [],
    axes: [],
    variants: [],
    createdAt: now,
    updatedAt: now,
  };
}

interface ReverseState {
  tab: ReverseDirection;
  projects: ReverseProject[];
  activeIds: Record<ReverseDirection, string | null>;
  setTab: (tab: ReverseDirection) => void;
  setActive: (direction: ReverseDirection, id: string | null) => void;
  createProject: (direction: ReverseDirection, title: string) => string;
  updateProject: (id: string, update: (project: ReverseProject) => ReverseProject) => void;
  removeProject: (id: string) => void;
}

// v1 → v2：产物补 origin。旧产物没有 key，所以永远不会被当作可复用候选（复用只认 key 相同）。
// v2 → v3：游戏方向暂缓，丢弃旧 game 工程与其 activeId。
export function migrateReverseState(persisted: unknown, version: number): unknown {
  if (!persisted || typeof persisted !== 'object' || version >= 3) return persisted;
  const state = persisted as { projects?: Array<{ direction?: string; outputs?: ReverseOutputRef[] }>; activeIds?: Record<string, string | null> };
  const fixOutput = (o: ReverseOutputRef): ReverseOutputRef => (o.origin ? o : { ...o, origin: 'generated' });
  const projects = (state.projects ?? [])
    .filter((p) => p.direction === 'video')
    .map((p) => (version < 2 ? { ...p, outputs: (p.outputs ?? []).map(fixOutput) } : p) as ReverseProject);
  return { ...state, tab: 'video', projects, activeIds: { video: state.activeIds?.video ?? null } };
}

export const useReverseStore = create<ReverseState>()(
  persist(
    (set) => ({
      tab: 'video',
      projects: [],
      activeIds: { video: null },
      setTab: (tab) => set({ tab }),
      setActive: (direction, id) => set((s) => ({ activeIds: { ...s.activeIds, [direction]: id } })),
      createProject: (direction, title) => {
        const id = generateId();
        const now = new Date().toISOString();
        const project = createVideoProject(id, title, now);
        set((s) => ({ projects: [project, ...s.projects], activeIds: { ...s.activeIds, [direction]: id } }));
        return id;
      },
      updateProject: (id, update) => set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? { ...update(p), updatedAt: new Date().toISOString() } : p)),
      })),
      removeProject: (id) => set((s) => {
        const projects = s.projects.filter((p) => p.id !== id);
        const activeIds = { ...s.activeIds };
        (Object.keys(activeIds) as ReverseDirection[]).forEach((d) => {
          if (activeIds[d] === id) activeIds[d] = projects.find((p) => p.direction === d)?.id ?? null;
        });
        return { projects, activeIds };
      }),
    }),
    { name: 'flovart-reverse', version: 3, migrate: (persisted, version) => migrateReverseState(persisted, version) as ReverseState },
  ),
);
