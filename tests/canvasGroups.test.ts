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
  fitGroupFrames,
  groupFitSeeds,
  groupMemberIds,
  groupRunOrder,
  isGroupFrame,
  migrateManualBatchGroups,
} from '../components/workflow/canvasGroups';
import { migrateWorkflowProject } from '../components/workflow/migrations';
import { applyWorkflowMutation } from '../components/workflow/draftAuthority';
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

describe('group frames follow their members', () => {
  const grouped = () => {
    const nodes = [gen('a', 100), gen('b', 600)];
    const plan = buildGroupCreateOps(nodes, ['a', 'b'], { groupId: 'g1' });
    return applyWorkflowOps(snapshot(nodes), plan.ops).snapshot.nodes;
  };
  const frameOf = (nodes: WorkflowNode[], id = 'g1') => nodes.find(node => node.id === id)!;

  it('grows when a member moves outward and shrinks back when it returns', () => {
    const nodes = grouped();
    const original = frameOf(nodes);
    const moved = nodes.map(node => node.id === 'b' ? { ...node, position: { x: 1200, y: 500 } } : node);
    const grown = frameOf(fitGroupFrames(moved, ['b']));
    expect(grown.width).toBe(1200 + (moved.find(n => n.id === 'b')!.width) - 100 + GROUP_PADDING * 2);
    expect(grown.height).toBeGreaterThan(original.height);
    expect(grown.position).toEqual(original.position);
    const back = frameOf(fitGroupFrames(nodes.map(node => ({ ...node })), ['b']));
    expect({ ...back.position, w: back.width, h: back.height }).toEqual({ ...original.position, w: original.width, h: original.height });
  });

  it('returns the same array when nothing needs to change and ignores collapsed or member-less frames', () => {
    const nodes = grouped();
    expect(fitGroupFrames(nodes, ['a'])).toBe(nodes);
    expect(fitGroupFrames(nodes, [])).toBe(nodes);
    const collapsed = nodes.map(node => node.id === 'g1' ? { ...node, metadata: { ...node.metadata, collapsed: true } } : node.id === 'b' ? { ...node, position: { x: 3000, y: 100 } } : node);
    expect(fitGroupFrames(collapsed, ['b'])).toBe(collapsed);
  });

  it('does not snap back a frame the user resized by itself', () => {
    const nodes = grouped().map(node => node.id === 'g1' ? { ...node, width: 2000 } : node);
    expect(frameOf(fitGroupFrames(nodes, ['g1'])).width).toBe(2000);
  });

  it('fits nested groups from the inside out', () => {
    const base = grouped();
    const c = gen('c', 100);
    c.position = { x: 100, y: 900 };
    const inner = buildGroupCreateOps([...base], ['a', 'b'], { groupId: 'inner' });
    let nodes = applyWorkflowOps(snapshot(base), inner.ops).snapshot.nodes;
    nodes = nodes.map(node => node.id === 'inner' ? { ...node, parentId: 'g1' } : node);
    nodes = [...nodes, { ...c, parentId: 'g1' }];
    nodes = fitGroupFrames(nodes, ['c', 'inner']);
    const moved = nodes.map(node => node.id === 'a' ? { ...node, position: { x: -800, y: 100 } } : node);
    const fitted = fitGroupFrames(moved, ['a']);
    expect(frameOf(fitted, 'inner').position.x).toBe(-800 - GROUP_PADDING);
    expect(frameOf(fitted, 'g1').position.x).toBe(-800 - GROUP_PADDING * 2);
  });

  it('shrinks the old group when a member is deleted, inside the same undoable change set', () => {
    const nodes = grouped();
    const extra = { ...gen('c', 1600), parentId: 'g1' };
    const start = fitGroupFrames([...nodes, extra], ['c']);
    const project = { id: 'p', title: 'p', nodes: start, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 }, createdAt: '', updatedAt: '', draftVersion: 1 } as unknown as Parameters<typeof applyWorkflowMutation>[0];
    const result = applyWorkflowMutation(project, { projectId: 'p', expectedRevision: 1, mutationId: 'm1', source: 'ui', ops: [{ type: 'delete_nodes', ids: ['c'] }] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(frameOf(result.project.nodes).width).toBe(frameOf(nodes).width);
    expect(groupFitSeeds(start, result.project.nodes).oldParents).toContain('g1');
  });
});
