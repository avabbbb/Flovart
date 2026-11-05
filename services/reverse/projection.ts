import { cueTimeRange } from './narrative';
import { localMsToInstant, msToFrame } from './temporal';
import type { LocalTemporalDomain, TemporalInstant, TemporalWindow, Timeline } from './temporal';
import type { ReverseCue, ReverseNarrative, ReverseShot, ReverseTokenTiming } from './types';

// L3 叙事投影（对照 Hypit narrative-temporal 包的概念与命名，本仓库自写）。
// 输入：Narrative + 对齐结果（align.ts 产出的 token 定时，毫秒在本地时间域自己的时钟上）+ LocalTemporalDomain；
// 输出：每个 token / segment / selection / moment 在 Timeline 上的绝对帧窗口或帧边界。
// 投影不外推：落在本地域之外、或定时与 token 不对应的对象给出 null 并记诊断。

export interface ProjectedToken {
  tokenId: string;
  index: number;
  window: TemporalWindow | null;
  // false：该 token 的时间由对齐阶段插值得到。
  measured: boolean;
}

export interface ProjectedSpan {
  id: string;
  window: TemporalWindow | null;
}

export interface ProjectedMoment {
  id: string;
  instant: TemporalInstant | null;
}

export interface ProjectionDiagnostic {
  code: 'timing-mismatch' | 'outside-domain';
  // token / segment / selection / moment 的 id；timing-mismatch 时为 narrative.id。
  id: string;
}

export interface NarrativeProjection {
  timelineId: string;
  domainId: string;
  tokens: ProjectedToken[];
  segments: ProjectedSpan[];
  selections: ProjectedSpan[];
  moments: ProjectedMoment[];
  diagnostics: ProjectionDiagnostic[];
}

// 本地毫秒区间 → Timeline 上覆盖它的帧窗口（起点向下、终点向上取整，零长扩成一帧）；超出本地域返回 null。
export function localMsWindow(timeline: Timeline, domain: LocalTemporalDomain, startMs: number, endMs: number): TemporalWindow | null {
  if (domain.timelineId !== timeline.id || !(endMs >= startMs)) return null;
  const start = msToFrame(timeline.frameRate, startMs, 'floor');
  const end = Math.max(start + 1, msToFrame(timeline.frameRate, endMs, 'ceil'));
  if (start < 0 || end > domain.frameCount) return null;
  return { timelineId: timeline.id, start: domain.offsetFrame + start, end: domain.offsetFrame + end };
}

// 单个 cue 的绝对投影：moment → 帧边界，selection / segment → 帧窗口；无法投影返回 null。
export function projectCue(
  timeline: Timeline,
  domain: LocalTemporalDomain,
  narrative: ReverseNarrative,
  timings: readonly ReverseTokenTiming[],
  cue: ReverseCue,
): TemporalWindow | TemporalInstant | null {
  if (domain.timelineId !== timeline.id) return null;
  const range = cueTimeRange(narrative, timings, cue);
  if (!range) return null;
  if (cue.kind === 'moment') return localMsToInstant(domain, timeline.frameRate, range.startMs);
  return localMsWindow(timeline, domain, range.startMs, range.endMs);
}

export function projectNarrative(
  timeline: Timeline,
  domain: LocalTemporalDomain,
  narrative: ReverseNarrative,
  timings: readonly ReverseTokenTiming[],
): NarrativeProjection {
  const diagnostics: ProjectionDiagnostic[] = [];
  const aligned = timings.length === narrative.tokens.length;
  if (!aligned) diagnostics.push({ code: 'timing-mismatch', id: narrative.id });
  const span = (kind: 'segment' | 'selection', id: string): ProjectedSpan => {
    const result = aligned ? projectCue(timeline, domain, narrative, timings, { kind, id }) : null;
    const window = result && 'start' in result ? result : null;
    if (aligned && !window) diagnostics.push({ code: 'outside-domain', id });
    return { id, window };
  };
  const tokens = narrative.tokens.map((token, index): ProjectedToken => {
    const timing = aligned ? timings[index] : undefined;
    const window = timing ? localMsWindow(timeline, domain, timing.startMs, timing.endMs) : null;
    if (timing && !window) diagnostics.push({ code: 'outside-domain', id: token.id });
    return { tokenId: token.id, index, window, measured: timing?.measured ?? false };
  });
  const segments = narrative.segments.map((s) => span('segment', s.id));
  const selections = narrative.selections.map((s) => span('selection', s.id));
  const moments = narrative.moments.map((m): ProjectedMoment => {
    const result = aligned ? projectCue(timeline, domain, narrative, timings, { kind: 'moment', id: m.id }) : null;
    const instant = result && 'frame' in result ? result : null;
    if (aligned && !instant) diagnostics.push({ code: 'outside-domain', id: m.id });
    return { id: m.id, instant };
  });
  return { timelineId: timeline.id, domainId: domain.id, tokens, segments, selections, moments, diagnostics };
}

// ── 目标重定时（由 video.ts 迁入，行为不变）：镜头跟着 cue 的意思走，而不是照抄参考秒数
export interface ShotWindow {
  shotId: string;
  startMs: number;
  endMs: number;
  // true：起点来自目标稿里同名 cue 的实测/估计时间。
  anchored: boolean;
}

export function retimeShots(
  shots: readonly ReverseShot[],
  narrative: ReverseNarrative,
  timings: readonly ReverseTokenTiming[],
): ShotWindow[] {
  const ordered = [...shots].sort((a, b) => a.index - b.index);
  const total = timings.length ? timings[timings.length - 1]!.endMs : 0;
  const starts: Array<{ ms: number; anchored: boolean }> = [];
  ordered.forEach((shot, i) => {
    const cue = shot.cue ? cueTimeRange(narrative, timings, shot.cue) : null;
    const prev = starts[i - 1];
    const prevShot = ordered[i - 1];
    const floor = prev ? prev.ms : 0;
    if (cue) starts.push({ ms: Math.max(floor, cue.startMs), anchored: true });
    else if (prev && prevShot) starts.push({ ms: floor + (prevShot.endMs - prevShot.startMs), anchored: false });
    else starts.push({ ms: 0, anchored: false });
  });
  return ordered.map((shot, i) => {
    const start = starts[i]!.ms;
    const next = starts[i + 1];
    const end = next ? Math.max(start, next.ms) : Math.max(start, total);
    return { shotId: shot.id, startMs: start, endMs: end, anchored: starts[i]!.anchored };
  });
}
