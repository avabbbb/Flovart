import { describe, expect, it } from 'vitest';
import { clampMoveOffset, polygonBounds } from '../services/moveObjectCanvas';

const square = [{ x: 0.2, y: 0.3 }, { x: 0.4, y: 0.3 }, { x: 0.4, y: 0.6 }, { x: 0.2, y: 0.6 }];

describe('moveObjectCanvas', () => {
  it('计算选区包围盒', () => {
    expect(polygonBounds(square)).toEqual({ minX: 0.2, minY: 0.3, maxX: 0.4, maxY: 0.6 });
  });

  it('位移在画面内时保持不变', () => {
    expect(clampMoveOffset(square, 0.3, -0.1)).toEqual({ dx: 0.3, dy: -0.1 });
  });

  it('位移越界时贴边截断', () => {
    const { dx, dy } = clampMoveOffset(square, 0.9, -0.9);
    expect(dx).toBeCloseTo(0.6);
    expect(dy).toBeCloseTo(-0.3);
  });
});
