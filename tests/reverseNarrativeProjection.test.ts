import { describe, expect, it } from 'vitest';
import { parseReverseScript } from '../services/reverse/narrative';
import { localMsWindow, projectCue, projectNarrative, retimeShots } from '../services/reverse/projection';
import { createLocalDomain, createTimeline } from '../services/reverse/temporal';
import type { ReverseTokenTiming } from '../services/reverse/types';
import { retimeShots as videoRetimeShots } from '../services/reverse/video';

const { narrative } = parseReverseScript('[hook] one two @{a}three four@{/a} @{m!}five six');
// 每个 token 100ms，本地时钟。
const timings: ReverseTokenTiming[] = narrative.tokens.map((t, i) => ({ tokenId: t.id, startMs: i * 100, endMs: i * 100 + 100, measured: i !== 1 }));
const timeline = createTimeline('main', { num: 10, den: 1 }, 100);
const domain = createLocalDomain('ref', timeline, 10, 60);

describe('reverse narrative projection', () => {
  it('projects tokens to absolute frame windows through the domain offset', () => {
    const p = projectNarrative(timeline, domain, narrative, timings);
    expect(p.diagnostics).toEqual([]);
    expect(p.tokens).toHaveLength(6);
    expect(p.tokens[0]).toMatchObject({ index: 0, window: { timelineId: 'main', start: 10, end: 11 }, measured: true });
    expect(p.tokens[1]!.measured).toBe(false);
    expect(p.tokens[5]!.window).toEqual({ timelineId: 'main', start: 15, end: 16 });
  });

  it('projects segments, selections and moments', () => {
    const p = projectNarrative(timeline, domain, narrative, timings);
    expect(p.segments).toEqual([{ id: 'hook', window: { timelineId: 'main', start: 10, end: 16 } }]);
    expect(p.selections).toEqual([{ id: 'a', window: { timelineId: 'main', start: 12, end: 14 } }]);
    expect(p.moments).toEqual([{ id: 'm', instant: { timelineId: 'main', frame: 14 } }]);
    expect(projectCue(timeline, domain, narrative, timings, { kind: 'selection', id: 'missing' })).toBeNull();
  });

  it('does not extrapolate outside the local domain', () => {
    const short = createLocalDomain('short', timeline, 0, 3);
    const p = projectNarrative(timeline, short, narrative, timings);
    expect(p.tokens[2]!.window).toEqual({ timelineId: 'main', start: 2, end: 3 });
    expect(p.tokens[3]!.window).toBeNull();
    expect(p.selections[0]!.window).toBeNull();
    expect(p.diagnostics.map((d) => d.code)).toContain('outside-domain');
    expect(localMsWindow(timeline, short, 250, 250)).toEqual({ timelineId: 'main', start: 2, end: 3 });
    expect(localMsWindow(timeline, short, 300, 300)).toBeNull();
  });

  it('reports timing mismatch instead of guessing', () => {
    const p = projectNarrative(timeline, domain, narrative, timings.slice(0, 3));
    expect(p.diagnostics).toEqual([{ code: 'timing-mismatch', id: narrative.id }]);
    expect(p.tokens.every((t) => t.window === null)).toBe(true);
    expect(p.moments[0]!.instant).toBeNull();
  });

  it('keeps video.retimeShots as the same implementation', () => {
    expect(videoRetimeShots).toBe(retimeShots);
  });
});
