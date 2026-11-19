import { describe, expect, it } from 'vitest';
import {
  addClip, addSource, addTrack, clipsAt, clipsOnTrack, createCutProject, cutStorageKey, deleteClip, deserializeCutProject, findClip,
  moveClip, projectDuration, removeTrack, reorderClip, serializeCutProject, setTrackMuted, splitAt, splitClip, trimClip, updateClip,
  type CutProject, type CutSource,
} from '../services/cut/timeline';

const video = (id: string, duration = 10, hasAudio = true): CutSource => ({ id, kind: 'video', name: `${id}.mp4`, duration, width: 1920, height: 1080, hasAudio, origin: { type: 'file', fileName: `${id}.mp4` } });
const audio = (id: string, duration = 20): CutSource => ({ id, kind: 'audio', name: `${id}.mp3`, duration, hasAudio: true, origin: { type: 'canvas', nodeId: id, storageKey: `k-${id}` } });
const image = (id: string): CutSource => ({ id, kind: 'image', name: `${id}.png`, duration: 0, width: 800, height: 600, origin: { type: 'file', fileName: `${id}.png` } });

function seeded() {
  let project = createCutProject();
  project = addSource(addSource(addSource(project, video('va')), video('vb', 6)), audio('music'));
  project = addSource(project, image('pic'));
  const a = addClip(project, { kind: 'video', sourceId: 'va' });
  const b = addClip(a.project, { kind: 'video', sourceId: 'vb' });
  return { project: b.project, a: a.clipId!, b: b.clipId! };
}

describe('cut timeline model', () => {
  it('starts with one video, audio, text and subtitle track', () => {
    const project = createCutProject();
    expect(project.tracks.map(track => track.kind)).toEqual(['video', 'audio', 'text', 'subtitle']);
    expect(projectDuration(project)).toBe(0);
  });

  it('appends clips back to back on the matching track', () => {
    const { project, a, b } = seeded();
    expect(findClip(project, a)).toMatchObject({ start: 0, duration: 10, trackId: 'v1' });
    expect(findClip(project, b)).toMatchObject({ start: 10, duration: 6, trackId: 'v1' });
    expect(projectDuration(project)).toBe(16);
  });

  it('routes audio, image and text clips to tracks that accept them', () => {
    let { project } = seeded();
    const music = addClip(project, { kind: 'audio', sourceId: 'music' });
    expect(findClip(music.project, music.clipId!)?.trackId).toBe('a1');
    const pic = addClip(music.project, { kind: 'image', sourceId: 'pic' });
    expect(findClip(pic.project, pic.clipId!)).toMatchObject({ trackId: 'v1', duration: 3, start: 16 });
    const text = addClip(pic.project, { kind: 'text', start: 2, text: 'Hello' });
    expect(findClip(text.project, text.clipId!)).toMatchObject({ trackId: 't1', start: 2, text: 'Hello' });
    project = text.project;
    expect(addClip(project, { kind: 'audio', sourceId: 'music', trackId: 'v1' }).ok).toBe(false);
  });

  it('creates a track when none accepts the clip', () => {
    let project = addSource(createCutProject(), audio('m'));
    project = removeTrack(project, 'a1').project;
    const result = addClip(project, { kind: 'audio', sourceId: 'm' });
    expect(result.ok).toBe(true);
    expect(result.project.tracks.filter(track => track.kind === 'audio')).toHaveLength(1);
  });

  it('rejects clips whose source is unknown', () => {
    expect(addClip(createCutProject(), { kind: 'video', sourceId: 'nope' }).ok).toBe(false);
  });

  it('trims the end within the source length and the next clip', () => {
    const { project, a } = seeded();
    expect(findClip(trimClip(project, a, 'end', 4).project, a)?.duration).toBe(4);
    // can't grow into clip b (starts at 10) nor past the 10s source
    expect(findClip(trimClip(project, a, 'end', 99).project, a)?.duration).toBe(10);
  });

  it('trims the start and moves the in point with it', () => {
    const { project, a } = seeded();
    const trimmed = trimClip(project, a, 'start', 3).project;
    expect(findClip(trimmed, a)).toMatchObject({ start: 3, in: 3, duration: 7 });
    // pulling back out restores the head but never before in=0
    expect(findClip(trimClip(trimmed, a, 'start', -5).project, a)).toMatchObject({ start: 0, in: 0, duration: 10 });
  });

  it('keeps a minimum length when trimming', () => {
    const { project, a } = seeded();
    expect(findClip(trimClip(project, a, 'end', 0).project, a)!.duration).toBeCloseTo(0.1);
  });

  it('splits a clip into two that continue the source', () => {
    const { project, a } = seeded();
    const result = splitClip(project, a, 4);
    expect(result.ok).toBe(true);
    expect(findClip(result.project, a)).toMatchObject({ start: 0, in: 0, duration: 4 });
    expect(findClip(result.project, result.clipId!)).toMatchObject({ start: 4, in: 4, duration: 6 });
    expect(splitClip(project, a, 0.01).ok).toBe(false);
  });

  it('splits everything under the playhead, optionally one track only', () => {
    let { project } = seeded();
    project = addClip(project, { kind: 'audio', sourceId: 'music' }).project;
    expect(splitAt(project, 5).project.clips).toHaveLength(5);
    expect(splitAt(project, 5, 'a1').project.clips).toHaveLength(4);
    expect(splitAt(project, 200).ok).toBe(false);
  });

  it('deletes clips, with optional ripple', () => {
    const { project, a, b } = seeded();
    expect(findClip(deleteClip(project, a).project, b)?.start).toBe(10);
    expect(findClip(deleteClip(project, a, { ripple: true }).project, b)?.start).toBe(0);
  });

  it('moves a clip in time and between compatible tracks without overlaps', () => {
    let { project, b } = seeded();
    project = addTrack(project, 'video').project;
    const v2 = project.tracks.filter(track => track.kind === 'video')[1];
    expect(project.tracks.indexOf(v2)).toBe(1); // stacked above V1, below audio/text
    const moved = moveClip(project, b, v2.id, 2);
    expect(findClip(moved.project, b)).toMatchObject({ trackId: v2.id, start: 2 });
    expect(moveClip(project, b, 'v1', 5).ok).toBe(false); // would overlap clip a
    expect(moveClip(project, b, 'a1', 30).ok).toBe(false); // wrong kind
  });

  it('reorders clips on a track and closes the gaps', () => {
    const { project, a, b } = seeded();
    const result = reorderClip(project, b, 0);
    expect(findClip(result.project, b)?.start).toBe(0);
    expect(findClip(result.project, a)?.start).toBe(6);
    expect(clipsOnTrack(result.project, 'v1').map(clip => clip.id)).toEqual([b, a]);
  });

  it('sets volume (clamped) and text style', () => {
    let { project, a } = seeded();
    expect(findClip(updateClip(project, a, { volume: 5 }).project, a)?.volume).toBe(2);
    const text = addClip(project, { kind: 'text', start: 0 });
    project = updateClip(text.project, text.clipId!, { text: 'Hi', textStyle: { color: '#ff0000' } }).project;
    expect(findClip(project, text.clipId!)).toMatchObject({ text: 'Hi', textStyle: { color: '#ff0000', size: 0.07 } });
  });

  it('lists active clips bottom-to-top at a time', () => {
    let { project, a } = seeded();
    const text = addClip(project, { kind: 'text', start: 1 });
    project = text.project;
    expect(clipsAt(project, 1.5).map(clip => clip.id)).toEqual([a, text.clipId]);
    expect(clipsAt(project, 10).map(clip => clip.kind)).toEqual(['video']);
  });

  it('mutes tracks', () => {
    expect(setTrackMuted(createCutProject(), 'a1', true).tracks.find(track => track.id === 'a1')?.muted).toBe(true);
  });
});

describe('cut timeline serialisation', () => {
  it('round-trips a project', () => {
    let { project } = seeded();
    project = addClip(project, { kind: 'text', start: 1, text: '标题' }).project;
    project = setTrackMuted(project, 'a1', true);
    const back = deserializeCutProject(serializeCutProject(project));
    expect(back).toEqual(project);
  });

  it('drops clips that reference missing tracks or sources and repairs fields', () => {
    const { project } = seeded();
    const broken = JSON.parse(serializeCutProject(project)) as CutProject & { clips: Array<Record<string, unknown>> };
    broken.clips.push({ id: 'x', trackId: 'ghost', kind: 'video', sourceId: 'va', start: 0, in: 0, duration: 1, volume: 1 });
    broken.clips.push({ id: 'y', trackId: 'v1', kind: 'video', sourceId: 'gone', start: 40, in: 0, duration: 1, volume: 1 });
    broken.clips.push({ id: 'z', trackId: 't1', kind: 'text', start: 0, duration: 2, volume: 'loud' });
    (broken as unknown as Record<string, unknown>).fps = 9999;
    const back = deserializeCutProject(broken)!;
    expect(back.clips.map(clip => clip.id)).not.toContain('x');
    expect(back.clips.map(clip => clip.id)).not.toContain('y');
    expect(back.clips.find(clip => clip.id === 'z')).toMatchObject({ volume: 1, in: 0, text: '' });
    expect(back.fps).toBe(30);
  });

  it('rejects garbage', () => {
    expect(deserializeCutProject('not json')).toBeNull();
    expect(deserializeCutProject('{"version":2}')).toBeNull();
    expect(deserializeCutProject(null)).toBeNull();
  });

  it('uses an iris-namespaced storage key per canvas project', () => {
    expect(cutStorageKey('p1')).toBe('iris.cut.timeline.v1:p1');
  });
});
