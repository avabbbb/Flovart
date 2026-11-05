import { describe, expect, it } from 'vitest';
import { parseTranscriptJson } from '../services/reverse/evidence';
import { planTarget, segmentsFromNarrative } from '../services/reverse/target';
import { parseReverseScript } from '../services/reverse/narrative';
import { planRun, readReference, tokenizeScript, wordsText } from '../services/reverse/video';
import type { ReverseShot, ReverseVideoProject } from '../services/reverse/types';

const lines = (...rows: string[]) => rows.join(String.fromCharCode(10));

describe('transcript import', () => {
  it('reads WhisperX segments and keeps missing timings missing', () => {
    const tr = parseTranscriptJson({ language: 'en', segments: [{ words: [{ word: ' hello', start: 0, end: 0.3, score: 0.9 }, { word: 'world' }] }] }, 'now');
    expect(tr).toEqual({ source: 'whisperx', language: 'en', importedAt: 'now', words: [{ text: 'hello', startMs: 0, endMs: 300, score: 0.9 }, { text: 'world' }] });
  });

  it('reads plain arrays in milliseconds and rejects empty input', () => {
    expect(parseTranscriptJson([{ text: 'hi', startMs: 10, endMs: 90 }], 'now')?.words).toEqual([{ text: 'hi', startMs: 10, endMs: 90 }]);
    expect(parseTranscriptJson([{ text: 'hi' }], 'now')?.source).toBe('manual');
    expect(parseTranscriptJson({ foo: 1 })).toBeNull();
  });
});

describe('target version', () => {
  it('tokenizes latin words that contain the letter s', () => {
    expect(tokenizeScript('miss is 你好').map((w) => w.text)).toEqual(['miss', 'is', '你', '好']);
  });

  it('derives text segments from narrative headers', () => {
    const { narrative } = parseReverseScript(lines('[hook] a b', '[cta] c'));
    const words = readReference(lines('[hook] a b', '[cta] c'), 3000).words;
    expect(segmentsFromNarrative(narrative, words)).toEqual([
      { id: 'hook', role: 'hook', text: 'a b', wordRange: [0, 1] },
      { id: 'cta', role: 'cta', text: 'c', wordRange: [2, 2] },
    ]);
  });

  const reference = readReference('one two @{r!}three four', 4000);
  const shots: ReverseShot[] = [
    { id: 's1', index: 1, startMs: 0, endMs: 2000, slotIds: [] },
    { id: 's2', index: 2, startMs: 2000, endMs: 4000, cue: { kind: 'moment', id: 'r' }, slotIds: [] },
  ];
  const analysis = { durationMs: 4000, shots, words: reference.words, segments: [], narrative: reference.narrative, analyzedAt: 'fixture', source: 'manual' as const };

  it('scales duration by wording length and keeps cuts on their cue', () => {
    const plan = planTarget({ analysis, targetScript: 'one two three four five six @{r!}seven eight' })!;
    expect(plan.durationMs).toBe(8000);
    expect(plan.windows[1]).toMatchObject({ anchored: true, startMs: plan.reading.alignment.timings[6]!.startMs, endMs: 8000 });
    expect(plan.dialogueFor(shots[1]!)).toBe('seven eight');
    expect(plan.dialogueFor(shots[0]!)).toBe('one two three four five six');
    expect(planTarget({ analysis })).toBeNull();
  });

  it('keeps punctuation and hyphens in dialogue text without changing tokens', () => {
    const r = readReference('Still waiting on your kettle? Try the one-tap brewer.', 3000);
    expect(r.words.map((w) => w.text)).toEqual(['Still', 'waiting', 'on', 'your', 'kettle', 'Try', 'the', 'one', 'tap', 'brewer']);
    expect(wordsText(r.words, [0, r.words.length - 1])).toBe('Still waiting on your kettle? Try the one-tap brewer.');
    expect(wordsText(readReference('你好，世界。', 1000).words, [0, 3])).toBe('你好，世界。');
  });

  it('snaps uncued dialogue breaks to the nearest sentence end', () => {
    const ref = readReference('a b c d e f g h i j k l', 6000);
    const three: ReverseShot[] = [
      { id: 'x1', index: 1, startMs: 0, endMs: 2000, slotIds: [] },
      { id: 'x2', index: 2, startMs: 2000, endMs: 4000, slotIds: [] },
      { id: 'x3', index: 3, startMs: 4000, endMs: 6000, slotIds: [] },
    ];
    const a = { durationMs: 6000, shots: three, words: ref.words, segments: [], narrative: ref.narrative, analyzedAt: 'fixture', source: 'manual' as const };
    const plan = planTarget({ analysis: a, targetScript: 'Still waiting on your kettle? Try the one-tap brewer. Grab one now.' })!;
    expect(three.map((shot) => plan.dialogueFor(shot))).toEqual(['Still waiting on your kettle?', 'Try the one-tap brewer.', 'Grab one now.']);
  });

  it('keys run steps on the target dialogue when one is supplied', () => {
    const project: Pick<ReverseVideoProject, 'analysis' | 'axes' | 'variants' | 'slots' | 'outputs'> = {
      analysis, axes: [], variants: [{ id: 'v:', picks: {}, enabled: true }], slots: [], outputs: [],
    };
    const a = planRun(project, () => 'x').steps.map((s) => s.key);
    const b = planRun(project, () => 'y').steps.map((s) => s.key);
    expect(a).not.toEqual(b);
  });
});
