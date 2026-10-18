import { describe, expect, it } from 'vitest';
import { appendLassoPoint, buildLassoMaskDataUrl, toLassoPoint } from '../components/workflow/lasso';

const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;

describe('workflow lasso helpers', () => {
  it('maps client points through object-fit contain letterboxing into natural pixels', () => {
    expect(toLassoPoint(50, 50, rect, 200, 100, 'contain')).toEqual({ x: 100, y: 50 });
    expect(toLassoPoint(100, 75, rect, 200, 100, 'contain')).toEqual({ x: 200, y: 100 });
  });

  it('clamps points in the letterbox to the image bounds', () => {
    const point = toLassoPoint(0, 0, rect, 200, 100, 'contain');
    expect(point.x).toBe(0);
    expect(point.y).toBe(0);
    const far = toLassoPoint(500, 500, rect, 200, 100, 'contain');
    expect(far.x).toBe(200);
    expect(far.y).toBe(100);
  });

  it('does not append a duplicate point', () => {
    const start = [{ x: 10, y: 10 }];
    expect(appendLassoPoint(start, { x: 10, y: 10 })).toHaveLength(1);
    expect(appendLassoPoint(start, { x: 60, y: 60 })).toHaveLength(2);
  });

  it('returns no mask for a path with fewer than three points', () => {
    expect(buildLassoMaskDataUrl([{ x: 0, y: 0 }, { x: 10, y: 10 }], 100, 100)).toBeUndefined();
  });
});
