import { describe, expect, it } from 'vitest';
import { buildBooleanElement, canCombineShapes, findFrameChildren, layoutFrameChildren } from '../services/design/designActions';
import type { DesignElement } from '../services/design/designTypes';

const rect = (color: string): DesignElement => ({ kind: 'rect', fill: { type: 'solid', color } });

describe('design canvas actions', () => {
  it('unions two overlapping rects into one path node with the bottom style', () => {
    const result = buildBooleanElement('union', [
      { element: rect('#ff0000'), x: 0, y: 0, width: 100, height: 100 },
      { element: rect('#00ff00'), x: 50, y: 0, width: 100, height: 100 },
    ]);
    expect(result).not.toBeNull();
    expect(result?.box).toEqual({ x: 0, y: 0, width: 150, height: 100 });
    expect(result?.element.kind).toBe('path');
    expect(result?.element.fill).toEqual({ type: 'solid', color: '#ff0000' });
    expect(result?.element.path?.viewBox).toEqual({ x: 0, y: 0, width: 150, height: 100 });
  });

  it('rejects text and single shapes', () => {
    const text: DesignElement = { kind: 'text', fill: { type: 'none' } };
    expect(canCombineShapes([{ element: rect('#000'), x: 0, y: 0, width: 10, height: 10 }])).toBe(false);
    expect(buildBooleanElement('union', [
      { element: rect('#000'), x: 0, y: 0, width: 10, height: 10 },
      { element: text, x: 0, y: 0, width: 10, height: 10 },
    ])).toBeNull();
  });

  it('returns null when intersecting disjoint shapes', () => {
    expect(buildBooleanElement('intersect', [
      { element: rect('#000'), x: 0, y: 0, width: 10, height: 10 },
      { element: rect('#000'), x: 50, y: 50, width: 10, height: 10 },
    ])).toBeNull();
  });

  it('finds children by center point and orders them along the main axis', () => {
    const frame = { id: 'f', x: 0, y: 0, width: 200, height: 200 };
    const children = findFrameChildren(frame, [
      frame,
      { id: 'b', x: 10, y: 120, width: 20, height: 20 },
      { id: 'a', x: 10, y: 10, width: 20, height: 20 },
      { id: 'out', x: 300, y: 10, width: 20, height: 20 },
    ], 'vertical');
    expect(children.map(child => child.id)).toEqual(['a', 'b']);
  });

  it('lays out frame children in canvas coordinates and hugs content', () => {
    const frame: DesignElement = {
      kind: 'frame',
      fill: { type: 'solid', color: '#fff' },
      frame: { clip: true, childIds: [], autoLayout: { direction: 'vertical', gap: 10, padding: { top: 20, right: 20, bottom: 20, left: 20 }, align: 'start', justify: 'start', sizing: 'hug' } },
    };
    const update = layoutFrameChildren(frame, { x: 100, y: 100, width: 300, height: 300 }, [
      { id: 'a', width: 50, height: 40 },
      { id: 'b', width: 60, height: 30 },
    ]);
    expect(update?.frame).toEqual({ x: 100, y: 100, width: 100, height: 120 });
    expect(update?.children.a).toEqual({ x: 120, y: 120, width: 50, height: 40 });
    expect(update?.children.b).toEqual({ x: 120, y: 170, width: 60, height: 30 });
  });

  it('skips frames without auto layout', () => {
    expect(layoutFrameChildren(rect('#000'), { x: 0, y: 0, width: 10, height: 10 }, [{ id: 'a', width: 1, height: 1 }])).toBeNull();
  });
});
