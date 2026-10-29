import { describe, expect, it } from 'vitest';
import { computeOutpaintLayout } from '../services/outpaintCanvas';

describe('outpaint layout', () => {
  it('extends to the right by half the width', () => {
    expect(computeOutpaintLayout(1000, 800, 'right', 0.5)).toEqual({ width: 1500, height: 800, offsetX: 0, offsetY: 0, sourceWidth: 1000, sourceHeight: 800 });
  });
  it('keeps the source at the far edge when extending left or top', () => {
    expect(computeOutpaintLayout(1000, 800, 'left', 0.25)).toMatchObject({ width: 1250, offsetX: 250, offsetY: 0 });
    expect(computeOutpaintLayout(1000, 800, 'top', 1)).toMatchObject({ height: 1600, offsetX: 0, offsetY: 800 });
  });
  it('centers the source when extending all sides', () => {
    expect(computeOutpaintLayout(1000, 800, 'all', 0.5)).toMatchObject({ width: 1500, height: 1200, offsetX: 250, offsetY: 200 });
  });
  it('scales down to the max edge and keeps the aspect ratio', () => {
    const layout = computeOutpaintLayout(3000, 2000, 'right', 1, 4096);
    expect(layout.width).toBeLessThanOrEqual(4096);
    expect(layout.sourceWidth / layout.sourceHeight).toBeCloseTo(1.5, 2);
  });
});
