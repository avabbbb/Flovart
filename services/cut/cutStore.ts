// Cut 编辑器状态（Zustand，结构参照 OpenCut classic 的 editor / timeline store 拆分：
// 时间线文档 + 撤销栈 / 播放头 / 选择 / 剪贴板 / 吸附开关）。
// UI 与 Agent 工具都只通过这里的 action 改时间线，所以撤销 / 重做对两边一致；
// 不依赖 React，也不依赖 mediabunny——Cut 页没打开时 Agent 也能读写（headless）。
import { createStore } from 'zustand/vanilla';
import {
  createCutProject, cutStorageKey, deserializeCutProject, findClip, projectDuration, serializeCutProject,
  type CutClip, type CutOpResult, type CutProject,
} from './timeline';

const HISTORY_LIMIT = 100;

export interface CutDocState {
  past: CutProject[];
  present: CutProject;
  future: CutProject[];
}

export interface CutStoreState {
  /** 当前绑定的画布项目（每个画布项目一份时间线）。 */
  projectId: string | null;
  doc: CutDocState;
  playhead: number;
  playing: boolean;
  selection: string[];
  clipboard: CutClip[];
  snapping: boolean;
  /** 最近一次修改的说明（UI 显示 / Agent 回执）。 */
  lastChange: { label: string; source: 'ui' | 'agent'; at: number } | null;
}

export interface CutStoreActions {
  /** 切换到某个画布项目的时间线（从 localStorage 读）。同一个项目重复调用不做事。 */
  open(projectId: string | null): void;
  /** 提交一次操作结果（成功才进撤销栈）。返回同一个结果，便于链式。 */
  commit(result: CutOpResult, label?: string, source?: 'ui' | 'agent'): CutOpResult;
  /** 直接替换文档（新状态进撤销栈）。 */
  apply(next: CutProject, label?: string, source?: 'ui' | 'agent'): void;
  /** 不进撤销栈的替换（探测元数据后的回填、拖动中的实时预览）。 */
  replace(next: CutProject): void;
  /** 拖动结束：把 before → 当前文档记成一个撤销步骤。 */
  commitFrom(before: CutProject, label?: string): void;
  undo(): boolean;
  redo(): boolean;
  setPlayhead(t: number): void;
  setPlaying(playing: boolean): void;
  select(ids: string[]): void;
  copy(ids?: string[]): number;
  toggleSnapping(): void;
}

export type CutStore = CutStoreState & CutStoreActions;

function loadProject(projectId: string | null): CutProject {
  if (!projectId) return createCutProject();
  try {
    const raw = globalThis.localStorage?.getItem(cutStorageKey(projectId));
    return (raw && deserializeCutProject(raw)) || createCutProject();
  } catch {
    return createCutProject();
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(projectId: string | null, project: CutProject) {
  if (!projectId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { globalThis.localStorage?.setItem(cutStorageKey(projectId), serializeCutProject(project)); } catch { /* quota: ignore */ }
  }, 300);
}

/** 立刻落盘（测试 / 页面卸载）。 */
export function flushCutStore() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const { projectId, doc } = cutStore.getState();
  if (projectId) try { globalThis.localStorage?.setItem(cutStorageKey(projectId), serializeCutProject(doc.present)); } catch { /* ignore */ }
}

function pruneSelection(selection: string[], project: CutProject) {
  return selection.filter(id => !!findClip(project, id));
}

export const cutStore = createStore<CutStore>()((set, get) => ({
  projectId: null,
  doc: { past: [], present: createCutProject(), future: [] },
  playhead: 0,
  playing: false,
  selection: [],
  clipboard: [],
  snapping: true,
  lastChange: null,

  open(projectId) {
    if (get().projectId === projectId && projectId !== null) return;
    flushCutStore();
    set({ projectId, doc: { past: [], present: loadProject(projectId), future: [] }, playhead: 0, playing: false, selection: [], lastChange: null });
  },

  commit(result, label = 'edit', source = 'ui') {
    if (!result.ok) return result;
    get().apply(result.project, label, source);
    if (result.clipId) set({ selection: [result.clipId] });
    return result;
  },

  apply(next, label = 'edit', source = 'ui') {
    const { doc, projectId, selection, playhead } = get();
    if (doc.present === next) return;
    set({
      doc: { past: [...doc.past, doc.present].slice(-HISTORY_LIMIT), present: next, future: [] },
      selection: pruneSelection(selection, next),
      playhead: Math.min(playhead, Math.max(projectDuration(next), 0)),
      lastChange: { label, source, at: Date.now() },
    });
    scheduleSave(projectId, next);
  },

  replace(next) {
    const { doc, projectId } = get();
    set({ doc: { ...doc, present: next } });
    scheduleSave(projectId, next);
  },

  commitFrom(before, label = 'edit') {
    const { doc, projectId } = get();
    if (doc.present === before) return;
    set({ doc: { past: [...doc.past, before].slice(-HISTORY_LIMIT), present: doc.present, future: [] }, lastChange: { label, source: 'ui', at: Date.now() } });
    scheduleSave(projectId, doc.present);
  },

  undo() {
    const { doc, projectId, selection } = get();
    if (!doc.past.length) return false;
    const present = doc.past[doc.past.length - 1];
    set({ doc: { past: doc.past.slice(0, -1), present, future: [doc.present, ...doc.future] }, selection: pruneSelection(selection, present), lastChange: { label: 'undo', source: 'ui', at: Date.now() } });
    scheduleSave(projectId, present);
    return true;
  },

  redo() {
    const { doc, projectId, selection } = get();
    if (!doc.future.length) return false;
    const present = doc.future[0];
    set({ doc: { past: [...doc.past, doc.present], present, future: doc.future.slice(1) }, selection: pruneSelection(selection, present), lastChange: { label: 'redo', source: 'ui', at: Date.now() } });
    scheduleSave(projectId, present);
    return true;
  },

  setPlayhead(t) {
    const duration = projectDuration(get().doc.present);
    set({ playhead: Math.max(0, Math.min(Number.isFinite(t) ? t : 0, Math.max(duration, 0))) });
  },

  setPlaying(playing) { set({ playing }); },

  select(ids) { set({ selection: pruneSelection(ids, get().doc.present) }); },

  copy(ids) {
    const project = get().doc.present;
    const clips = (ids ?? get().selection).map(id => findClip(project, id)).filter((clip): clip is CutClip => !!clip);
    if (clips.length) set({ clipboard: JSON.parse(JSON.stringify(clips)) });
    return clips.length;
  },

  toggleSnapping() { set({ snapping: !get().snapping }); },
}));

export const getCutProject = () => cutStore.getState().doc.present;
