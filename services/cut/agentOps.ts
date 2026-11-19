// Agent ↔ Cut：只读视图与批量编辑操作（纯函数，无 DOM / 媒体依赖，便于单测）。
// 写操作整批在一份草稿上执行，任何一步失败则整批不提交；成功后由调用方一次 cutStore.apply（= 一个撤销步骤）。
import {
  addClip, addSubtitle, addTrack, clipEnd, clipSpeed, deleteClips, deleteSide, duplicateClip, effectiveTextStyle, findClip, findSource,
  importSubtitles, mergeSubtitleWithPrevious, moveClip, projectDuration, removeKeyframes, removeTrack, reorderClip, setClipRange,
  setKeyframe, setSubtitleStyle, setTrackMuted, splitAt, splitClip, splitSubtitleAtText, subtitleClips, transformAt, trimClip, updateClip,
  type CutAnimatable, type CutClip, type CutClipKind, type CutOpResult, type CutProject, type CutTextStyle, type CutTrackKind, type CutTransform,
} from './timeline';

const r3 = (value: number) => Math.round(value * 1000) / 1000;

export function describeClip(project: CutProject, clip: CutClip) {
  const source = findSource(project, clip.sourceId);
  return {
    id: clip.id,
    trackId: clip.trackId,
    kind: clip.kind,
    ...(source ? { sourceId: source.id, sourceName: source.name } : {}),
    start: r3(clip.start),
    end: r3(clipEnd(clip)),
    duration: r3(clip.duration),
    ...(clip.kind === 'video' || clip.kind === 'audio' ? { in: r3(clip.in), out: r3(clip.in + clip.duration * clipSpeed(clip)), speed: clipSpeed(clip), volume: clip.volume } : {}),
    ...(clip.text !== undefined ? { text: clip.text } : {}),
    ...(clip.keyframes?.length ? { keyframes: clip.keyframes.length } : {}),
  };
}

export function describeTimeline(project: CutProject, view: { playhead: number; selection: string[]; snapping: boolean; canUndo: boolean; canRedo: boolean }) {
  return {
    fps: project.fps,
    width: project.width,
    height: project.height,
    duration: r3(projectDuration(project)),
    playhead: r3(view.playhead),
    selection: view.selection,
    snapping: view.snapping,
    canUndo: view.canUndo,
    canRedo: view.canRedo,
    tracks: project.tracks.map((track, index) => ({
      id: track.id,
      kind: track.kind,
      name: track.name,
      layer: index,
      ...(track.muted ? { muted: true } : {}),
      clips: project.clips.filter(clip => clip.trackId === track.id).sort((a, b) => a.start - b.start).map(clip => describeClip(project, clip)),
    })),
  };
}

export function describeInspector(project: CutProject, clip: CutClip, at?: number) {
  const local = at !== undefined ? Math.max(0, Math.min(clip.duration, at - clip.start)) : 0;
  return {
    ...describeClip(project, clip),
    transform: clip.kind === 'audio' || clip.kind === 'text' || clip.kind === 'subtitle' ? null : { static: { scale: 1, x: 0, y: 0, opacity: 1, ...(clip.transform || {}) }, atPlayhead: transformAt(clip, local) },
    keyframes: clip.keyframes || [],
    textStyle: clip.kind === 'text' || clip.kind === 'subtitle' ? effectiveTextStyle(project, clip) : null,
    subtitleOverrides: clip.kind === 'subtitle' ? clip.textStyle || {} : undefined,
    audio: clip.kind === 'video' || clip.kind === 'audio' ? { volume: clip.volume, muted: !!project.tracks.find(track => track.id === clip.trackId)?.muted, hasAudio: clip.kind === 'audio' || !!findSource(project, clip.sourceId)?.hasAudio } : null,
    speed: clip.kind === 'video' || clip.kind === 'audio' ? clipSpeed(clip) : null,
    filters: [],
  };
}

export function describeSubtitles(project: CutProject) {
  return {
    style: project.subtitleStyle,
    subtitles: subtitleClips(project).map((clip, index) => ({ index: index + 1, id: clip.id, trackId: clip.trackId, start: r3(clip.start), end: r3(clipEnd(clip)), text: clip.text || '', ...(clip.textStyle && Object.keys(clip.textStyle).length ? { overrides: clip.textStyle } : {}) })),
  };
}

export type CutAgentOperation =
  | { op: 'add_clip'; sourceId?: string; kind?: CutClipKind; trackId?: string; start?: number; duration?: number; in?: number; text?: string; volume?: number; speed?: number }
  | { op: 'move_clip'; clipId: string; start?: number; trackId?: string }
  | { op: 'trim_clip'; clipId: string; start?: number; end?: number }
  | { op: 'split'; time: number; clipId?: string; trackId?: string }
  | { op: 'delete_clips'; clipIds: string[]; ripple?: boolean }
  | { op: 'delete_side'; time: number; side: 'left' | 'right'; clipIds?: string[] }
  | { op: 'duplicate_clip'; clipId: string; start?: number; trackId?: string }
  | { op: 'reorder_clip'; clipId: string; index: number }
  | { op: 'set_clip'; clipId: string; volume?: number; speed?: number; text?: string; textStyle?: Partial<CutTextStyle>; transform?: Partial<CutTransform> }
  | { op: 'set_keyframe'; clipId: string; property: CutAnimatable; time: number; value: number }
  | { op: 'remove_keyframes'; clipId: string; property?: CutAnimatable; time?: number }
  | { op: 'add_track'; kind: CutTrackKind }
  | { op: 'remove_track'; trackId: string }
  | { op: 'set_track'; trackId: string; muted: boolean }
  | { op: 'add_subtitle'; start: number; end: number; text: string }
  | { op: 'update_subtitle'; clipId: string; text?: string; start?: number; end?: number; style?: Partial<CutTextStyle> }
  | { op: 'delete_subtitles'; clipIds: string[] }
  | { op: 'split_subtitle'; clipId: string; cursor: number }
  | { op: 'merge_subtitle'; clipId: string }
  | { op: 'replace_subtitles'; cues: Array<{ start: number; end: number; text: string }> }
  | { op: 'subtitle_style'; style: Partial<CutTextStyle>; clearOverrides?: boolean };

export interface CutOperationOutcome { ok: boolean; project: CutProject; results: Array<{ op: string; ok: boolean; error?: string; clipId?: string }>; error?: string }

function num(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function requireClip(project: CutProject, clipId: unknown): CutClip {
  if (typeof clipId !== 'string') throw new Error('clipId is required');
  const clip = findClip(project, clipId);
  if (!clip) throw new Error(`clip ${clipId} not found`);
  return clip;
}

function step(project: CutProject, operation: CutAgentOperation): CutOpResult {
  switch (operation.op) {
    case 'add_clip': {
      const source = findSource(project, operation.sourceId);
      const kind = operation.kind ?? (source?.kind === 'image' ? 'image' : source?.kind);
      if (!kind) throw new Error('add_clip needs sourceId (from iris_cut_get_assets) or kind=text|subtitle');
      return addClip(project, { kind, sourceId: operation.sourceId, trackId: operation.trackId, start: operation.start, duration: operation.duration, in: operation.in, text: operation.text, volume: operation.volume, speed: operation.speed });
    }
    case 'move_clip': {
      const clip = requireClip(project, operation.clipId);
      return moveClip(project, clip.id, operation.trackId ?? clip.trackId, operation.start ?? clip.start);
    }
    case 'trim_clip': {
      let clip = requireClip(project, operation.clipId);
      let next = project;
      if (operation.start !== undefined) { const result = trimClip(next, clip.id, 'start', num(operation.start, 'start')); if (!result.ok) return result; next = result.project; clip = findClip(next, clip.id)!; }
      if (operation.end !== undefined) { const result = trimClip(next, clip.id, 'end', num(operation.end, 'end')); if (!result.ok) return result; next = result.project; }
      return { project: next, ok: true, clipId: clip.id };
    }
    case 'split':
      return operation.clipId ? splitClip(project, requireClip(project, operation.clipId).id, num(operation.time, 'time')) : splitAt(project, num(operation.time, 'time'), operation.trackId);
    case 'delete_clips':
      if (!Array.isArray(operation.clipIds) || !operation.clipIds.length) throw new Error('clipIds is required');
      operation.clipIds.forEach(id => requireClip(project, id));
      return deleteClips(project, operation.clipIds, { ripple: operation.ripple });
    case 'delete_side':
      return deleteSide(project, num(operation.time, 'time'), operation.side === 'left' ? 'left' : 'right', operation.clipIds);
    case 'duplicate_clip':
      return duplicateClip(project, requireClip(project, operation.clipId).id, { start: operation.start, trackId: operation.trackId });
    case 'reorder_clip':
      return reorderClip(project, requireClip(project, operation.clipId).id, num(operation.index, 'index'));
    case 'set_clip':
      return updateClip(project, requireClip(project, operation.clipId).id, { volume: operation.volume, speed: operation.speed, text: operation.text, textStyle: operation.textStyle, transform: operation.transform });
    case 'set_keyframe':
      return setKeyframe(project, requireClip(project, operation.clipId).id, { property: operation.property, time: num(operation.time, 'time'), value: num(operation.value, 'value') });
    case 'remove_keyframes':
      return removeKeyframes(project, requireClip(project, operation.clipId).id, { property: operation.property, time: operation.time });
    case 'add_track':
      if (!['video', 'audio', 'text', 'subtitle'].includes(operation.kind)) throw new Error('kind must be video|audio|text|subtitle');
      return addTrack(project, operation.kind);
    case 'remove_track':
      return removeTrack(project, String(operation.trackId));
    case 'set_track':
      if (!project.tracks.some(track => track.id === operation.trackId)) throw new Error(`track ${operation.trackId} not found`);
      return { project: setTrackMuted(project, operation.trackId, !!operation.muted), ok: true };
    case 'add_subtitle':
      return addSubtitle(project, { start: num(operation.start, 'start'), end: num(operation.end, 'end'), text: String(operation.text ?? '') });
    case 'update_subtitle': {
      const clip = requireClip(project, operation.clipId);
      if (clip.kind !== 'subtitle') throw new Error(`${clip.id} is not a subtitle`);
      let next = project;
      if (operation.start !== undefined || operation.end !== undefined) {
        const result = setClipRange(next, clip.id, operation.start ?? clip.start, operation.end ?? clipEnd(clip));
        if (!result.ok) return result;
        next = result.project;
      }
      if (operation.text !== undefined || operation.style) {
        const result = updateClip(next, clip.id, { text: operation.text, textStyle: operation.style });
        if (!result.ok) return result;
        next = result.project;
      }
      return { project: next, ok: true, clipId: clip.id };
    }
    case 'delete_subtitles':
      if (!Array.isArray(operation.clipIds) || !operation.clipIds.length) throw new Error('clipIds is required');
      operation.clipIds.forEach(id => { if (requireClip(project, id).kind !== 'subtitle') throw new Error(`${id} is not a subtitle`); });
      return deleteClips(project, operation.clipIds);
    case 'split_subtitle':
      return splitSubtitleAtText(project, requireClip(project, operation.clipId).id, num(operation.cursor, 'cursor'));
    case 'merge_subtitle':
      return mergeSubtitleWithPrevious(project, requireClip(project, operation.clipId).id);
    case 'replace_subtitles':
      if (!Array.isArray(operation.cues)) throw new Error('cues must be an array');
      return importSubtitles(project, operation.cues.map(cue => ({ start: num(cue.start, 'cue.start'), end: num(cue.end, 'cue.end'), text: String(cue.text ?? '') })), { replace: true });
    case 'subtitle_style':
      if (!operation.style || typeof operation.style !== 'object') throw new Error('style is required');
      return setSubtitleStyle(project, operation.style, { clearOverrides: operation.clearOverrides });
    default:
      throw new Error(`unknown op ${(operation as { op?: string }).op}`);
  }
}

/** 顺序执行；第一步失败就停下并返回原工程（调用方不提交）。 */
export function applyCutOperations(project: CutProject, operations: readonly CutAgentOperation[]): CutOperationOutcome {
  if (!Array.isArray(operations) || !operations.length) return { ok: false, project, results: [], error: 'operations must be a non-empty array' };
  if (operations.length > 200) return { ok: false, project, results: [], error: 'at most 200 operations per call' };
  let draft = project;
  const results: CutOperationOutcome['results'] = [];
  for (const [index, operation] of operations.entries()) {
    try {
      const result = step(draft, operation);
      results.push({ op: operation?.op, ok: result.ok, ...(result.error ? { error: result.error } : {}), ...(result.clipId ? { clipId: result.clipId } : {}) });
      if (!result.ok) return { ok: false, project, results, error: `operation ${index} (${operation.op}) failed: ${result.error}` };
      draft = result.project;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ op: operation?.op, ok: false, error: message });
      return { ok: false, project, results, error: `operation ${index} (${operation?.op}) failed: ${message}` };
    }
  }
  return { ok: true, project: draft, results };
}

/** 两个版本之间的变化摘要（给 Agent 的回执，避免每次回传整条时间线）。 */
export function diffCutProjects(before: CutProject, after: CutProject) {
  const beforeClips = new Map(before.clips.map(clip => [clip.id, clip]));
  const afterClips = new Map(after.clips.map(clip => [clip.id, clip]));
  const added = after.clips.filter(clip => !beforeClips.has(clip.id)).map(clip => describeClip(after, clip));
  const removed = before.clips.filter(clip => !afterClips.has(clip.id)).map(clip => clip.id);
  const changed = after.clips.filter(clip => beforeClips.has(clip.id) && JSON.stringify(beforeClips.get(clip.id)) !== JSON.stringify(clip)).map(clip => describeClip(after, clip));
  const tracksAdded = after.tracks.filter(track => !before.tracks.some(item => item.id === track.id)).map(track => ({ id: track.id, kind: track.kind, name: track.name }));
  const tracksRemoved = before.tracks.filter(track => !after.tracks.some(item => item.id === track.id)).map(track => track.id);
  return {
    added, removed, changed,
    ...(tracksAdded.length ? { tracksAdded } : {}),
    ...(tracksRemoved.length ? { tracksRemoved } : {}),
    ...(JSON.stringify(before.subtitleStyle) !== JSON.stringify(after.subtitleStyle) ? { subtitleStyle: after.subtitleStyle } : {}),
    duration: r3(projectDuration(after)),
  };
}
