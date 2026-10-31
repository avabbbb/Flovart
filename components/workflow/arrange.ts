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

export type WorkflowArrangeLayout = 'grid' | 'row' | 'column';

export interface WorkflowArrangeOptions {
  layout: WorkflowArrangeLayout;
  /** World-space gap between neighbours; defaults to 24. */
  gap?: number;
  /** Grid only; defaults to ceil(sqrt(n)). */
  columns?: number;
}

/** Reading order: rows top-to-bottom (a node joins a row when its top sits within half the row's first height), then left-to-right. */
export function arrangementOrder(nodes: WorkflowNodeData[], ids: readonly string[]): WorkflowNodeData[] {
  const wanted = new Set(ids);
  const byTop = nodes.filter(node => wanted.has(node.id)).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const rows: WorkflowNodeData[][] = [];
  for (const node of byTop) {
    const row = rows[rows.length - 1];
    if (row && node.position.y < row[0].position.y + Math.max(1, row[0].height / 2)) row.push(node);
    else rows.push([node]);
  }
  return rows.flatMap(row => row.sort((a, b) => a.position.x - b.position.x));
}

/**
 * Lays the movable selection out as a grid, a row or a column from its top-left corner,
 * in reading order. Locked nodes keep their place. Returns only positions that change,
 * or null when fewer than two movable nodes are selected or nothing would move.
 */
export function arrangeNodePositions(nodes: WorkflowNodeData[], ids: readonly string[], options: WorkflowArrangeOptions): Record<string, { x: number; y: number }> | null {
  const order = arrangementOrder(nodes, ids).filter(node => !node.isLocked);
  if (order.length < 2) return null;
  const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap as number) : 24;
  const cols = options.layout === 'row' ? order.length
    : options.layout === 'column' ? 1
    : Math.max(1, Math.min(order.length, Math.round(options.columns ?? Math.ceil(Math.sqrt(order.length)))));
  const originX = Math.min(...order.map(node => node.position.x));
  const originY = Math.min(...order.map(node => node.position.y));
  const colWidths: number[] = Array(cols).fill(0);
  const rowHeights: number[] = [];
  order.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    colWidths[col] = Math.max(colWidths[col], node.width);
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, node.height);
  });
  const offset = (sizes: number[], upTo: number) => sizes.slice(0, upTo).reduce((sum, size) => sum + size + gap, 0);
  const next: Record<string, { x: number; y: number }> = {};
  order.forEach((node, index) => {
    const x = originX + offset(colWidths, index % cols);
    const y = originY + offset(rowHeights, Math.floor(index / cols));
    if (x !== node.position.x || y !== node.position.y) next[node.id] = { x, y };
  });
  return Object.keys(next).length ? next : null;
}

/** prefix_01, prefix_02 … (padding widens past 99). Unsafe filename characters become '_'. */
export function sequencedFileNames(prefix: string, count: number, start = 1): string[] {
  const safe = prefix.trim().replace(/[\\/:*?"<>|\s]+/g, '_') || 'flovart';
  const width = Math.max(2, String(start + count - 1).length);
  return Array.from({ length: Math.max(0, count) }, (_, index) => `${safe}_${String(start + index).padStart(width, '0')}`);
}
