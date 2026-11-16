import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import {
  GROUP_HEADER,
  GROUP_PADDING,
  WorkflowGroupError,
  buildGroupCreateOps,
  buildUngroupOps,
  enclosingGroupId,
  groupMemberIds,
  groupRunOrder,
  isGroupFrame,
  migrateManualBatchGroups,
} from '../components/workflow/canvasGroups';
import { migrateWorkflowProject } from '../components/workflow/migrations';
import type { WorkflowConnection, WorkflowNode } from '../components/workflow/types';

const snapshot = (nodes: WorkflowNode[], connections: WorkflowConnection[] = []) => ({ projectId: 'p', title: 'p', nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });

const gen = (id: string, x: number, prompt = 'a cat') => createWorkflowNode(id, 'image', { x, y: 100 }, { prompt });

describe('canvas groups', () => {
  it('creates one group frame around the members and parents them (no batchId)', () => {
    const nodes = [gen('a', 100), gen('b', 600)];
    const plan = buildGroupCreateOps(nodes, ['a', 'b'], { groupId: 'g1', title: '第一场' });
    const result = applyWorkflowOps(snapshot(nodes), plan.ops);
    expect(result.rejections).toEqual([]);
    const frame = result.snapshot.nodes.find(node => node.id === 'g1')!;
    expect(isGroupFrame(frame)).toBe(true);
    expect(frame.title).toBe('第一场');
    expect(frame.metadata.reverseProjectId).toBeUndefined();
    expect(frame.position).toEqual({ x: 100 - GROUP_PADDING, y: 100 - GROUP_PADDING - GROUP_HEADER });
    expect(frame.width).toBe(600 + nodes[1].width - 100 + GROUP_PADDING * 2);
    const members = result.snapshot.nodes.filter(node => node.parentId === 'g1');
    expect(members.map(node => node.id)).toEqual(['a', 'b']);
    expect(members.every(node => !node.batchId)).toBe(true);
  });

  it('clears an old manual batch group when the members are regrouped, but keeps auto batches', () => {
    const a = { ...gen('a', 0), batchId: 'm', batchGroupSource: 'manual' as const };
    const b = { ...gen('b', 400), batchId: 'auto', batchGroupSource: 'auto' as const };
    const plan = buildGroupCreateOps([a, b], ['a', 'b'], { groupId: 'g' });
    const result = applyWorkflowOps(snapshot([a, b]), plan.ops).snapshot.nodes;
    expect(result.find(node => node.id === 'a')!.batchId).toBeUndefined();
    expect(result.find(node => node.id === 'b')!.batchId).toBe('auto');
  });

  it('only parents the outermost selected nodes and needs at least two', () => {
    const outer = buildGroupCreateOps([gen('a', 0), gen('b', 400)], ['a', 'b'], { groupId: 'g1' });
    const nodes = applyWorkflowOps(snapshot([gen('a', 0), gen('b', 400)]), outer.ops).snapshot.nodes;
    const c = gen('c', 1200);
    const plan = buildGroupCreateOps([...nodes, c], ['g1', 'a', 'c'], { groupId: 'g2' });
    expect(plan.memberIds).toEqual(['g1', 'c']);
    expect(() => buildGroupCreateOps([gen('a', 0)], ['a'], { groupId: 'x' })).toThrow(WorkflowGroupError);
    expect(() => buildGroupCreateOps([gen('a', 0)], ['a', 'zz'], { groupId: 'x' })).toThrow(/不存在/);
  });

  it('ungroups by moving members up one level and deleting only the frame', () => {
    const base = [gen('a', 0), gen('b', 400)];
    const grouped = applyWorkflowOps(snapshot(base), buildGroupCreateOps(base, ['a', 'b'], { groupId: 'g' }).ops).snapshot;
    const result = applyWorkflowOps(grouped, buildUngroupOps(grouped.nodes, 'g')).snapshot;
    expect(result.nodes.map(node => node.id)).toEqual(['a', 'b']);
    expect(result.nodes.every(node => !node.parentId)).toBe(true);
    expect(() => buildUngroupOps(result.nodes, 'a')).toThrow(/分组不存在/);
  });

  it('runs runnable members in dependency order and skips media-only or locked nodes', () => {
    const upload = createWorkflowNode('up', 'image', { x: 0, y: 0 }, { href: 'https://cdn/u.png' });
    const later = gen('later', 900);
    const first = gen('first', 400);
    const locked = { ...gen('locked', 1300), isLocked: true };
    const note = createWorkflowNode('note', 'text', { x: 0, y: 500 }, { content: 'x' });
    const nodes = [upload, later, first, locked, note];
    const connections: WorkflowConnection[] = [{ id: '1', fromNodeId: 'up', toNodeId: 'first' }, { id: '2', fromNodeId: 'first', toNodeId: 'later' }];
    const grouped = applyWorkflowOps(snapshot(nodes, connections), buildGroupCreateOps(nodes, nodes.map(node => node.id), { groupId: 'g' }).ops).snapshot;
    expect(groupRunOrder(grouped.nodes, grouped.connections, 'g')).toEqual(['first', 'later']);
    expect(groupMemberIds(grouped.nodes, 'g').sort()).toEqual(['first', 'later', 'locked', 'note', 'up']);
    expect(enclosingGroupId(grouped.nodes, 'later')).toBe('g');
    expect(enclosingGroupId(grouped.nodes, 'g')).toBe('g');
  });

  it('migrates manual batch groups into frames idempotently and leaves auto/storyboard batches alone', () => {
    const nodes: WorkflowNode[] = [
      { ...gen('m1', 0), batchId: 'M', batchGroupSource: 'manual' },
      { ...gen('m2', 400), batchId: 'M', batchGroupSource: 'manual' },
      { ...gen('s1', 0), batchId: 'S', batchGroupSource: 'auto' },
      { ...gen('s2', 400), batchId: 'S', batchGroupSource: 'auto' },
      { ...gen('solo', 800), batchId: 'X', batchGroupSource: 'manual' },
    ];
    const first = migrateManualBatchGroups(nodes);
    expect(first.changed).toBe(true);
    const frame = first.nodes.find(node => node.id === 'group-M')!;
    expect(isGroupFrame(frame)).toBe(true);
    expect(first.nodes.filter(node => node.parentId === 'group-M').map(node => node.id)).toEqual(['m1', 'm2']);
    expect(first.nodes.filter(node => node.batchId === 'S')).toHaveLength(2);
    expect(first.nodes.find(node => node.id === 'solo')!.batchId).toBeUndefined();
    expect(migrateManualBatchGroups(first.nodes).changed).toBe(false);
  });

  it('runs inside project migration', () => {
    const project = migrateWorkflowProject({
      id: 'p', title: 't', connections: [],
      nodes: [{ ...gen('m1', 0), batchId: 'M', batchGroupSource: 'manual' }, { ...gen('m2', 400), batchId: 'M', batchGroupSource: 'manual' }],
    });
    expect(project.nodes.find(node => isGroupFrame(node))?.id).toBe('group-M');
  });
});
