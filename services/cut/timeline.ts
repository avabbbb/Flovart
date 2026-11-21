// Cut 时间线模型：纯数据 + 纯函数（不碰 DOM / WebCodecs），便于单测与序列化。
// 时间单位一律是秒。轨道顺序 = 叠放顺序：tracks[0] 在最底层，越靠后越在上面（文字轨默认最上）。
// 每条轨道内片段不重叠；所有操作返回新对象（不可变），失败时返回原对象不变 + 原因。

export type CutTrackKind = 'video' | 'audio' | 'text' | 'subtitle';
export type CutClipKind = 'video' | 'image' | 'audio' | 'text' | 'subtitle';
export type CutSourceKind = 'video' | 'image' | 'audio';

/** 素材来源：画布节点（可跨会话恢复）或本地文件（只在本次会话里有字节）。 */
export type CutSourceOrigin =
  | { type: 'canvas'; nodeId: string; storageKey?: string; href?: string; /** 导入时节点结果的版本（见 canvasNodeVersion）。 */ version?: string }
  | { type: 'file'; fileName: string };

export interface CutSource {
  id: string;
  kind: CutSourceKind;
  name: string;
  /** 媒体时长（秒）；图片为 0（无限）。 */
  duration: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  /** 文件大小（字节）。 */
  size?: number;
  /** 预览代理（只记录高度；文件在 OPFS / IndexedDB）。 */
  proxy?: { height: number };
  origin: CutSourceOrigin;
}

export interface CutTextStyle {
  size: number; // 相对画面高度的比例（0.02–0.3）
  color: string;
  /** 竖直位置：0 顶 – 1 底（文字块中心）。 */
  y: number;
  /** 水平位置：0 左 – 1 右（文字块中心），默认 0.5。 */
  x?: number;
  background?: boolean;
  backgroundColor?: string;
  fontFamily?: string;
  bold?: boolean;
  /** 描边颜色与宽度（宽度是字号的比例，0 = 无描边）。 */
  strokeColor?: string;
  strokeWidth?: number;
}

/** 可做关键帧的属性（相对片段起点的秒数）。 */
export type CutAnimatable = 'opacity' | 'scale' | 'x' | 'y';
export interface CutKeyframe { time: number; property: CutAnimatable; value: number }

export interface CutTransform {
  /** 1 = 适配画面（contain）。 */
  scale: number;
  /** 以画面宽 / 高为单位的偏移。 */
  x: number;
  y: number;
  opacity: number;
}

export const DEFAULT_TRANSFORM: CutTransform = { scale: 1, x: 0, y: 0, opacity: 1 };

export interface CutClip {
  id: string;
  trackId: string;
  kind: CutClipKind;
  sourceId?: string;
  /** 在时间线上的起点。 */
  start: number;
  /** 在素材里的入点（图片 / 文字恒为 0）。 */
  in: number;
  duration: number;
  /** 0–2，1 = 原始音量。 */
  volume: number;
  /** 0.25–4，1 = 原速。时间线时长 = 素材跨度 / speed。 */
  speed?: number;
  transform?: CutTransform;
  keyframes?: CutKeyframe[];
  text?: string;
  /** 画布联动：片段引用的画布节点与其结果版本（不复制文件，字节按需从画布存储读）。 */
  link?: CutClipLink;
  /** 文字片段的样式；字幕片段只存覆盖项，其余跟随项目的字幕样式。 */
  textStyle?: CutTextStyle;
}

export interface CutClipLink { sourceNodeId: string; sourceVersion: string }

export interface CutTrack {
  id: string;
  kind: CutTrackKind;
  name: string;
  muted?: boolean;
}

export interface CutProject {
  version: 1;
  width: number;
  height: number;
  fps: number;
  tracks: CutTrack[];
  clips: CutClip[];
  sources: CutSource[];
  /** 所有字幕片段共用的样式（批量应用）。 */
  subtitleStyle: CutTextStyle;
}

export interface CutOpResult { project: CutProject; ok: boolean; error?: string; clipId?: string }

export const CUT_MIN_CLIP = 0.1;
export const CUT_DEFAULT_IMAGE_DURATION = 3;
export const CUT_DEFAULT_TEXT_DURATION = 3;
const EPS = 1e-6;

export const DEFAULT_TEXT_STYLE: CutTextStyle = { size: 0.07, color: '#ffffff', y: 0.82, background: true };
export const DEFAULT_SUBTITLE_STYLE: CutTextStyle = { size: 0.055, color: '#ffffff', y: 0.88, x: 0.5, background: false, strokeColor: '#000000', strokeWidth: 0.12, bold: true };
export const CUT_MIN_SPEED = 0.25;
export const CUT_MAX_SPEED = 4;

let idCounter = 0;
export function cutId(prefix: string): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

export function clipEnd(clip: Pick<CutClip, 'start' | 'duration'>): number {
  return clip.start + clip.duration;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

export function trackAccepts(track: CutTrack, kind: CutClipKind): boolean {
  if (track.kind === 'video') return kind === 'video' || kind === 'image';
  if (track.kind === 'audio') return kind === 'audio';
  if (track.kind === 'subtitle') return kind === 'subtitle';
  return kind === 'text';
}

export function trackKindFor(kind: CutClipKind): CutTrackKind {
  return kind === 'audio' ? 'audio' : kind === 'text' ? 'text' : kind === 'subtitle' ? 'subtitle' : 'video';
}

export function clipSpeed(clip: Pick<CutClip, 'speed'>): number {
  return clip.speed && Number.isFinite(clip.speed) ? clip.speed : 1;
}

/** 片段是否引用媒体时间（视频 / 音频）。 */
export function isTimedMedia(kind: CutClipKind) {
  return kind === 'video' || kind === 'audio';
}

export function isTextLike(kind: CutClipKind) {
  return kind === 'text' || kind === 'subtitle';
}

export function createCutProject(options: Partial<Pick<CutProject, 'width' | 'height' | 'fps'>> = {}): CutProject {
  return {
    version: 1,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? 30,
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1' },
      { id: 'a1', kind: 'audio', name: 'A1' },
      { id: 't1', kind: 'text', name: 'T1' },
      { id: 's1', kind: 'subtitle', name: 'SUB' },
    ],
    clips: [],
    sources: [],
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
  };
}

export function projectDuration(project: CutProject): number {
  return project.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
}

export function clipsOnTrack(project: CutProject, trackId: string): CutClip[] {
  return project.clips.filter(clip => clip.trackId === trackId).sort((a, b) => a.start - b.start);
}

/** 时刻 t 正在播放的片段，按叠放顺序（底 → 顶）。 */
export function clipsAt(project: CutProject, t: number): CutClip[] {
  const order = new Map(project.tracks.map((track, index) => [track.id, index]));
  return project.clips
    .filter(clip => t >= clip.start - EPS && t < clipEnd(clip) - EPS)
    .sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
}

export function findClip(project: CutProject, clipId: string): CutClip | undefined {
  return project.clips.find(clip => clip.id === clipId);
}

export function findSource(project: CutProject, sourceId?: string): CutSource | undefined {
  return sourceId ? project.sources.find(source => source.id === sourceId) : undefined;
}

function overlaps(project: CutProject, trackId: string, start: number, end: number, ignoreId?: string): boolean {
  return project.clips.some(clip => clip.trackId === trackId && clip.id !== ignoreId && start < clipEnd(clip) - EPS && end > clip.start + EPS);
}

function fail(project: CutProject, error: string): CutOpResult {
  return { project, ok: false, error };
}

function withClips(project: CutProject, clips: CutClip[]): CutProject {
  return { ...project, clips };
}

/** 片段在时间线上最多能有多长（受素材长度、入点与速度约束）。 */
function maxTimelineDuration(project: CutProject, clip: Pick<CutClip, 'kind' | 'sourceId' | 'in' | 'speed'>): number {
  if (!isTimedMedia(clip.kind)) return Number.POSITIVE_INFINITY;
  const source = findSource(project, clip.sourceId);
  if (!source || !(source.duration > 0)) return Number.POSITIVE_INFINITY;
  return Math.max(CUT_MIN_CLIP, (source.duration - clip.in) / clipSpeed(clip));
}

function replaceClip(project: CutProject, updated: CutClip): CutProject {
  return withClips(project, project.clips.map(item => item.id === updated.id ? updated : item));
}

export function addTrack(project: CutProject, kind: CutTrackKind): CutOpResult {
  const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : kind === 'subtitle' ? 'SUB' : 'T';
  const count = project.tracks.filter(track => track.kind === kind).length + 1;
  const track: CutTrack = { id: cutId(kind[0]), kind, name: count > 1 || kind !== 'subtitle' ? `${prefix}${count}` : prefix };
  // 视频轨插在已有视频轨之上（文字 / 字幕轨之下），其他轨放在末尾——叠放只看视频 / 文字 / 字幕轨的相对顺序。
  const tracks = [...project.tracks];
  if (kind === 'video') {
    const lastVideo = tracks.map(item => item.kind).lastIndexOf('video');
    tracks.splice(lastVideo + 1, 0, track);
  } else {
    tracks.push(track);
  }
  return { project: { ...project, tracks }, ok: true };
}

export function removeTrack(project: CutProject, trackId: string): CutOpResult {
  if (!project.tracks.some(track => track.id === trackId)) return fail(project, 'track not found');
  return {
    project: { ...project, tracks: project.tracks.filter(track => track.id !== trackId), clips: project.clips.filter(clip => clip.trackId !== trackId) },
    ok: true,
  };
}

export function addSource(project: CutProject, source: CutSource): CutProject {
  if (project.sources.some(item => item.id === source.id)) return { ...project, sources: project.sources.map(item => item.id === source.id ? source : item) };
  return { ...project, sources: [...project.sources, source] };
}

export function removeSource(project: CutProject, sourceId: string): CutOpResult {
  if (!findSource(project, sourceId)) return fail(project, 'source not found');
  return { project: { ...project, sources: project.sources.filter(source => source.id !== sourceId), clips: project.clips.filter(clip => clip.sourceId !== sourceId) }, ok: true };
}

function ensureTrack(project: CutProject, kind: CutClipKind, trackId?: string): { project: CutProject; track?: CutTrack; error?: string } {
  let track = trackId ? project.tracks.find(item => item.id === trackId) : project.tracks.find(item => trackAccepts(item, kind));
  if (trackId && !track) return { project, error: 'track not found' };
  if (track && !trackAccepts(track, kind)) return { project, error: `a ${kind} clip cannot go on a ${track.kind} track` };
  if (track) return { project, track };
  const added = addTrack(project, trackKindFor(kind)).project;
  track = [...added.tracks].reverse().find(item => item.kind === trackKindFor(kind));
  return { project: added, track };
}

/** 把素材放进时间线：默认接在目标轨道末尾；没有合适轨道时自动新建。 */
export function addClip(
  project: CutProject,
  input: { kind: CutClipKind; sourceId?: string; trackId?: string; start?: number; duration?: number; in?: number; text?: string; volume?: number; speed?: number; link?: CutClipLink },
): CutOpResult {
  const ensured = ensureTrack(project, input.kind, input.trackId);
  if (ensured.error || !ensured.track) return fail(project, ensured.error || 'no track');
  const next = ensured.project;
  const track = ensured.track;
  const source = findSource(next, input.sourceId);
  if ((input.kind === 'video' || input.kind === 'audio' || input.kind === 'image') && !source) return fail(project, 'source not found');
  if (source && trackKindFor(source.kind === 'image' ? 'image' : source.kind) !== trackKindFor(input.kind)) return fail(project, `source is ${source.kind}, not ${input.kind}`);
  const speed = Math.max(CUT_MIN_SPEED, Math.min(CUT_MAX_SPEED, input.speed ?? 1));
  const inPoint = isTimedMedia(input.kind) ? Math.max(0, Math.min(input.in ?? 0, Math.max(0, (source?.duration ?? 0) - CUT_MIN_CLIP))) : 0;
  const draft = { kind: input.kind, sourceId: input.sourceId, in: inPoint, speed };
  const fallbackDuration = input.kind === 'image' ? CUT_DEFAULT_IMAGE_DURATION
    : isTextLike(input.kind) ? CUT_DEFAULT_TEXT_DURATION
      : maxTimelineDuration(next, draft);
  const duration = Math.max(CUT_MIN_CLIP, Math.min(input.duration ?? fallbackDuration, maxTimelineDuration(next, draft)));
  if (!Number.isFinite(duration)) return fail(project, 'invalid duration');
  const trackEnd = clipsOnTrack(next, track.id).reduce((max, clip) => Math.max(max, clipEnd(clip)), 0);
  const start = round(Math.max(0, input.start ?? trackEnd));
  if (overlaps(next, track.id, start, start + duration)) return fail(project, 'overlaps another clip');
  const clip: CutClip = {
    id: cutId('c'),
    trackId: track.id,
    kind: input.kind,
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    start,
    in: round(inPoint),
    duration: round(duration),
    volume: Math.max(0, Math.min(2, input.volume ?? 1)),
    ...(speed !== 1 ? { speed } : {}),
    ...(input.link && !isTextLike(input.kind) ? { link: { ...input.link } } : {}),
    ...(input.kind === 'text' ? { text: input.text ?? 'Text', textStyle: { ...DEFAULT_TEXT_STYLE } } : {}),
    ...(input.kind === 'subtitle' ? { text: input.text ?? '' } : {}),
  };
  return { project: withClips(next, [...next.clips, clip]), ok: true, clipId: clip.id };
}

/**
 * 修剪：改左沿（同时移动入点）或右沿。左沿受入点 ≥0 约束，右沿受素材长度约束，都受相邻片段约束（不重叠）。
 */
export function trimClip(project: CutProject, clipId: string, edge: 'start' | 'end', time: number): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  if (!Number.isFinite(time)) return fail(project, 'invalid time');
  const speed = clipSpeed(clip);
  const siblings = clipsOnTrack(project, clip.trackId).filter(item => item.id !== clipId);
  const end = clipEnd(clip);
  if (edge === 'start') {
    const prevEnd = siblings.filter(item => clipEnd(item) <= clip.start + EPS).reduce((max, item) => Math.max(max, clipEnd(item)), 0);
    const minStart = Math.max(prevEnd, isTimedMedia(clip.kind) ? clip.start - clip.in / speed : 0);
    const start = round(Math.min(Math.max(time, minStart), end - CUT_MIN_CLIP));
    const delta = start - clip.start;
    const updated: CutClip = { ...clip, start, in: round(isTimedMedia(clip.kind) ? Math.max(0, clip.in + delta * speed) : 0), duration: round(end - start), ...shiftKeyframes(clip, -delta) };
    return { project: replaceClip(project, updated), ok: true, clipId };
  }
  const nextStart = siblings.filter(item => item.start >= end - EPS).reduce((min, item) => Math.min(min, item.start), Number.POSITIVE_INFINITY);
  const maxEnd = Math.min(nextStart, clip.start + maxTimelineDuration(project, clip));
  const newEnd = Math.min(Math.max(time, clip.start + CUT_MIN_CLIP), maxEnd);
  const updated: CutClip = { ...clip, duration: round(newEnd - clip.start) };
  return { project: replaceClip(project, updated), ok: true, clipId };
}

function shiftKeyframes(clip: CutClip, delta: number): Partial<CutClip> {
  if (!clip.keyframes?.length) return {};
  return { keyframes: clip.keyframes.map(frame => ({ ...frame, time: round(frame.time + delta) })).filter(frame => frame.time >= -EPS) };
}

/** 在时间线时刻 t 把片段一分为二；返回右半段 id。 */
export function splitClip(project: CutProject, clipId: string, t: number): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  const offset = t - clip.start;
  if (offset < CUT_MIN_CLIP - EPS || clip.duration - offset < CUT_MIN_CLIP - EPS) return fail(project, 'split point too close to an edge');
  const left: CutClip = { ...clip, duration: round(offset), ...(clip.keyframes ? { keyframes: clip.keyframes.filter(frame => frame.time <= offset + EPS) } : {}) };
  const right: CutClip = {
    ...clip,
    id: cutId('c'),
    start: round(t),
    in: isTimedMedia(clip.kind) ? round(clip.in + offset * clipSpeed(clip)) : 0,
    duration: round(clip.duration - offset),
    ...(clip.textStyle ? { textStyle: { ...clip.textStyle } } : {}),
    ...(clip.transform ? { transform: { ...clip.transform } } : {}),
    ...(clip.keyframes ? { keyframes: clip.keyframes.filter(frame => frame.time >= offset - EPS).map(frame => ({ ...frame, time: round(frame.time - offset) })) } : {}),
  };
  const clips = project.clips.flatMap(item => item.id === clipId ? [left, right] : [item]);
  return { project: withClips(project, clips), ok: true, clipId: right.id };
}

/** 在 t 处切开所有跨过 t 的片段（可限定轨道或片段）。 */
export function splitAt(project: CutProject, t: number, trackId?: string, clipIds?: readonly string[]): CutOpResult {
  let next = project;
  let any = false;
  let lastId: string | undefined;
  for (const clip of project.clips) {
    if (trackId && clip.trackId !== trackId) continue;
    if (clipIds && clipIds.length && !clipIds.includes(clip.id)) continue;
    if (t > clip.start + EPS && t < clipEnd(clip) - EPS) {
      const result = splitClip(next, clip.id, t);
      if (result.ok) { next = result.project; any = true; lastId = result.clipId; }
    }
  }
  return any ? { project: next, ok: true, clipId: lastId } : fail(project, 'nothing under the playhead');
}

export function deleteClip(project: CutProject, clipId: string, options: { ripple?: boolean } = {}): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  let clips = project.clips.filter(item => item.id !== clipId);
  if (options.ripple) {
    clips = clips.map(item => item.trackId === clip.trackId && item.start >= clipEnd(clip) - EPS ? { ...item, start: round(item.start - clip.duration) } : item);
  }
  return { project: withClips(project, clips), ok: true };
}

export function deleteClips(project: CutProject, clipIds: readonly string[], options: { ripple?: boolean } = {}): CutOpResult {
  let next = project;
  let any = false;
  // 从后往前删，ripple 时前面的位移不影响后面的判断。
  const ordered = clipIds.map(id => findClip(project, id)).filter((clip): clip is CutClip => !!clip).sort((a, b) => b.start - a.start);
  for (const clip of ordered) {
    const result = deleteClip(next, clip.id, options);
    if (result.ok) { next = result.project; any = true; }
  }
  return any ? { project: next, ok: true } : fail(project, 'clip not found');
}

/**
 * 剪映的 Q / W：删除播放头左侧 / 右侧的部分并合拢空隙（同轨道后面的片段前移）。
 * 作用于给定片段；没给时作用于播放头下的所有片段。
 */
export function deleteSide(project: CutProject, t: number, side: 'left' | 'right', clipIds?: readonly string[]): CutOpResult {
  const targets = project.clips.filter(clip => (!clipIds?.length || clipIds.includes(clip.id)) && t > clip.start + EPS && t < clipEnd(clip) - EPS);
  if (!targets.length) return fail(project, 'nothing under the playhead');
  let next = project;
  for (const target of targets) {
    const clip = findClip(next, target.id)!;
    if (side === 'left') {
      const removed = t - clip.start;
      const trimmed = trimClip(next, clip.id, 'start', t);
      if (!trimmed.ok) continue;
      const moved = findClip(trimmed.project, clip.id)!;
      next = withClips(trimmed.project, trimmed.project.clips.map(item => {
        if (item.id === clip.id) return { ...moved, start: clip.start };
        if (item.trackId === clip.trackId && item.start >= clipEnd(moved) - EPS) return { ...item, start: round(item.start - removed) };
        return item;
      }));
    } else {
      const end = clipEnd(clip);
      const removed = end - t;
      const trimmed = trimClip(next, clip.id, 'end', t);
      if (!trimmed.ok) continue;
      next = withClips(trimmed.project, trimmed.project.clips.map(item => item.trackId === clip.trackId && item.id !== clip.id && item.start >= end - EPS ? { ...item, start: round(item.start - removed) } : item));
    }
  }
  return { project: next, ok: true };
}

/** 移动到 (trackId, start)。与目标轨道的片段重叠时拒绝；类型不符的轨道拒绝。 */
export function moveClip(project: CutProject, clipId: string, trackId: string, start: number): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  const track = project.tracks.find(item => item.id === trackId);
  if (!track) return fail(project, 'track not found');
  if (!trackAccepts(track, clip.kind)) return fail(project, `a ${clip.kind} clip cannot go on a ${track.kind} track`);
  if (!Number.isFinite(start)) return fail(project, 'invalid time');
  const target = round(Math.max(0, start));
  if (overlaps(project, trackId, target, target + clip.duration, clipId)) return fail(project, 'overlaps another clip');
  return { project: replaceClip(project, { ...clip, trackId, start: target }), ok: true, clipId };
}

/**
 * 在同一轨道内重排：把片段移到第 toIndex 位，整条轨道从第一个片段的起点开始首尾相接（磁吸重排）。
 */
export function reorderClip(project: CutProject, clipId: string, toIndex: number): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  const ordered = clipsOnTrack(project, clip.trackId);
  const from = ordered.findIndex(item => item.id === clipId);
  const target = Math.max(0, Math.min(ordered.length - 1, toIndex));
  if (from === target) return { project, ok: true, clipId };
  const origin = ordered[0]?.start ?? 0;
  const list = [...ordered];
  list.splice(from, 1);
  list.splice(target, 0, clip);
  let cursor = origin;
  const placed = new Map<string, CutClip>();
  for (const item of list) {
    placed.set(item.id, { ...item, start: round(cursor) });
    cursor += item.duration;
  }
  return { project: withClips(project, project.clips.map(item => placed.get(item.id) ?? item)), ok: true, clipId };
}

/** 复制片段到同一轨道上它后面第一个放得下的位置（或指定位置 / 轨道）。 */
export function duplicateClip(project: CutProject, clipId: string, at?: { start?: number; trackId?: string }): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  return pasteClips(project, [clip], at?.start ?? clipEnd(clip), at?.trackId);
}

/** 粘贴：保持片段之间的相对位置；目标位置被占用时往后找空位。 */
export function pasteClips(project: CutProject, clips: readonly CutClip[], at: number, trackId?: string): CutOpResult {
  if (!clips.length) return fail(project, 'clipboard is empty');
  const origin = Math.min(...clips.map(clip => clip.start));
  let next = project;
  let lastId: string | undefined;
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const targetTrack = trackId && project.tracks.find(track => track.id === trackId && trackAccepts(track, clip.kind)) ? trackId
      : next.tracks.some(track => track.id === clip.trackId) ? clip.trackId : undefined;
    if (clip.sourceId && !findSource(next, clip.sourceId)) continue;
    const ensured = ensureTrack(next, clip.kind, targetTrack);
    if (!ensured.track) continue;
    next = ensured.project;
    let start = round(Math.max(0, at + (clip.start - origin)));
    for (let guard = 0; guard < 200 && overlaps(next, ensured.track.id, start, start + clip.duration); guard += 1) {
      const blocker = clipsOnTrack(next, ensured.track.id).find(item => start < clipEnd(item) - EPS && start + clip.duration > item.start + EPS);
      start = blocker ? round(clipEnd(blocker)) : start + clip.duration;
    }
    const copy: CutClip = JSON.parse(JSON.stringify(clip));
    copy.id = cutId('c');
    copy.trackId = ensured.track.id;
    copy.start = start;
    next = withClips(next, [...next.clips, copy]);
    lastId = copy.id;
  }
  return lastId ? { project: next, ok: true, clipId: lastId } : fail(project, 'nothing to paste');
}

export interface CutClipPatch {
  volume?: number;
  speed?: number;
  text?: string;
  textStyle?: Partial<CutTextStyle>;
  transform?: Partial<CutTransform>;
}

export function updateClip(project: CutProject, clipId: string, patch: CutClipPatch): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  for (const [key, value] of Object.entries({ volume: patch.volume, speed: patch.speed })) {
    if (value !== undefined && !Number.isFinite(value)) return fail(project, `invalid ${key}`);
  }
  let updated: CutClip = {
    ...clip,
    ...(patch.volume !== undefined ? { volume: Math.max(0, Math.min(2, patch.volume)) } : {}),
    ...(patch.text !== undefined && isTextLike(clip.kind) ? { text: String(patch.text) } : {}),
    ...(patch.textStyle && isTextLike(clip.kind) ? { textStyle: { ...(clip.kind === 'text' ? (clip.textStyle ?? DEFAULT_TEXT_STYLE) : (clip.textStyle ?? {} as CutTextStyle)), ...sanitizeStyle(patch.textStyle) } } : {}),
    ...(patch.transform && !isTextLike(clip.kind) && clip.kind !== 'audio' ? { transform: { ...DEFAULT_TRANSFORM, ...(clip.transform || {}), ...sanitizeTransform(patch.transform) } } : {}),
  };
  if (patch.speed !== undefined && isTimedMedia(clip.kind)) {
    // 改速度：保持素材跨度不变，时间线时长按速度伸缩；不能挤进后面的片段。
    const speed = Math.max(CUT_MIN_SPEED, Math.min(CUT_MAX_SPEED, patch.speed));
    const span = clip.duration * clipSpeed(clip);
    const nextStart = clipsOnTrack(project, clip.trackId).filter(item => item.id !== clip.id && item.start >= clipEnd(clip) - EPS).reduce((min, item) => Math.min(min, item.start), Number.POSITIVE_INFINITY);
    const duration = round(Math.max(CUT_MIN_CLIP, Math.min(span / speed, nextStart - clip.start)));
    updated = { ...updated, speed, duration };
    if (speed === 1) delete updated.speed;
  }
  return { project: replaceClip(project, updated), ok: true, clipId };
}

function sanitizeStyle(style: Partial<CutTextStyle>): Partial<CutTextStyle> {
  const out: Partial<CutTextStyle> = {};
  if (typeof style.size === 'number' && Number.isFinite(style.size)) out.size = Math.max(0.01, Math.min(0.4, style.size));
  if (typeof style.y === 'number' && Number.isFinite(style.y)) out.y = Math.max(0, Math.min(1, style.y));
  if (typeof style.x === 'number' && Number.isFinite(style.x)) out.x = Math.max(0, Math.min(1, style.x));
  if (typeof style.strokeWidth === 'number' && Number.isFinite(style.strokeWidth)) out.strokeWidth = Math.max(0, Math.min(0.5, style.strokeWidth));
  for (const key of ['color', 'backgroundColor', 'strokeColor', 'fontFamily'] as const) {
    if (typeof style[key] === 'string') out[key] = String(style[key]).slice(0, 120);
  }
  for (const key of ['background', 'bold'] as const) {
    if (typeof style[key] === 'boolean') out[key] = style[key];
  }
  return out;
}

function sanitizeTransform(transform: Partial<CutTransform>): Partial<CutTransform> {
  const out: Partial<CutTransform> = {};
  if (Number.isFinite(transform.scale)) out.scale = Math.max(0.05, Math.min(10, transform.scale!));
  if (Number.isFinite(transform.x)) out.x = Math.max(-2, Math.min(2, transform.x!));
  if (Number.isFinite(transform.y)) out.y = Math.max(-2, Math.min(2, transform.y!));
  if (Number.isFinite(transform.opacity)) out.opacity = Math.max(0, Math.min(1, transform.opacity!));
  return out;
}

// ── 关键帧 ───────────────────────────────────────────────────────────────

const ANIMATABLE: readonly CutAnimatable[] = ['opacity', 'scale', 'x', 'y'];

/** 设置（或替换同一时刻的）关键帧。time 是相对片段起点的秒数。 */
export function setKeyframe(project: CutProject, clipId: string, frame: CutKeyframe): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  if (!ANIMATABLE.includes(frame.property)) return fail(project, `property must be one of ${ANIMATABLE.join(', ')}`);
  if (!Number.isFinite(frame.time) || !Number.isFinite(frame.value)) return fail(project, 'invalid keyframe');
  if (frame.time < -EPS || frame.time > clip.duration + EPS) return fail(project, 'keyframe outside the clip');
  const value = frame.property === 'opacity' ? Math.max(0, Math.min(1, frame.value)) : frame.property === 'scale' ? Math.max(0.05, Math.min(10, frame.value)) : Math.max(-2, Math.min(2, frame.value));
  const time = round(Math.max(0, Math.min(clip.duration, frame.time)));
  const keyframes = [...(clip.keyframes || []).filter(item => !(item.property === frame.property && Math.abs(item.time - time) < 1e-3)), { time, property: frame.property, value }]
    .sort((a, b) => a.time - b.time);
  return { project: replaceClip(project, { ...clip, keyframes }), ok: true, clipId };
}

export function removeKeyframes(project: CutProject, clipId: string, filter: { property?: CutAnimatable; time?: number } = {}): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  const keyframes = (clip.keyframes || []).filter(item => !((!filter.property || item.property === filter.property) && (filter.time === undefined || Math.abs(item.time - filter.time) < 1e-3)));
  const updated: CutClip = { ...clip, keyframes };
  if (!keyframes.length) delete updated.keyframes;
  return { project: replaceClip(project, updated), ok: true, clipId };
}

/** 片段在本地时刻 local 的实际变换（静态值 + 关键帧线性插值）。 */
export function transformAt(clip: CutClip, local: number): CutTransform {
  const base = { ...DEFAULT_TRANSFORM, ...(clip.transform || {}) };
  if (!clip.keyframes?.length) return base;
  for (const property of ANIMATABLE) {
    const frames = clip.keyframes.filter(item => item.property === property);
    if (!frames.length) continue;
    if (local <= frames[0].time) { base[property] = frames[0].value; continue; }
    const last = frames[frames.length - 1];
    if (local >= last.time) { base[property] = last.value; continue; }
    const index = frames.findIndex(item => item.time > local);
    const a = frames[index - 1];
    const b = frames[index];
    const k = (local - a.time) / Math.max(1e-6, b.time - a.time);
    base[property] = a.value + (b.value - a.value) * k;
  }
  return base;
}

export function setTrackMuted(project: CutProject, trackId: string, muted: boolean): CutProject {
  return { ...project, tracks: project.tracks.map(track => track.id === trackId ? { ...track, muted } : track) };
}

/** 把时间映射到素材时间（不在片段内返回 null）。 */
export function sourceTimeAt(clip: CutClip, t: number): number | null {
  if (t < clip.start - EPS || t >= clipEnd(clip) - EPS) return null;
  return clip.in + (t - clip.start) * clipSpeed(clip);
}

/** 所有剪辑点（片段起止），升序去重，用于 ↑ / ↓ 跳转。 */
export function cutPoints(project: CutProject): number[] {
  const points = new Set<number>([0]);
  for (const clip of project.clips) { points.add(round(clip.start)); points.add(round(clipEnd(clip))); }
  return [...points].sort((a, b) => a - b);
}

export function nextCutPoint(project: CutProject, t: number, direction: 1 | -1): number {
  const points = cutPoints(project);
  if (direction > 0) return points.find(point => point > t + 1e-3) ?? points[points.length - 1] ?? 0;
  return [...points].reverse().find(point => point < t - 1e-3) ?? 0;
}

// ── 字幕 ─────────────────────────────────────────────────────────────────

export function subtitleClips(project: CutProject): CutClip[] {
  return project.clips.filter(clip => clip.kind === 'subtitle').sort((a, b) => a.start - b.start);
}

export function effectiveTextStyle(project: CutProject, clip: CutClip): CutTextStyle {
  if (clip.kind === 'subtitle') return { ...DEFAULT_SUBTITLE_STYLE, ...project.subtitleStyle, ...(clip.textStyle || {}) };
  return { ...DEFAULT_TEXT_STYLE, ...(clip.textStyle || {}) };
}

/** 批量：改项目字幕样式；clearOverrides 时同时清掉每条字幕自己的覆盖项。 */
export function setSubtitleStyle(project: CutProject, patch: Partial<CutTextStyle>, options: { clearOverrides?: boolean } = {}): CutOpResult {
  const style = { ...DEFAULT_SUBTITLE_STYLE, ...project.subtitleStyle, ...sanitizeStyle(patch) };
  const clips = options.clearOverrides ? project.clips.map(clip => {
    if (clip.kind !== 'subtitle' || !clip.textStyle) return clip;
    const { textStyle: _drop, ...rest } = clip;
    return rest as CutClip;
  }) : project.clips;
  return { project: { ...project, subtitleStyle: style, clips }, ok: true };
}

/** 加一条字幕：放到字幕轨（没有就建），与已有字幕重叠时拒绝。 */
export function addSubtitle(project: CutProject, input: { start: number; end: number; text: string; trackId?: string }): CutOpResult {
  if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.end - input.start < CUT_MIN_CLIP - EPS) return fail(project, 'invalid time range');
  return addClip(project, { kind: 'subtitle', start: input.start, duration: input.end - input.start, text: input.text, trackId: input.trackId });
}

/** 改一条字幕的时间范围（起止都可改），不与同轨字幕重叠。 */
export function setClipRange(project: CutProject, clipId: string, start: number, end: number): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < CUT_MIN_CLIP - EPS || start < 0) return fail(project, 'invalid time range');
  if (isTimedMedia(clip.kind)) {
    // 媒体片段用修剪语义（入点跟着走）。
    let next = trimClip(project, clipId, 'start', start).project;
    next = trimClip(next, clipId, 'end', end).project;
    return { project: next, ok: true, clipId };
  }
  if (overlaps(project, clip.trackId, start, end, clipId)) return fail(project, 'overlaps another clip');
  return { project: replaceClip(project, { ...clip, start: round(start), duration: round(end - start) }), ok: true, clipId };
}

/**
 * 在文字的 cursor 位置把字幕拆成两条（Enter）：时间按字数比例分配。
 */
export function splitSubtitleAtText(project: CutProject, clipId: string, cursor: number): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'subtitle') return fail(project, 'subtitle not found');
  const text = clip.text || '';
  const at = Math.max(0, Math.min(text.length, Math.round(cursor)));
  const ratio = text.length ? at / text.length : 0.5;
  const t = clip.start + Math.max(CUT_MIN_CLIP, Math.min(clip.duration - CUT_MIN_CLIP, clip.duration * ratio));
  const split = splitClip(project, clipId, t);
  if (!split.ok) return split;
  let next = replaceClip(split.project, { ...findClip(split.project, clipId)!, text: text.slice(0, at).trimEnd() });
  next = replaceClip(next, { ...findClip(next, split.clipId!)!, text: text.slice(at).trimStart() });
  return { project: next, ok: true, clipId: split.clipId };
}

/** Backspace 在行首：并入上一条字幕（时间合并成一段，文字拼接）。返回上一条的 id。 */
export function mergeSubtitleWithPrevious(project: CutProject, clipId: string): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip || clip.kind !== 'subtitle') return fail(project, 'subtitle not found');
  const list = clipsOnTrack(project, clip.trackId);
  const index = list.findIndex(item => item.id === clipId);
  const prev = list[index - 1];
  if (!prev) return fail(project, 'no previous subtitle');
  const joiner = /[\u3000-\u9fff\uff00-\uffef]$/.test(prev.text || '') || /^[\u3000-\u9fff\uff00-\uffef]/.test(clip.text || '') ? '' : ' ';
  const merged: CutClip = { ...prev, duration: round(clipEnd(clip) - prev.start), text: [prev.text || '', clip.text || ''].filter(Boolean).join(joiner) };
  const clips = project.clips.filter(item => item.id !== clipId).map(item => item.id === prev.id ? merged : item);
  return { project: withClips(project, clips), ok: true, clipId: prev.id };
}

/** 用一组字幕替换（或追加到）字幕轨。重叠的条目会顺延到前一条结束之后。 */
export function importSubtitles(project: CutProject, cues: ReadonlyArray<{ start: number; end: number; text: string }>, options: { replace?: boolean; offset?: number } = {}): CutOpResult {
  let next = project;
  const ensured = ensureTrack(next, 'subtitle');
  if (!ensured.track) return fail(project, 'no subtitle track');
  next = ensured.project;
  const trackId = ensured.track.id;
  if (options.replace) next = withClips(next, next.clips.filter(clip => clip.trackId !== trackId));
  let count = 0;
  let cursor = 0;
  const offset = options.offset ?? 0;
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    let start = Math.max(cue.start + offset, cursor);
    const end = cue.end + offset;
    if (end - start < CUT_MIN_CLIP) continue;
    while (overlaps(next, trackId, start, end)) {
      const blocker = clipsOnTrack(next, trackId).find(item => start < clipEnd(item) - EPS && end > item.start + EPS);
      if (!blocker) break;
      start = clipEnd(blocker);
      if (end - start < CUT_MIN_CLIP) break;
    }
    if (end - start < CUT_MIN_CLIP || overlaps(next, trackId, start, end)) continue;
    const added = addClip(next, { kind: 'subtitle', trackId, start, duration: end - start, text: cue.text });
    if (added.ok) { next = added.project; count += 1; cursor = end; }
  }
  return count ? { project: next, ok: true } : fail(project, 'no usable subtitle cues');
}

/**
 * 画布联动：把片段换成同一节点的新版本素材（保留位置 / 入点 / 变换，时长按新素材长度收紧）。
 * 新素材必须已在 sources 里且与片段同类。
 */
export function relinkClip(project: CutProject, clipId: string, sourceId: string, link: CutClipLink): CutOpResult {
  const clip = findClip(project, clipId);
  if (!clip) return fail(project, 'clip not found');
  const source = findSource(project, sourceId);
  if (!source) return fail(project, 'source not found');
  if (trackKindFor(source.kind === 'image' ? 'image' : source.kind) !== trackKindFor(clip.kind)) return fail(project, `source is ${source.kind}, not ${clip.kind}`);
  const kind: CutClipKind = source.kind;
  const inPoint = isTimedMedia(kind) ? Math.max(0, Math.min(clip.in, Math.max(0, source.duration - CUT_MIN_CLIP))) : 0;
  const draft = { ...clip, kind, sourceId, in: inPoint };
  const duration = Math.max(CUT_MIN_CLIP, Math.min(clip.duration, maxTimelineDuration(project, draft)));
  const { speed, ...rest } = draft;
  const updated: CutClip = { ...rest, ...(isTimedMedia(kind) && speed && speed !== 1 ? { speed } : {}), in: round(inPoint), duration: round(duration), link: { ...link } };
  let next = replaceClip(project, updated);
  // 旧版本素材没有片段再用时一并移除。
  const oldId = clip.sourceId;
  if (oldId && oldId !== sourceId && !next.clips.some(item => item.sourceId === oldId)) next = { ...next, sources: next.sources.filter(item => item.id !== oldId) };
  return { project: next, ok: true, clipId };
}

// ── 序列化 ────────────────────────────────────────────────────────────────

export function serializeCutProject(project: CutProject): string {
  return JSON.stringify(project);
}

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isStr = (value: unknown): value is string => typeof value === 'string';

/** 解析并校验；坏数据丢弃坏条目而不是整份失败（坏到连结构都没有时返回 null）。 */
export function deserializeCutProject(raw: string | unknown): CutProject | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  const value = data as Record<string, unknown>;
  if (value.version !== 1 || !Array.isArray(value.tracks) || !Array.isArray(value.clips)) return null;
  const tracks: CutTrack[] = value.tracks
    .filter((track): track is CutTrack => !!track && isStr((track as CutTrack).id) && ['video', 'audio', 'text', 'subtitle'].includes((track as CutTrack).kind))
    .map(track => ({ id: track.id, kind: track.kind, name: isStr(track.name) ? track.name : track.id, ...(track.muted ? { muted: true } : {}) }));
  const sources: CutSource[] = (Array.isArray(value.sources) ? value.sources : [])
    .filter((source): source is CutSource => !!source && isStr((source as CutSource).id) && ['video', 'image', 'audio'].includes((source as CutSource).kind)
      && !!(source as CutSource).origin && ['canvas', 'file'].includes((source as CutSource).origin.type))
    .map(source => ({ ...source, name: isStr(source.name) ? source.name : source.id, duration: isNum(source.duration) ? source.duration : 0 }));
  const trackById = new Map(tracks.map(track => [track.id, track]));
  const sourceIds = new Set(sources.map(source => source.id));
  const clips: CutClip[] = value.clips
    .filter((clip): clip is CutClip => {
      if (!clip || typeof clip !== 'object') return false;
      const item = clip as CutClip;
      const track = trackById.get(item.trackId);
      if (!isStr(item.id) || !track || !trackAccepts(track, item.kind)) return false;
      if (!isNum(item.start) || !isNum(item.duration) || item.duration <= 0 || item.start < 0) return false;
      if (!isTextLike(item.kind) && (!item.sourceId || !sourceIds.has(item.sourceId))) return false;
      return true;
    })
    .map(clip => ({
      id: clip.id,
      trackId: clip.trackId,
      kind: clip.kind,
      ...(clip.sourceId ? { sourceId: clip.sourceId } : {}),
      start: clip.start,
      in: isNum(clip.in) && clip.in >= 0 ? clip.in : 0,
      duration: clip.duration,
      volume: isNum(clip.volume) ? Math.max(0, Math.min(2, clip.volume)) : 1,
      ...(clip.link && isStr(clip.link.sourceNodeId) && isStr(clip.link.sourceVersion) && !isTextLike(clip.kind) ? { link: { sourceNodeId: clip.link.sourceNodeId, sourceVersion: clip.link.sourceVersion } } : {}),
      ...(isNum(clip.speed) && clip.speed !== 1 && isTimedMedia(clip.kind) ? { speed: Math.max(CUT_MIN_SPEED, Math.min(CUT_MAX_SPEED, clip.speed)) } : {}),
      ...(clip.transform && typeof clip.transform === 'object' && !isTextLike(clip.kind) ? { transform: { ...DEFAULT_TRANSFORM, ...sanitizeTransform(clip.transform) } } : {}),
      ...(Array.isArray(clip.keyframes) && clip.keyframes.length ? { keyframes: clip.keyframes.filter(frame => frame && isNum(frame.time) && isNum(frame.value) && ANIMATABLE.includes(frame.property)) } : {}),
      ...(clip.kind === 'text' ? { text: isStr(clip.text) ? clip.text : '', textStyle: { ...DEFAULT_TEXT_STYLE, ...(clip.textStyle || {}) } } : {}),
      ...(clip.kind === 'subtitle' ? { text: isStr(clip.text) ? clip.text : '', ...(clip.textStyle ? { textStyle: sanitizeStyle(clip.textStyle) as CutTextStyle } : {}) } : {}),
    }));
  return {
    version: 1,
    width: isNum(value.width) && value.width > 0 ? Math.round(value.width) : 1920,
    height: isNum(value.height) && value.height > 0 ? Math.round(value.height) : 1080,
    fps: isNum(value.fps) && value.fps > 0 && value.fps <= 120 ? value.fps : 30,
    tracks,
    clips,
    sources,
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, ...(value.subtitleStyle && typeof value.subtitleStyle === 'object' ? sanitizeStyle(value.subtitleStyle as Partial<CutTextStyle>) : {}) },
  };
}

/** 持久化键：每个画布项目一份时间线。本地文件素材只有元数据会恢复（字节不落盘）。 */
export const CUT_STORAGE_PREFIX = 'iris.cut.timeline.v1:';
export function cutStorageKey(projectId: string) {
  return `${CUT_STORAGE_PREFIX}${projectId}`;
}
