import { describe, expect, it } from 'vitest';
import { alignNarrativeToTranscript } from '../services/reverse/align';
import { cueText, cueTimeRange, parseReverseScript } from '../services/reverse/narrative';
import { planRun, readReference, retimeShots } from '../services/reverse/video';
import type { ReverseShot, ReverseVideoProject } from '../services/reverse/types';

const words = (list: Array<[string, number, number]>) => list.map(([text, startMs, endMs]) => ({ text, startMs, endMs }));

describe('reverse narrative', () => {
  it('parses segments, roles, speakers, selections and moments without seconds', () => {
    const { narrative, diagnostics } = parseReverseScript('[hook]\n<HOST> @{claim}I use it,@{/claim} every day. @{payoff!}Really!\n[cta] 买它');
    expect(diagnostics).toEqual([]);
    expect(narrative.tokens.map((t) => t.text)).toEqual(['I', 'use', 'it', 'every', 'day', 'Really', '买', '它']);
    expect(narrative.tokens[0]).toMatchObject({ speaker: 'HOST', segmentId: 'hook' });
    expect(narrative.tokens[6]).not.toHaveProperty('speaker');
    expect(narrative.segments).toEqual([
      { id: 'hook', role: 'hook', tokenStart: 0, tokenEnd: 6 },
      { id: 'cta', role: 'cta', tokenStart: 6, tokenEnd: 8 },
    ]);
    expect(narrative.selections).toEqual([{ id: 'claim', startToken: 0, endToken: 3 }]);
    expect(narrative.moments).toEqual([{ id: 'payoff', atToken: 5 }]);
    expect(cueText(narrative, { kind: 'segment', id: 'cta' })).toBe('买它');
  });

  it('reports unclosed, unopened and duplicate markers', () => {
    const { diagnostics } = parseReverseScript('@{a} one @{/b} two @{c!} @{c!}');
    expect(diagnostics.map((d) => d.message)).toHaveLength(3);
  });

  it('keeps measured timings for an exact transcript', () => {
    const { narrative } = parseReverseScript('hello world');
    const { timings, exactRatio } = alignNarrativeToTranscript(narrative.tokens, words([['Hello', 0, 300], ['world.', 400, 800]]));
    expect(exactRatio).toBe(1);
    expect(timings.map((t) => [t.startMs, t.endMs, t.measured])).toEqual([[0, 300, true], [400, 800, true]]);
  });

  it('skips filler insertions and times misrecognized words from their evidence', () => {
    const { narrative } = parseReverseScript('we ship today');
    const { timings, groups } = alignNarrativeToTranscript(narrative.tokens, words([['um', 0, 200], ['we', 200, 400], ['shipp', 400, 700], ['today', 700, 1000]]));
    expect(groups[0]!.relation).toBe('insertion');
    expect(timings.map((t) => [t.startMs, t.endMs, t.measured])).toEqual([[200, 400, true], [400, 700, true], [700, 1000, true]]);
  });

  it('interpolates omitted tokens between measured neighbours instead of inventing points', () => {
    const { narrative } = parseReverseScript('alpha beta gamma');
    const { timings } = alignNarrativeToTranscript(narrative.tokens, words([['alpha', 0, 100], ['gamma', 500, 600]]));
    expect(timings[1]).toMatchObject({ startMs: 100, endMs: 500, measured: false });
  });

  it('splits CJK evidence into the script characters it covers', () => {
    const { narrative } = parseReverseScript('你好世界');
    const { timings } = alignNarrativeToTranscript(narrative.tokens, words([['你好', 0, 400], ['世界', 400, 800]]));
    expect(timings.map((t) => [t.startMs, t.endMs])).toEqual([[0, 200], [200, 400], [400, 600], [600, 800]]);
  });

  it('spreads unmeasured scripts over the duration and projects cues to time', () => {
    const reading = readReference('[hook] @{q}why now@{/q} @{a!}because', 3000);
    expect(reading.alignment.timings.every((t) => !t.measured)).toBe(true);
    expect(reading.words.at(-1)?.endMs).toBe(3000);
    expect(cueTimeRange(reading.narrative, reading.alignment.timings, { kind: 'moment', id: 'a' })?.startMs)
      .toBe(reading.alignment.timings[2]!.startMs);
  });
});

describe('reverse retiming and run reuse', () => {
  const shots: ReverseShot[] = [
    { id: 's1', index: 1, startMs: 0, endMs: 1000, slotIds: [] },
    { id: 's2', index: 2, startMs: 1000, endMs: 2500, cue: { kind: 'moment', id: 'reveal' }, slotIds: ['slot-p'] },
  ];

  it('moves a cut with its cue when the target wording changes length', () => {
    const target = parseReverseScript('a much longer setup line here @{reveal!}now').narrative;
    const timed = alignNarrativeToTranscript(target.tokens, [], { durationMs: 6000 }).timings;
    const windows = retimeShots(shots, target, timed);
    expect(windows[0]).toMatchObject({ startMs: 0, anchored: false });
    expect(windows[1]!.anchored).toBe(true);
    expect(windows[1]!.startMs).toBe(timed[6]!.startMs);
    expect(windows[0]!.endMs).toBe(windows[1]!.startMs);
    expect(windows[1]!.endMs).toBe(6000);
  });

  it('reuses outputs only while their inputs are unchanged', () => {
    const project: Pick<ReverseVideoProject, 'analysis' | 'axes' | 'variants' | 'slots' | 'outputs'> = {
      analysis: { durationMs: 2500, shots, words: [], segments: [], analyzedAt: 'fixture', source: 'manual' },
      axes: [],
      variants: [{ id: 'v:', picks: {}, enabled: true }],
      slots: [{ id: 'slot-p', kind: 'product', label: 'Product', replacement: 'red bottle' }],
      outputs: [],
    };
    const first = planRun(project);
    expect(first).toMatchObject({ reused: 0, toGenerate: 2 });
    const outputs = first.steps.map((s) => ({ id: 'o-' + s.shotId, ownerKind: 'shot' as const, ownerId: s.shotId, key: s.key, origin: 'generated' as const, createdAt: 'fixture' }));
    expect(planRun({ ...project, outputs })).toMatchObject({ reused: 2, toGenerate: 0 });
    const changed = planRun({ ...project, outputs, slots: [{ ...project.slots[0]!, replacement: 'blue bottle' }] });
    expect(changed).toMatchObject({ reused: 1, toGenerate: 1 });
    expect(changed.steps.find((s) => !s.reuse)?.shotId).toBe('s2');
  });
});
