import { describe, expect, it } from 'vitest';
import {
  createLocalDomain,
  createTimeline,
  domainWindow,
  frameToMs,
  instantFromMs,
  intersectWindows,
  localFrameToInstant,
  localMsToInstant,
  msToFrame,
  timelineFromDurationMs,
  windowContains,
  windowFromMs,
  windowOf,
  windowToMs,
  windowsIntersect,
} from '../services/reverse/temporal';

const NTSC = { num: 30000, den: 1001 };

describe('reverse temporal', () => {
  it('validates timelines', () => {
    expect(() => createTimeline('t', { num: 30, den: 0 }, 10)).toThrow();
    expect(() => createTimeline('t', { num: 30, den: 1 }, 0)).toThrow();
    expect(createTimeline('t', NTSC, 10)).toEqual({ id: 't', frameRate: NTSC, frameCount: 10 });
  });

  it('converts ms and frames exactly at rational rates', () => {
    expect(msToFrame({ num: 30, den: 1 }, 1000)).toBe(30);
    expect(frameToMs(NTSC, 30000)).toBe(1001000);
    expect(msToFrame(NTSC, frameToMs(NTSC, 1), 'ceil')).toBe(1);
    expect(msToFrame(NTSC, frameToMs(NTSC, 1), 'floor')).toBe(1);
    expect(msToFrame({ num: 25, den: 1 }, 50, 'floor')).toBe(1);
    expect(msToFrame({ num: 25, den: 1 }, 41, 'ceil')).toBe(2);
  });

  it('builds a timeline covering the whole duration', () => {
    expect(timelineFromDurationMs('t', 1010).frameCount).toBe(31);
    expect(timelineFromDurationMs('t', 0).frameCount).toBe(1);
  });

  it('clamps instants and windows to the timeline', () => {
    const tl = createTimeline('t', { num: 10, den: 1 }, 20);
    expect(instantFromMs(tl, 5000).frame).toBe(20);
    expect(instantFromMs(tl, -100).frame).toBe(0);
    expect(windowOf(tl, -5, 3)).toEqual({ timelineId: 't', start: 0, end: 3 });
    expect(windowOf(tl, 25, 30)).toBeNull();
  });

  it('maps ms ranges to covering half-open windows', () => {
    const tl = createTimeline('t', { num: 10, den: 1 }, 20);
    expect(windowFromMs(tl, 150, 420)).toEqual({ timelineId: 't', start: 1, end: 5 });
    expect(windowFromMs(tl, 300, 300)).toEqual({ timelineId: 't', start: 3, end: 4 });
    expect(windowFromMs(tl, 500, 100)).toBeNull();
    expect(windowToMs(tl, { timelineId: 't', start: 1, end: 5 })).toEqual({ startMs: 100, endMs: 500 });
  });

  it('intersects and contains with half-open semantics', () => {
    const a = { timelineId: 't', start: 0, end: 10 };
    const b = { timelineId: 't', start: 10, end: 20 };
    const c = { timelineId: 't', start: 5, end: 15 };
    expect(windowsIntersect(a, b)).toBe(false);
    expect(intersectWindows(a, c)).toEqual({ timelineId: 't', start: 5, end: 10 });
    expect(intersectWindows(a, { ...c, timelineId: 'other' })).toBeNull();
    expect(windowContains(a, { timelineId: 't', frame: 0 })).toBe(true);
    expect(windowContains(a, { timelineId: 't', frame: 10 })).toBe(false);
    expect(windowContains(c, { timelineId: 't', start: 6, end: 15 })).toBe(true);
    expect(windowContains(c, a)).toBe(false);
  });

  it('places local domains on the timeline without extrapolating', () => {
    const tl = createTimeline('t', { num: 10, den: 1 }, 100);
    expect(() => createLocalDomain('d', tl, 90, 20)).toThrow();
    const d = createLocalDomain('d', tl, 30, 20);
    expect(domainWindow(d)).toEqual({ timelineId: 't', start: 30, end: 50 });
    expect(localFrameToInstant(d, 0)).toEqual({ timelineId: 't', frame: 30 });
    expect(localFrameToInstant(d, 20)).toEqual({ timelineId: 't', frame: 50 });
    expect(localFrameToInstant(d, 21)).toBeNull();
    expect(localMsToInstant(d, tl.frameRate, 1000)).toEqual({ timelineId: 't', frame: 40 });
  });
});
