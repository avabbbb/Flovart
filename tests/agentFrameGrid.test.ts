import { describe, expect, it } from 'vitest';
import {
  describeFrameGrid,
  formatTimecode,
  frameGridLabel,
  normalizeFrameTimes,
  planFrameGridLayout,
  planFrameGridTimes,
} from '../services/agentFrameGrid';

describe('agent frame grid', () => {
  it('formats timecodes with tenths and hours when needed', () => {
    expect(formatTimecode(0)).toBe('0:00.0');
    expect(formatTimecode(4.24)).toBe('0:04.2');
    expect(formatTimecode(59.96)).toBe('1:00.0');
    expect(formatTimecode(3725.5)).toBe('1:02:05.5');
    expect(formatTimecode(-3)).toBe('0:00.0');
    expect(formatTimecode(Number.NaN)).toBe('0:00.0');
    expect(frameGridLabel(2, 7.5)).toBe('#3 0:07.5');
  });

  it('samples slice midpoints over the whole short clip by default', () => {
    const plan = planFrameGridTimes({ duration: 9 });
    expect(plan.times).toEqual([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5]);
    expect(plan).toMatchObject({ page: 1, totalPages: 1, pageStart: 0, pageEnd: 9 });
  });

  it('clamps count and window, and pages long windows', () => {
    expect(planFrameGridTimes({ duration: 10, count: 99 }).times).toHaveLength(16);
    expect(planFrameGridTimes({ duration: 10, count: 0 }).times).toHaveLength(1);

    const windowed = planFrameGridTimes({ duration: 20, count: 4, start: 4, end: 12 });
    expect(windowed.times).toEqual([5, 7, 9, 11]);

    const first = planFrameGridTimes({ duration: 75, count: 3 });
    expect(first).toMatchObject({ page: 1, totalPages: 3, pageStart: 0, pageEnd: 30 });
    expect(first.times).toEqual([5, 15, 25]);
    const last = planFrameGridTimes({ duration: 75, count: 3, page: 9 });
    expect(last).toMatchObject({ page: 3, pageStart: 60, pageEnd: 75 });
    expect(last.times).toEqual([62.5, 67.5, 72.5]);
  });

  it('handles empty windows and zero duration', () => {
    expect(planFrameGridTimes({ duration: 0 }).times).toEqual([0]);
    expect(planFrameGridTimes({ duration: 10, start: 12 }).times).toEqual([9.99]);
  });

  it('normalizes explicit times: drops invalid, dedupes, sorts, clamps to duration', () => {
    expect(normalizeFrameTimes([13, -1, 4.2, Number.NaN, 4.2, 99], 20)).toEqual([4.2, 13, 19.99]);
    expect(normalizeFrameTimes(Array.from({ length: 30 }, (_, i) => i))).toHaveLength(16);
  });

  it('lays out wide frames in fewer columns so the grid stays near square and within max edge', () => {
    const layout = planFrameGridLayout({ count: 9, frameWidth: 1920, frameHeight: 1080 });
    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(5);
    expect(Math.max(layout.width, layout.height)).toBeLessThanOrEqual(1536);
    expect(layout.cells).toHaveLength(9);
    expect(layout.cells[1].x).toBe(layout.cellWidth + layout.gap);
    expect(layout.cells[2].y).toBe(layout.cellHeight + layout.gap);
    expect(layout.cellWidth / layout.cellHeight).toBeCloseTo(16 / 9, 1);
  });

  it('lays out portrait frames with more columns and never upscales', () => {
    const portrait = planFrameGridLayout({ count: 9, frameWidth: 720, frameHeight: 1280 });
    expect(portrait.cols).toBe(4);
    expect(portrait.rows).toBe(3);
    const tiny = planFrameGridLayout({ count: 1, frameWidth: 320, frameHeight: 180 });
    expect(tiny).toMatchObject({ cols: 1, rows: 1, width: 320, height: 180, gap: 0 });
  });

  it('describes the grid for the model, with paging hint', () => {
    const text = describeFrameGrid({ nodeId: 'v1', title: '镜头 1', duration: 75, times: [5, 15, 25], layout: { cols: 2, rows: 2 }, page: 1, totalPages: 3 });
    expect(text).toContain('v1：视频「镜头 1」');
    expect(text).toContain('0:05.0–0:25.0');
    expect(text).toContain('第 1/3 页，page=2 看下一页');
    expect(describeFrameGrid({ nodeId: 'v1', title: 'x', duration: 5, times: [1], layout: { cols: 1, rows: 1 } })).not.toContain('页');
  });
});
