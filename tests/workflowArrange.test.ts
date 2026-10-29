import { describe, expect, it } from 'vitest';
import { alignNodes, distributeNodes, duplicateNodes, offsetNodes } from '../components/workflow/arrange';
import type { WorkflowNode as WorkflowNodeData } from '../components/workflow/types';

const node = (id: string, x: number, y: number, width = 100, height = 50, isLocked = false) =>
  ({ id, type: 'text', title: id, position: { x, y }, width, height, isLocked, metadata: {} }) as unknown as WorkflowNodeData;

const byId = (nodes: WorkflowNodeData[] | null) => new Map((nodes || []).map(item => [item.id, item.position]));

describe('workflow arrange helpers', () => {
  it('aligns right edges to the outermost node and never moves locked nodes', () => {
    const nodes = [node('a', 0, 0, 100), node('b', 50, 80, 200), node('c', 10, 160, 40, 50, true)];
    const result = byId(alignNodes(nodes, ['a', 'b', 'c'], 'right'));
    expect(result.get('a')).toEqual({ x: 150, y: 0 });
    expect(result.get('b')).toEqual({ x: 50, y: 80 });
    expect(result.get('c')).toEqual({ x: 10, y: 160 });
  });

  it('centers vertically on the average center', () => {
    const result = byId(alignNodes([node('a', 0, 0, 100, 100), node('b', 200, 100, 100, 20)], ['a', 'b'], 'vertical-center'));
    expect(result.get('a')!.y).toBe(30);
    expect(result.get('b')!.y).toBe(70);
  });

  it('needs two movable nodes to align', () => {
    expect(alignNodes([node('a', 0, 0), node('b', 9, 9, 100, 50, true)], ['a', 'b'], 'left')).toBeNull();
  });

  it('distributes equal gaps while the outermost nodes stay put, regardless of selection order', () => {
    const nodes = [node('c', 400, 0, 100), node('a', 0, 0, 100), node('b', 130, 0, 50)];
    const result = byId(distributeNodes(nodes, ['b', 'c', 'a'], 'horizontal'));
    expect(result.get('a')!.x).toBe(0);
    expect(result.get('b')!.x).toBe(225);
    expect(result.get('c')!.x).toBe(400);
  });

  it('needs three movable nodes to distribute', () => {
    expect(distributeNodes([node('a', 0, 0), node('b', 300, 0)], ['a', 'b'], 'horizontal')).toBeNull();
  });

  it('nudges only unlocked selected nodes', () => {
    const result = byId(offsetNodes([node('a', 0, 0), node('b', 0, 0, 100, 50, true), node('c', 5, 5)], ['a', 'b'], 10, -10));
    expect(result.get('a')).toEqual({ x: 10, y: -10 });
    expect(result.get('b')).toEqual({ x: 0, y: 0 });
    expect(result.get('c')).toEqual({ x: 5, y: 5 });
  });

  it('duplicates as fresh ungrouped nodes beside the originals', () => {
    const grouped = { ...node('a', 0, 0), batchId: 'batch', batchIndex: 0 } as WorkflowNodeData;
    const result = duplicateNodes([grouped, node('b', 0, 0, 100, 50, true)], ['a', 'b']);
    expect(result!.ids).toHaveLength(1);
    const copy = result!.nodes.find(item => item.id === result!.ids[0])!;
    expect(copy.id).not.toBe('a');
    expect(copy.position).toEqual({ x: 32, y: 32 });
    expect(copy.batchId).toBeUndefined();
    expect(copy.metadata).not.toBe(grouped.metadata);
  });
});
