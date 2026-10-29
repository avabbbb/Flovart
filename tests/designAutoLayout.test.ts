import { describe, expect, it } from 'vitest';
import { computeAutoLayout } from '../services/design/autoLayout';
import type { DesignAutoLayout } from '../services/design/designTypes';

const base: DesignAutoLayout = {
  direction: 'horizontal',
  gap: 10,
  padding: { top: 5, right: 5, bottom: 5, left: 5 },
  align: 'start',
  justify: 'start',
  sizing: 'hug',
};
const children = [{ id: 'a', width: 20, height: 10 }, { id: 'b', width: 30, height: 40 }];

describe('computeAutoLayout', () => {
  it('hugs content in a horizontal row', () => {
    const result = computeAutoLayout(base, children, { width: 999, height: 999 });
    expect(result.width).toBe(5 + 20 + 10 + 30 + 5);
    expect(result.height).toBe(5 + 40 + 5);
    expect(result.boxes.a).toEqual({ x: 5, y: 5, width: 20, height: 10 });
    expect(result.boxes.b).toEqual({ x: 35, y: 5, width: 30, height: 40 });
  });

  it('stacks vertically with centered cross axis', () => {
    const result = computeAutoLayout({ ...base, direction: 'vertical', align: 'center' }, children, { width: 0, height: 0 });
    expect(result).toMatchObject({ width: 40, height: 5 + 10 + 10 + 40 + 5 });
    expect(result.boxes.a).toEqual({ x: 10, y: 5, width: 20, height: 10 });
    expect(result.boxes.b).toEqual({ x: 5, y: 25, width: 30, height: 40 });
  });

  it('distributes with space-between inside a fixed frame', () => {
    const result = computeAutoLayout({ ...base, sizing: 'fixed', justify: 'space-between' }, children, { width: 200, height: 100 });
    expect(result.width).toBe(200);
    expect(result.boxes.a.x).toBe(5);
    expect(result.boxes.b.x + result.boxes.b.width).toBe(195);
  });

  it('centers and end-aligns along the main axis and stretches across', () => {
    const centered = computeAutoLayout({ ...base, sizing: 'fixed', justify: 'center', align: 'stretch' }, children, { width: 200, height: 100 });
    expect(centered.boxes.a.x).toBe(5 + (190 - 60) / 2);
    expect(centered.boxes.a.height).toBe(90);
    const end = computeAutoLayout({ ...base, sizing: 'fixed', justify: 'end', align: 'end' }, children, { width: 200, height: 100 });
    expect(end.boxes.b.x + 30).toBe(195);
    expect(end.boxes.a.y + 10).toBe(95);
  });

  it('handles empty frames', () => {
    expect(computeAutoLayout(base, [], { width: 0, height: 0 })).toEqual({ width: 10, height: 10, boxes: {} });
  });
});
