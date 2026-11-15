import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import type { WorkflowNodeMetadata } from './types';

/**
 * 节点生成加载态的数据层（DESIGN / 01 §19.6）。
 *
 * 只从 workflowGeneration 已写进节点 metadata 的真实信号推导阶段，不伪造进度：
 * - transcode：generationMessage === TRANSCODE_MESSAGE（参考视频转码）；
 * - upload / queue / generate / download：Provider onProgress 的 generationTransfer.phase；
 * - queue 另认 onProviderTaskLifecycle('submitted') 写入的 SUBMITTED_MESSAGE；
 * - generate 另认其他供应商文案与 0–99 的真实百分比；
 * - write：节点仍为 loading 且 progress === 100（结果已到，正在原位写入画布）；
 * - 其余为 prepare。
 * 阶段决定网格细分级别（Inspora · Grid Reveal 的 2×2 → 4×4 → 8×8 → 12×12），同一次生成内只前进不后退。
 */

export type GenerationPhase = 'prepare' | 'transcode' | 'upload' | 'queue' | 'generate' | 'download' | 'write';

export const TRANSCODE_MESSAGE = '正在转码参考视频…';
export const SUBMITTED_MESSAGE = '任务已提交，等待供应商处理';

type PhaseMetadata = Pick<WorkflowNodeMetadata, 'status' | 'progress' | 'generationMessage' | 'generationTransfer'>;

export function deriveGenerationPhase(metadata: PhaseMetadata): GenerationPhase {
  const transfer = metadata.generationTransfer;
  const message = metadata.generationMessage;
  if (metadata.status === 'loading' && metadata.progress === 100) return 'write';
  if (transfer?.phase === 'download') return 'download';
  if (transfer?.phase === 'generate') return 'generate';
  if (transfer?.phase === 'queue') return 'queue';
  if (transfer?.phase === 'upload') return 'upload';
  if (message === TRANSCODE_MESSAGE) return 'transcode';
  if (message === SUBMITTED_MESSAGE) return 'queue';
  if (message) return 'generate';
  if (metadata.progress !== undefined && metadata.progress > 0) return 'generate';
  return 'prepare';
}

/** 阶段 → 网格细分级别下标（0 = 最粗）。 */
export function phaseGridLevel(phase: GenerationPhase): number {
  if (phase === 'prepare') return 0;
  if (phase === 'transcode' || phase === 'upload' || phase === 'queue') return 1;
  if (phase === 'generate') return 2;
  return 3;
}

/** 网格每级沿短边的格数；按容器尺寸裁掉会让格子小于 minCell 的级别。 */
export const GRID_LEVELS = [2, 4, 8, 12];
export function gridDivisions(level: number, shortSide: number, minCell = 9): number {
  const allowed = GRID_LEVELS.filter(divisions => shortSide / divisions >= minCell);
  const levels = allowed.length ? allowed : [GRID_LEVELS[0]];
  return levels[Math.max(0, Math.min(levels.length - 1, level))];
}

// —— 每个节点最近一次生成的开始时刻与已达到的级别：完成 / 失败时 metadata 已清空，靠它给出总耗时。——
interface RunRecord { startedAt: number; level: number }
const runs = new Map<string, RunRecord>();

/** 运行中每次渲染调用：记录开始时刻，返回只前进的网格级别。幂等。 */
export function trackGenerationRun(nodeId: string, startedAt: number | undefined, phase: GenerationPhase): RunRecord {
  const level = phaseGridLevel(phase);
  const existing = runs.get(nodeId);
  if (!existing || (startedAt !== undefined && existing.startedAt !== startedAt)) {
    const record = { startedAt: startedAt ?? Date.now(), level };
    runs.set(nodeId, record);
    return record;
  }
  if (level > existing.level) existing.level = level;
  return existing;
}

export function lastGenerationRun(nodeId: string): RunRecord | undefined {
  return runs.get(nodeId);
}

export function formatGenerationElapsed(ms: number): string {
  const value = Math.max(0, ms);
  if (value < 60000) return `${(value / 1000).toFixed(1)}s`;
  const sec = Math.floor(value / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// —— 共享计时器：所有节点的耗时共用一个 interval，直接写 textContent，不触发 React 渲染。——
type TickEntry = { el: HTMLElement; since: number; format: (ms: number) => string };
const tickEntries = new Set<TickEntry>();
let tickTimer: ReturnType<typeof setInterval> | undefined;
const TICK_MS = 100;

function writeTick(entry: TickEntry, now: number) {
  const text = entry.format(now - entry.since);
  if (entry.el.textContent !== text) entry.el.textContent = text;
}

export function activeTickerCount() {
  return tickEntries.size;
}

export function useTickingText(ref: RefObject<HTMLElement | null>, since: number | undefined, format: (ms: number) => string) {
  const formatRef = useRef(format);
  formatRef.current = format;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || since === undefined) return;
    const entry: TickEntry = { el, since, format: ms => formatRef.current(ms) };
    tickEntries.add(entry);
    writeTick(entry, Date.now());
    if (!tickTimer) tickTimer = setInterval(() => { const now = Date.now(); tickEntries.forEach(item => writeTick(item, now)); }, TICK_MS);
    return () => {
      tickEntries.delete(entry);
      if (!tickEntries.size && tickTimer) { clearInterval(tickTimer); tickTimer = undefined; }
    };
  }, [ref, since]);
}

// —— 共享节拍：网格噪点约每 0.9s 重排一次，所有节点共用一个 interval。——
const BEAT_MS = 900;
const beatListeners = new Set<() => void>();
let beatTimer: ReturnType<typeof setInterval> | undefined;

export function subscribeGenerationBeat(listener: () => void) {
  beatListeners.add(listener);
  if (!beatTimer) beatTimer = setInterval(() => beatListeners.forEach(item => item()), BEAT_MS);
  return () => {
    beatListeners.delete(listener);
    if (!beatListeners.size && beatTimer) { clearInterval(beatTimer); beatTimer = undefined; }
  };
}

// —— 动画名额：同屏最多 6 个节点跑网格闪动与不确定进度（DESIGN / 01 §19.6），其余静态。——
const MOTION_LIMIT = 6;
const motionSlots: symbol[] = [];
const slotListeners = new Set<() => void>();
let slotVersion = 0;
function emitSlots() { slotVersion += 1; slotListeners.forEach(listener => listener()); }
function subscribeSlots(listener: () => void) { slotListeners.add(listener); return () => { slotListeners.delete(listener); }; }

export function useGenerationMotionSlot(active: boolean): boolean {
  const id = useRef<symbol | null>(null);
  if (!id.current) id.current = Symbol('generation-motion');
  useEffect(() => {
    if (!active) return;
    const own = id.current!;
    motionSlots.push(own);
    emitSlots();
    return () => {
      const index = motionSlots.indexOf(own);
      if (index >= 0) motionSlots.splice(index, 1);
      emitSlots();
    };
  }, [active]);
  useSyncExternalStore(subscribeSlots, () => slotVersion, () => slotVersion);
  if (!active) return false;
  const index = motionSlots.indexOf(id.current);
  return index >= 0 && index < MOTION_LIMIT;
}

/** 确定性伪随机（mulberry32）：同一 seed 得到同一组噪点格，便于测试与重绘。 */
export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
