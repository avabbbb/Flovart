import { describe, expect, it } from 'vitest';
import { arrangeNodePositions, arrangementOrder, sequencedFileNames } from '../components/workflow/arrange';
import type { WorkflowNode } from '../components/workflow/types';

const node = (id: string, x: number, y: number, extra: Partial<WorkflowNode> = {}) =>
  ({ id, type: 'image', position: { x, y }, width: 100, height: 80, metadata: {}, ...extra }) as unknown as WorkflowNode;

describe('group arrangement', () => {
  const nodes = [node('c', 300, 5), node('a', 0, 0), node('d', 10, 200), node('b', 150, 10)];

  it('orders members in reading order', () => {
    expect(arrangementOrder(nodes, ['a', 'b', 'c', 'd']).map(n => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lays out a row with the given gap from the top-left corner', () => {
    expect(arrangeNodePositions(nodes, ['a', 'b', 'c', 'd'], { layout: 'row', gap: 20 })).toEqual({
      b: { x: 120, y: 0 }, c: { x: 240, y: 0 }, d: { x: 360, y: 0 },
    });
  });

  it('lays out a column and a 2x2 grid', () => {
    const column = arrangeNodePositions(nodes, ['a', 'b', 'c', 'd'], { layout: 'column', gap: 10 })!;
    expect(column.d).toEqual({ x: 0, y: 270 });
    const grid = arrangeNodePositions(nodes, ['a', 'b', 'c', 'd'], { layout: 'grid', gap: 10 })!;
    expect(grid.b).toEqual({ x: 110, y: 0 });
    expect(grid.c).toEqual({ x: 0, y: 90 });
    expect(grid.d).toEqual({ x: 110, y: 90 });
  });

  it('keeps locked nodes in place and needs two movable members', () => {
    const withLock = [node('a', 0, 0), node('b', 500, 0, { isLocked: true } as Partial<WorkflowNode>), node('c', 900, 0)];
    const next = arrangeNodePositions(withLock, ['a', 'b', 'c'], { layout: 'row', gap: 0 })!;
    expect(next.b).toBeUndefined();
    expect(next.c).toEqual({ x: 100, y: 0 });
    expect(arrangeNodePositions(withLock, ['a', 'b'], { layout: 'row' })).toBeNull();
  });

  it('returns null when nothing would move', () => {
    expect(arrangeNodePositions([node('a', 0, 0), node('b', 124, 0)], ['a', 'b'], { layout: 'row' })).toBeNull();
  });

  it('names files with auto sequence numbers', () => {
    expect(sequencedFileNames('shot', 3)).toEqual(['shot_01', 'shot_02', 'shot_03']);
    expect(sequencedFileNames(' my/shot ', 1)).toEqual(['my_shot_01']);
    expect(sequencedFileNames('', 2)).toEqual(['flovart_01', 'flovart_02']);
    expect(sequencedFileNames('x', 120)[119]).toBe('x_120');
  });
});
