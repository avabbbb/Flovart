import { describe, expect, it } from 'vitest';
import { booleanShapes, shapeToMultiPolygon } from '../services/design/booleanOps';
import type { DesignElement } from '../services/design/designTypes';

const rect: DesignElement = { kind: 'rect', fill: { type: 'solid', color: '#000' } };

function area(d: string): number {
  // 鞋带公式；子路径按方向带符号累加，洞会被抵消
  let total = 0;
  for (const sub of d.split('M').filter(Boolean)) {
    const points = sub.replace(/Z/g, '').split('L').map(pair => pair.trim().split(/\s+/).map(Number));
    for (let i = 0; i < points.length; i += 1) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      total += x1 * y2 - x2 * y1;
    }
  }
  return Math.abs(total / 2);
}

describe('design boolean operations', () => {
  const a = { element: rect, x: 0, y: 0, width: 10, height: 10 };
  const b = { element: rect, x: 5, y: 0, width: 10, height: 10 };

  it('unions overlapping rectangles', () => {
    const result = booleanShapes('union', [a, b]);
    expect(result).toMatchObject({ x: 0, y: 0, width: 15, height: 10 });
    expect(area(result!.d)).toBeCloseTo(150, 6);
  });

  it('intersects and subtracts', () => {
    expect(booleanShapes('intersect', [a, b])).toMatchObject({ x: 5, width: 5 });
    const diff = booleanShapes('subtract', [a, b]);
    expect(diff).toMatchObject({ x: 0, width: 5 });
    expect(area(diff!.d)).toBeCloseTo(50, 6);
  });

  it('excludes overlap', () => {
    const xor = booleanShapes('exclude', [a, b]);
    expect(xor).toMatchObject({ x: 0, width: 15 });
  });

  it('returns null for empty results or fewer than two shapes', () => {
    expect(booleanShapes('intersect', [a, { ...b, x: 50 }])).toBeNull();
    expect(booleanShapes('union', [a])).toBeNull();
  });

  it('scales path elements from their viewBox into canvas space', () => {
    const triangle: DesignElement = { kind: 'path', fill: { type: 'none' }, path: { d: 'M0 0 L2 0 L0 2 Z', viewBox: { x: 0, y: 0, width: 2, height: 2 }, closed: true } };
    const geometry = shapeToMultiPolygon({ element: triangle, x: 100, y: 100, width: 20, height: 20 });
    expect(geometry?.[0][0]).toContainEqual([120, 100]);
    expect(shapeToMultiPolygon({ element: { kind: 'text', fill: { type: 'none' } }, x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});
