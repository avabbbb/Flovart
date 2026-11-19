// 编辑动作：快捷键、工具栏与 Agent 工具共用（都经 cutStore.commit → 可撤销）。
import { cutStore, getCutProject } from './cutStore';
import {
  clipsAt, deleteClips, deleteSide, duplicateClip, findClip, nextCutPoint, pasteClips, projectDuration, splitAt,
  type CutOpResult,
} from './timeline';
import type { CutAction } from './shortcuts';

export interface CutActionContext {
  /** 播放器存在时用它（播放中 seek 要同步时钟）；否则只改 store 的播放头。 */
  seek?: (t: number) => void;
  togglePlay?: () => void;
  zoom?: (direction: 1 | -1) => void;
  showShortcuts?: () => void;
  notify?: (message: string) => void;
}

const state = () => cutStore.getState();

function seekTo(t: number, context: CutActionContext) {
  if (context.seek) context.seek(t);
  else state().setPlayhead(t);
}

/** 选中的片段；没选时用播放头下的片段（剪映行为）。 */
function targetIds(underPlayhead = true) {
  const { selection, playhead } = state();
  if (selection.length) return selection;
  return underPlayhead ? clipsAt(getCutProject(), playhead).map(clip => clip.id) : [];
}

export function cutSplit(source: 'ui' | 'agent' = 'ui'): CutOpResult {
  const { playhead, selection } = state();
  return state().commit(splitAt(getCutProject(), playhead, undefined, selection.length ? selection : undefined), 'split', source);
}

export function cutDeleteSide(side: 'left' | 'right', source: 'ui' | 'agent' = 'ui'): CutOpResult {
  const { playhead } = state();
  const result = state().commit(deleteSide(getCutProject(), playhead, side, targetIds()), side === 'left' ? 'delete left' : 'delete right', source);
  if (result.ok && side === 'left') {
    // 左侧删掉后，原来播放头处的画面落在片段起点。
    const first = targetIds().map(id => findClip(getCutProject(), id)).filter(Boolean)[0];
    if (first) state().setPlayhead(first.start);
  }
  return result;
}

export function cutDeleteSelected(source: 'ui' | 'agent' = 'ui'): CutOpResult {
  const ids = state().selection;
  const result = state().commit(deleteClips(getCutProject(), ids), 'delete', source);
  if (result.ok) state().select([]);
  return result;
}

export function cutPaste(source: 'ui' | 'agent' = 'ui'): CutOpResult {
  const { clipboard, playhead } = state();
  return state().commit(pasteClips(getCutProject(), clipboard, playhead), 'paste', source);
}

export function cutDuplicate(source: 'ui' | 'agent' = 'ui'): CutOpResult {
  const ids = state().selection;
  let project = getCutProject();
  const created: string[] = [];
  for (const id of ids) {
    const result = duplicateClip(project, id);
    if (result.ok) { project = result.project; if (result.clipId) created.push(result.clipId); }
  }
  if (!created.length) return { project, ok: false, error: 'select a clip first' };
  state().apply(project, 'duplicate', source);
  state().select(created);
  return { project, ok: true, clipId: created[created.length - 1] };
}

export function runCutAction(action: CutAction, context: CutActionContext = {}): boolean {
  const project = getCutProject();
  const { playhead } = state();
  const frame = 1 / project.fps;
  switch (action) {
    case 'toggle-play': context.togglePlay?.(); return true;
    case 'split': return report(cutSplit(), context);
    case 'delete-left': return report(cutDeleteSide('left'), context);
    case 'delete-right': return report(cutDeleteSide('right'), context);
    case 'delete-selected': return state().selection.length ? report(cutDeleteSelected(), context) : false;
    case 'undo': state().undo(); return true;
    case 'redo': state().redo(); return true;
    case 'copy': { const count = state().copy(); if (!count) context.notify?.('select a clip to copy'); return true; }
    case 'paste': return report(cutPaste(), context);
    case 'duplicate': return report(cutDuplicate(), context);
    case 'frame-back': seekTo(Math.max(0, Math.round(playhead / frame - 1) * frame), context); return true;
    case 'frame-forward': seekTo(Math.min(projectDuration(project), Math.round(playhead / frame + 1) * frame), context); return true;
    case 'prev-cut': seekTo(nextCutPoint(project, playhead, -1), context); return true;
    case 'next-cut': seekTo(nextCutPoint(project, playhead, 1), context); return true;
    case 'zoom-in': context.zoom?.(1); return true;
    case 'zoom-out': context.zoom?.(-1); return true;
    case 'toggle-snapping': state().toggleSnapping(); return true;
    case 'select-all': state().select(project.clips.map(clip => clip.id)); return true;
    case 'deselect': state().select([]); return true;
    case 'show-shortcuts': context.showShortcuts?.(); return true;
    default: return false;
  }
}

function report(result: CutOpResult, context: CutActionContext) {
  if (!result.ok && result.error) context.notify?.(result.error);
  return true;
}
