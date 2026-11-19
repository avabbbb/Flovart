import { describe, expect, it } from 'vitest';
import {
  addClip, addSource, clipEnd, createCutProject, cutPoints, deleteSide, deserializeCutProject, duplicateClip, findClip, nextCutPoint,
  pasteClips, removeKeyframes, serializeCutProject, setKeyframe, sourceTimeAt, splitClip, transformAt, trimClip, updateClip, type CutSource,
} from '../services/cut/timeline';
import { audioSegments } from '../services/cut/render';
import { actionForEvent, formatShortcut, shortcutFromEvent } from '../services/cut/shortcuts';
import { resolveSnap } from '../services/cut/snapping';

const video = (id: string, duration = 10): CutSource => ({ id, kind: 'video', name: id, duration, hasAudio: true, origin: { type: 'file', fileName: id } });

function twoClips() {
  let project = addSource(addSource(createCutProject(), video('a')), video('b', 6));
  const a = addClip(project, { kind: 'video', sourceId: 'a' });
  const b = addClip(a.project, { kind: 'video', sourceId: 'b' });
  project = b.project;
  return { project, a: a.clipId!, b: b.clipId! };
}

describe('speed', () => {
  it('shrinks the timeline length and maps source time through the speed', () => {
    const { project, b } = twoClips();
    const fast = updateClip(project, b, { speed: 2 }).project;
    const clip = findClip(fast, b)!;
    expect(clip.duration).toBe(3);
    expect(sourceTimeAt(clip, 11)).toBe(2);
    expect(audioSegments(fast, 10, 12).find(segment => segment.clip.id === b)).toMatchObject({ speed: 2, sourceStart: 0, sourceEnd: 4 });
    // slowing down cannot run into the next clip
    const { project: p2, a } = twoClips();
    expect(findClip(updateClip(p2, a, { speed: 0.5 }).project, a)!.duration).toBe(10);
    expect(updateClip(p2, a, { speed: Number.NaN }).ok).toBe(false);
  });

  it('keeps split and trim consistent with speed', () => {
    const { project, b } = twoClips();
    const fast = updateClip(project, b, { speed: 2 }).project;
    const split = splitClip(fast, b, 11);
    expect(findClip(split.project, split.clipId!)).toMatchObject({ start: 11, in: 2, duration: 2, speed: 2 });
    expect(findClip(trimClip(fast, b, 'end', 99).project, b)!.duration).toBe(3);
  });

  it('round-trips speed, transform and keyframes', () => {
    const { project, a } = twoClips();
    let next = updateClip(project, a, { speed: 1.5, transform: { scale: 1.2, opacity: 0.5 } }).project;
    next = setKeyframe(next, a, { property: 'opacity', time: 1, value: 0 }).project;
    expect(deserializeCutProject(serializeCutProject(next))).toEqual(next);
  });
});

describe('keyframes', () => {
  it('interpolates linearly and holds outside the range', () => {
    const { project, a } = twoClips();
    let next = setKeyframe(project, a, { property: 'scale', time: 0, value: 1 }).project;
    next = setKeyframe(next, a, { property: 'scale', time: 2, value: 2 }).project;
    const clip = findClip(next, a)!;
    expect(transformAt(clip, 1).scale).toBeCloseTo(1.5);
    expect(transformAt(clip, 5).scale).toBe(2);
    expect(transformAt(clip, 1).opacity).toBe(1);
    expect(setKeyframe(next, a, { property: 'scale', time: 99, value: 1 }).ok).toBe(false);
    expect(setKeyframe(next, a, { property: 'rotation' as never, time: 1, value: 1 }).ok).toBe(false);
    expect(findClip(removeKeyframes(next, a, { property: 'scale' }).project, a)!.keyframes).toBeUndefined();
  });

  it('splits keyframes with the clip', () => {
    const { project, a } = twoClips();
    let next = setKeyframe(project, a, { property: 'x', time: 1, value: 0.1 }).project;
    next = setKeyframe(next, a, { property: 'x', time: 6, value: 0.3 }).project;
    const split = splitClip(next, a, 4);
    expect(findClip(split.project, a)!.keyframes).toEqual([{ property: 'x', time: 1, value: 0.1 }]);
    expect(findClip(split.project, split.clipId!)!.keyframes).toEqual([{ property: 'x', time: 2, value: 0.3 }]);
  });
});

describe('CapCut-style editing', () => {
  it('Q deletes left of the playhead and closes the gap', () => {
    const { project, a, b } = twoClips();
    const result = deleteSide(project, 4, 'left', [a]);
    expect(findClip(result.project, a)).toMatchObject({ start: 0, in: 4, duration: 6 });
    expect(findClip(result.project, b)!.start).toBe(6);
  });

  it('W deletes right of the playhead and closes the gap', () => {
    const { project, a, b } = twoClips();
    const result = deleteSide(project, 4, 'right');
    expect(findClip(result.project, a)).toMatchObject({ start: 0, in: 0, duration: 4 });
    expect(findClip(result.project, b)!.start).toBe(4);
    expect(deleteSide(project, 99, 'right').ok).toBe(false);
  });

  it('duplicates into the next free slot and pastes at a time', () => {
    const { project, a, b } = twoClips();
    const dup = duplicateClip(project, a);
    expect(findClip(dup.project, dup.clipId!)).toMatchObject({ start: 16, duration: 10, sourceId: 'a' });
    const pasted = pasteClips(project, [findClip(project, b)!], 2);
    expect(findClip(pasted.project, pasted.clipId!)!.start).toBe(16);
    expect(pasteClips(project, [], 0).ok).toBe(false);
  });

  it('lists cut points for ↑ / ↓', () => {
    const { project } = twoClips();
    expect(cutPoints(project)).toEqual([0, 10, 16]);
    expect(nextCutPoint(project, 3, 1)).toBe(10);
    expect(nextCutPoint(project, 10, -1)).toBe(0);
    expect(nextCutPoint(project, 16, 1)).toBe(16);
  });

  it('snaps within the threshold to the closest point', () => {
    expect(resolveSnap(4.97, [{ time: 5, type: 'playhead' }, { time: 4.9, type: 'element-end' }], 0.1).time).toBe(5);
    expect(resolveSnap(3, [{ time: 5, type: 'playhead' }], 0.1)).toMatchObject({ time: 3, point: null });
  });
});

describe('CapCut default shortcuts', () => {
  const key = (k: string, code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({ key: k, code, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
  it.each([
    [key(' ', 'Space'), 'toggle-play'],
    [key('b', 'KeyB', { ctrlKey: true }), 'split'],
    [key('b', 'KeyB', { metaKey: true }), 'split'],
    [key('q', 'KeyQ'), 'delete-left'],
    [key('w', 'KeyW'), 'delete-right'],
    [key('Delete', 'Delete'), 'delete-selected'],
    [key('Backspace', 'Backspace'), 'delete-selected'],
    [key('z', 'KeyZ', { ctrlKey: true }), 'undo'],
    [key('Z', 'KeyZ', { ctrlKey: true, shiftKey: true }), 'redo'],
    [key('c', 'KeyC', { ctrlKey: true }), 'copy'],
    [key('v', 'KeyV', { ctrlKey: true }), 'paste'],
    [key('d', 'KeyD', { ctrlKey: true }), 'duplicate'],
    [key('ArrowLeft', 'ArrowLeft'), 'frame-back'],
    [key('ArrowRight', 'ArrowRight'), 'frame-forward'],
    [key('ArrowUp', 'ArrowUp'), 'prev-cut'],
    [key('ArrowDown', 'ArrowDown'), 'next-cut'],
    [key('=', 'Equal', { ctrlKey: true }), 'zoom-in'],
    [key('+', 'NumpadAdd', { ctrlKey: true }), 'zoom-in'],
    [key('-', 'Minus', { ctrlKey: true }), 'zoom-out'],
    [key('n', 'KeyN'), 'toggle-snapping'],
    [key('?', 'Slash', { shiftKey: true }), 'show-shortcuts'],
    [key('ㅂ', 'KeyQ'), 'delete-left'],
  ])('%o → %s', (event, action) => {
    expect(actionForEvent(event)).toBe(action);
  });

  it('formats for mac and windows', () => {
    expect(formatShortcut('mod+shift+z', true)).toBe('⌘⇧Z');
    expect(formatShortcut('mod+b', false)).toBe('Ctrl+B');
    expect(shortcutFromEvent(key('b', 'KeyB', { ctrlKey: true, altKey: true }))).toBe('mod+alt+b');
  });
});

describe('clip helpers', () => {
  it('clipEnd', () => expect(clipEnd({ start: 1, duration: 2 })).toBe(3));
});
