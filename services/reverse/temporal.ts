// L1 时间（对照 Hypit timeline / temporal 包的概念与命名，本仓库自写）。
// Timeline 只有 id、精确有理帧率与帧数，不含媒体与语义锚点；
// 所有绝对时间都落在帧边界上：TemporalInstant 为一个帧边界，TemporalWindow 为非空半开区间 [start, end)。
// 毫秒只在边界换算时出现；舍入方式由调用方显式指定。

export interface FrameRate {
  // 帧率 = num / den（帧每秒），例：30000/1001。
  num: number;
  den: number;
}

export interface Timeline {
  id: string;
  frameRate: FrameRate;
  frameCount: number;
}

// 帧边界序号 0..frameCount（= frameCount 表示末尾）。
export interface TemporalInstant {
  timelineId: string;
  frame: number;
}

export interface TemporalWindow {
  timelineId: string;
  start: number;
  // 不含；end > start。
  end: number;
}

// 源本地时间域（一段参考媒体 / 一条配音），以帧偏移放置在某条 Timeline 上。
export interface LocalTemporalDomain {
  id: string;
  timelineId: string;
  // 本地第 0 帧在 Timeline 上的帧边界。
  offsetFrame: number;
  frameCount: number;
}

export type FrameRounding = 'floor' | 'round' | 'ceil';

export const FPS_30: FrameRate = { num: 30, den: 1 };

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function isValidFrameRate(rate: FrameRate): boolean {
  return isPositiveInteger(rate.num) && isPositiveInteger(rate.den);
}

export function createTimeline(id: string, frameRate: FrameRate, frameCount: number): Timeline {
  if (!isValidFrameRate(frameRate)) throw new Error('invalid frame rate ' + frameRate.num + '/' + frameRate.den);
  if (!isPositiveInteger(frameCount)) throw new Error('frameCount must be a positive integer');
  return { id, frameRate: { ...frameRate }, frameCount };
}

export function msToFrame(rate: FrameRate, ms: number, rounding: FrameRounding = 'round'): number {
  const exact = (ms * rate.num) / (1000 * rate.den);
  // 抵消浮点误差（例如 33.366… ms 应正好落在第 1 帧）。
  const snapped = Math.abs(exact - Math.round(exact)) < 1e-9 ? Math.round(exact) : exact;
  return rounding === 'floor' ? Math.floor(snapped) : rounding === 'ceil' ? Math.ceil(snapped) : Math.round(snapped);
}

export function frameToMs(rate: FrameRate, frame: number): number {
  return (frame * 1000 * rate.den) / rate.num;
}

// 时长向上取整到整帧，保证媒体最后一帧有边界可落。
export function timelineFromDurationMs(id: string, durationMs: number, frameRate: FrameRate = FPS_30): Timeline {
  return createTimeline(id, frameRate, Math.max(1, msToFrame(frameRate, durationMs, 'ceil')));
}

export function instantAt(timeline: Timeline, frame: number): TemporalInstant {
  return { timelineId: timeline.id, frame: Math.min(timeline.frameCount, Math.max(0, frame)) };
}

export function instantFromMs(timeline: Timeline, ms: number, rounding: FrameRounding = 'round'): TemporalInstant {
  return instantAt(timeline, msToFrame(timeline.frameRate, ms, rounding));
}

// 帧窗口裁到 Timeline 内；裁后为空返回 null。
export function windowOf(timeline: Timeline, start: number, end: number): TemporalWindow | null {
  const s = Math.max(0, Math.min(timeline.frameCount, start));
  const e = Math.max(0, Math.min(timeline.frameCount, end));
  return e > s ? { timelineId: timeline.id, start: s, end: e } : null;
}

// 毫秒区间 → 覆盖它的最小帧窗口（起点向下、终点向上取整）；零长区间扩成一帧。
export function windowFromMs(timeline: Timeline, startMs: number, endMs: number): TemporalWindow | null {
  if (!(endMs >= startMs)) return null;
  const start = msToFrame(timeline.frameRate, startMs, 'floor');
  const end = Math.max(start + 1, msToFrame(timeline.frameRate, endMs, 'ceil'));
  return windowOf(timeline, start, end);
}

export function windowToMs(timeline: Timeline, window: TemporalWindow): { startMs: number; endMs: number } {
  return { startMs: frameToMs(timeline.frameRate, window.start), endMs: frameToMs(timeline.frameRate, window.end) };
}

export function windowFrames(window: TemporalWindow): number {
  return window.end - window.start;
}

export function intersectWindows(a: TemporalWindow, b: TemporalWindow): TemporalWindow | null {
  if (a.timelineId !== b.timelineId) return null;
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { timelineId: a.timelineId, start, end } : null;
}

export function windowsIntersect(a: TemporalWindow, b: TemporalWindow): boolean {
  return intersectWindows(a, b) !== null;
}

// 半开语义：instant 落在 [start, end) 内；window 完全被包含。
export function windowContains(outer: TemporalWindow, inner: TemporalWindow | TemporalInstant): boolean {
  if (outer.timelineId !== inner.timelineId) return false;
  if ('frame' in inner) return inner.frame >= outer.start && inner.frame < outer.end;
  return inner.start >= outer.start && inner.end <= outer.end;
}

// ── 本地时间域
export function createLocalDomain(id: string, timeline: Timeline, offsetFrame: number, frameCount: number): LocalTemporalDomain {
  if (!Number.isInteger(offsetFrame) || offsetFrame < 0) throw new Error('offsetFrame must be a non-negative integer');
  if (!isPositiveInteger(frameCount)) throw new Error('frameCount must be a positive integer');
  if (offsetFrame + frameCount > timeline.frameCount) throw new Error('domain ' + id + ' exceeds timeline ' + timeline.id);
  return { id, timelineId: timeline.id, offsetFrame, frameCount };
}

export function domainWindow(domain: LocalTemporalDomain): TemporalWindow {
  return { timelineId: domain.timelineId, start: domain.offsetFrame, end: domain.offsetFrame + domain.frameCount };
}

// 本地帧边界 → Timeline 帧边界；超出本地域返回 null，不外推。
export function localFrameToInstant(domain: LocalTemporalDomain, localFrame: number): TemporalInstant | null {
  if (!Number.isInteger(localFrame) || localFrame < 0 || localFrame > domain.frameCount) return null;
  return { timelineId: domain.timelineId, frame: domain.offsetFrame + localFrame };
}

// 本地毫秒（源媒体自己的时钟）→ Timeline 帧边界。
export function localMsToInstant(domain: LocalTemporalDomain, rate: FrameRate, localMs: number, rounding: FrameRounding = 'round'): TemporalInstant | null {
  return localFrameToInstant(domain, msToFrame(rate, localMs, rounding));
}
