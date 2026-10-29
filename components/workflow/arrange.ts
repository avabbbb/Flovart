import { nanoid } from 'nanoid';
import type { WorkflowNode as WorkflowNodeData } from './types';

/** Pure, table-driven layout helpers for the canvas. Locked nodes never move. */

export type WorkflowAlignment = 'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom';
export type WorkflowDistributeAxis = 'horizontal' | 'vertical';

type Axis = { pos: 'x' | 'y'; size: 'width' | 'height' };

const AXES: Record<WorkflowDistributeAxis, Axis> = {
  horizontal: { pos: 'x', size: 'width' },
  vertical: { pos: 'y', size: 'height' },
};

/** anchor: 0 = start edge, 0.5 = center, 1 = end edge. */
const ALIGNMENTS: Record<WorkflowAlignment, { axis: Axis; anchor: 0 | 0.5 | 1 }> = {
  left: { axis: AXES.horizontal, anchor: 0 },
  'horizontal-center': { axis: AXES.horizontal, anchor: 0.5 },
  right: { axis: AXES.horizontal, anchor: 1 },
  top: { axis: AXES.vertical, anchor: 0 },
  'vertical-center': { axis: AXES.vertical, anchor: 0.5 },
  bottom: { axis: AXES.vertical, anchor: 1 },
};

function movable(nodes: WorkflowNodeData[], ids: readonly string[]) {
  const wanted = new Set(ids);
  return nodes.filter(node => wanted.has(node.id) && !node.isLocked);
}

function applyPositions(nodes: WorkflowNodeData[], next: Map<string, { x: number; y: number }>) {
  return nodes.map(node => {
    const position = next.get(node.id);
    return position && (position.x !== node.position.x || position.y !== node.position.y) ? { ...node, position } : node;
  });
}

/** Returns the new node list, or null when fewer than two movable nodes are selected. */
export function alignNodes(nodes: WorkflowNodeData[], ids: readonly string[], alignment: WorkflowAlignment): WorkflowNodeData[] | null {
  const targets = movable(nodes, ids);
  if (targets.length < 2) return null;
  const { axis, anchor } = ALIGNMENTS[alignment];
  const edges = targets.map(node => node.position[axis.pos] + node[axis.size] * anchor);
  const line = anchor === 0 ? Math.min(...edges) : anchor === 1 ? Math.max(...edges) : edges.reduce((sum, value) => sum + value, 0) / edges.length;
  return applyPositions(nodes, new Map(targets.map(node => [node.id, { ...node.position, [axis.pos]: line - node[axis.size] * anchor }])));
}

/** Equal gaps between neighbours, outermost nodes stay put. Needs three or more movable nodes. */
export function distributeNodes(nodes: WorkflowNodeData[], ids: readonly string[], direction: WorkflowDistributeAxis): WorkflowNodeData[] | null {
  const targets = movable(nodes, ids);
  if (targets.length < 3) return null;
  const { pos, size } = AXES[direction];
  const sorted = [...targets].sort((a, b) => a.position[pos] - b.position[pos]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = last.position[pos] + last[size] - first.position[pos];
  const occupied = sorted.reduce((sum, node) => sum + node[size], 0);
  const gap = (span - occupied) / (sorted.length - 1);
  let cursor = first.position[pos];
  const next = new Map<string, { x: number; y: number }>();
  for (const node of sorted) {
    next.set(node.id, { ...node.position, [pos]: cursor });
    cursor += node[size] + gap;
  }
  return applyPositions(nodes, next);
}

/** Moves the selection by a world-space delta (arrow-key nudge). */
export function offsetNodes(nodes: WorkflowNodeData[], ids: readonly string[], dx: number, dy: number): WorkflowNodeData[] | null {
  const targets = movable(nodes, ids);
  if (!targets.length || (dx === 0 && dy === 0)) return null;
  return applyPositions(nodes, new Map(targets.map(node => [node.id, { x: node.position.x + dx, y: node.position.y + dy }])));
}

/** Copies the selection beside itself. Copies start as fresh, ungrouped nodes. */
export function duplicateNodes(nodes: WorkflowNodeData[], ids: readonly string[], offset = 32): { nodes: WorkflowNodeData[]; ids: string[] } | null {
  const wanted = new Set(ids);
  const copies = nodes
    .filter(node => wanted.has(node.id) && !node.isLocked)
    .map(node => ({
      ...node,
      id: nanoid(),
      position: { x: node.position.x + offset, y: node.position.y + offset },
      metadata: { ...node.metadata },
      batchId: undefined,
      batchIndex: undefined,
    }));
  if (!copies.length) return null;
  return { nodes: [...nodes, ...copies], ids: copies.map(node => node.id) };
}

// World-space delta for an arrow key: 8px, or 40px with Shift.
const NUDGE: Record<string, (step: number) => readonly [number, number]> = {
  ArrowLeft: step => [-step, 0],
  ArrowRight: step => [step, 0],
  ArrowUp: step => [0, -step],
  ArrowDown: step => [0, step],
};

export function arrowNudge(key: string, fast: boolean): readonly [number, number] | null {
  return NUDGE[key]?.(fast ? 40 : 8) ?? null;
}
