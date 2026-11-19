import { describe, expect, it } from 'vitest';
import { cuesFromClips, formatCueTime, parseCueTime, parseSrt, parseSubtitleFile, parseVtt, toSrt, toVtt } from '../services/cut/subtitles';
import {
  addSubtitle, clipEnd, createCutProject, deserializeCutProject, effectiveTextStyle, findClip, importSubtitles, mergeSubtitleWithPrevious,
  serializeCutProject, setClipRange, setSubtitleStyle, splitSubtitleAtText, subtitleClips, updateClip,
} from '../services/cut/timeline';

const SRT = `1
00:00:01,000 --> 00:00:03,500
你好，世界

2
00:00:04,000 --> 00:00:06,000
<i>Second</i> line
two

bad block

3
00:00:07,000 --> 00:00:06,000
backwards
`;

describe('subtitle files', () => {
  it('parses SRT (ported OpenCut parser), stripping tags and skipping bad blocks', () => {
    const { cues, skipped } = parseSrt(SRT);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: '你好，世界' },
      { start: 4, end: 6, text: 'Second line\ntwo' },
    ]);
    expect(skipped).toBe(2);
  });

  it('parses WebVTT with headers, cue ids and short timestamps', () => {
    const { cues } = parseVtt('WEBVTT\n\nNOTE hi\n\nintro\n00:01.000 --> 00:02.250 align:center\nHello\n\n00:00:03.000 --> 00:00:04.000\nWorld');
    expect(cues).toEqual([{ start: 1, end: 2.25, text: 'Hello' }, { start: 3, end: 4, text: 'World' }]);
    expect(parseSubtitleFile('x.vtt', 'WEBVTT\n\n00:01.000 --> 00:02.000\nA').cues).toHaveLength(1);
    expect(() => parseSubtitleFile('x.ass', '')).toThrow(/Unsupported/);
  });

  it('round-trips SRT and VTT', () => {
    const cues = [{ start: 0.5, end: 2, text: 'A' }, { start: 3661.25, end: 3662, text: 'B\nC' }];
    expect(toSrt(cues)).toBe('1\n00:00:00,500 --> 00:00:02,000\nA\n\n2\n01:01:01,250 --> 01:01:02,000\nB\nC\n');
    expect(parseSrt(toSrt(cues)).cues).toEqual(cues);
    expect(parseVtt(toVtt(cues)).cues).toEqual(cues);
  });

  it('formats and parses list time codes', () => {
    expect(formatCueTime(65.5)).toBe('1:05.500');
    expect(parseCueTime('1:05.5')).toBe(65.5);
    expect(parseCueTime('12.25')).toBe(12.25);
    expect(parseCueTime('00:00:02,100')).toBeCloseTo(2.1);
    expect(parseCueTime('nope')).toBeNull();
  });
});

describe('subtitle track editing', () => {
  const base = () => importSubtitles(createCutProject(), [{ start: 0, end: 2, text: 'Hello world' }, { start: 2, end: 4, text: '第二句' }]).project;

  it('imports cues onto the dedicated subtitle track', () => {
    const project = base();
    const subs = subtitleClips(project);
    expect(subs.map(clip => [clip.trackId, clip.start, clipEnd(clip), clip.text])).toEqual([['s1', 0, 2, 'Hello world'], ['s1', 2, 4, '第二句']]);
    expect(cuesFromClips(project.clips)).toEqual([{ start: 0, end: 2, text: 'Hello world' }, { start: 2, end: 4, text: '第二句' }]);
  });

  it('pushes overlapping cues after the previous one and replaces on re-import', () => {
    const project = importSubtitles(createCutProject(), [{ start: 0, end: 2, text: 'a' }, { start: 1.5, end: 3, text: 'b' }]).project;
    expect(subtitleClips(project).map(clip => [clip.start, clipEnd(clip)])).toEqual([[0, 2], [2, 3]]);
    expect(subtitleClips(importSubtitles(project, [{ start: 5, end: 6, text: 'c' }], { replace: true }).project)).toHaveLength(1);
  });

  it('Enter splits a line at the cursor with time proportional to the text', () => {
    const project = base();
    const first = subtitleClips(project)[0];
    const result = splitSubtitleAtText(project, first.id, 6);
    expect(result.ok).toBe(true);
    const [a, b] = subtitleClips(result.project);
    expect([a.text, b.text]).toEqual(['Hello', 'world']);
    expect(a.duration).toBeCloseTo(2 * 6 / 11, 5);
    expect(clipEnd(b)).toBe(2);
  });

  it('Backspace at the start merges with the previous line', () => {
    const project = base();
    const second = subtitleClips(project)[1];
    const result = mergeSubtitleWithPrevious(project, second.id);
    const subs = subtitleClips(result.project);
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ start: 0, duration: 4, text: 'Hello world第二句' });
    expect(mergeSubtitleWithPrevious(project, subtitleClips(project)[0].id).ok).toBe(false);
  });

  it('edits time ranges without overlapping neighbours', () => {
    const project = base();
    const [first, second] = subtitleClips(project);
    expect(findClip(setClipRange(project, first.id, 0.5, 1.5).project, first.id)).toMatchObject({ start: 0.5, duration: 1 });
    expect(setClipRange(project, first.id, 0, 3).ok).toBe(false);
    expect(setClipRange(project, second.id, 3, 2).ok).toBe(false);
  });

  it('adds a subtitle and rejects overlaps', () => {
    const project = base();
    expect(addSubtitle(project, { start: 5, end: 6, text: 'x' }).ok).toBe(true);
    expect(addSubtitle(project, { start: 1, end: 3, text: 'x' }).ok).toBe(false);
  });

  it('batch-applies a style to every subtitle and can clear per-line overrides', () => {
    let project = base();
    const [first, second] = subtitleClips(project);
    project = updateClip(project, first.id, { textStyle: { color: '#ff0000' } }).project;
    project = setSubtitleStyle(project, { fontFamily: 'Noto Sans SC', size: 0.08, strokeColor: '#111111', strokeWidth: 0.2, y: 0.5, background: true }).project;
    expect(effectiveTextStyle(project, findClip(project, second.id)!)).toMatchObject({ fontFamily: 'Noto Sans SC', size: 0.08, strokeWidth: 0.2, y: 0.5, background: true });
    expect(effectiveTextStyle(project, findClip(project, first.id)!).color).toBe('#ff0000');
    project = setSubtitleStyle(project, { color: '#00ff00' }, { clearOverrides: true }).project;
    expect(effectiveTextStyle(project, findClip(project, first.id)!).color).toBe('#00ff00');
    // style values are clamped
    expect(setSubtitleStyle(project, { size: 9, y: -3 }).project.subtitleStyle).toMatchObject({ size: 0.4, y: 0 });
  });

  it('serialises subtitles and the shared style', () => {
    const project = setSubtitleStyle(base(), { fontFamily: 'LXGW WenKai TC' }).project;
    expect(deserializeCutProject(serializeCutProject(project))).toEqual(project);
  });
});
