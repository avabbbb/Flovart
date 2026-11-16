import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { alternateFromNode, foldResultBatches, missingNodeMessage, resolveNodeOrAlternate, nodeAlternates, prependAlternates, primaryVariantId, promoteAlternate, removeAlternates, splitAlternates } from '../components/workflow/batchAlternates';
import { applyWorkflowOps } from '../components/workflow/ops';
import { migrateWorkflowProject } from '../components/workflow/migrations';
import type { WorkflowConnection, WorkflowNode, WorkflowSnapshot } from '../components/workflow/types';

const media = (id: string, type: 'image' | 'video', extra: Partial<WorkflowNode> = {}, meta: WorkflowNode['metadata'] = {}): WorkflowNode => ({
  ...createWorkflowNode(id, type, { x: 100, y: 100 }, {
    storageKey: 'key-' + id, mimeType: type === 'video' ? 'video/mp4' : 'image/png', naturalWidth: 1600, naturalHeight: 900, status: 'success', prompt: 'p-' + id, ...meta,
  }),
  width: 320, height: 180, title: 'n-' + id, ...extra,
});

/** 旧数据：生成 4 张 = 原位首图 + 3 个同位叠放、同 batchId 的兄弟节点。 */
const legacyStack = (type: 'image' | 'video') => [
  media('root', type, { batchId: 'B', batchIndex: 0, batchGroupSource: 'auto' }, { operationTakeId: 't1' }),
  media('s1', type, { batchId: 'B', batchIndex: 1 }),
  media('s2', type, { batchId: 'B', batchIndex: 2 }),
  media('s3', type, { batchId: 'B', batchIndex: 3 }),
];

const snapshot = (nodes: WorkflowNode[], connections: WorkflowConnection[] = []): WorkflowSnapshot => ({ projectId: 'p', title: 't', nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });

describe('batch alternates model', () => {
  it('keeps gallery ids unique in a mixed image / video set across repeated 设为首图 (no duplicate React keys)', () => {
    let owner = prependAlternates(media('root', 'image'), [
      alternateFromNode(media('v1', 'video'), { batchId: 'B' }),
      alternateFromNode(media('i2', 'image'), { batchId: 'B' }),
      alternateFromNode(media('v3', 'video'), { batchId: 'B' }),
    ]);
    const galleryIds = (node: WorkflowNode) => [primaryVariantId(node), ...nodeAlternates(node).map(item => item.id)];
    for (const next of ['v1', 'root', 'v3', 'i2', 'v1']) {
      owner = promoteAlternate(owner, next)!;
      const ids = galleryIds(owner);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids[0]).toBe(next);
      expect(owner.id).toBe('root');
      expect(owner.type).toBe(next.startsWith('v') ? 'video' : 'image');
    }
    expect(galleryIds(owner).sort()).toEqual(['i2', 'root', 'v1', 'v3']);
  });

  it('promotes an alternate by swapping media only: id, edges, prompt and take stay on the node', () => {
    const base = prependAlternates(media('root', 'image', {}, { operationTakeId: 't1' }), [alternateFromNode(media('a1', 'image', {}, { naturalWidth: 900, naturalHeight: 1600 }), { batchId: 'B' })]);
    const promoted = promoteAlternate(base, 'a1')!;
    expect(promoted.id).toBe('root');
    expect(promoted.metadata.storageKey).toBe('key-a1');
    expect(promoted.metadata.prompt).toBe('p-root');
    expect(promoted.metadata.operationTakeId).toBe('t1');
    expect(primaryVariantId(promoted)).toBe('a1');
    // 保持宽度与中心，按新比例换高
    expect(promoted.width).toBe(320);
    expect(promoted.height).toBe(Math.round(320 * 1600 / 900));
    expect(promoted.position.y + promoted.height / 2).toBeCloseTo(100 + 180 / 2);
    // 旧首图换到同一槽位，ID = 节点 ID（再换回来即还原）
    expect(nodeAlternates(promoted).map(item => [item.id, item.metadata.storageKey, item.batchId])).toEqual([['root', 'key-root', 'B']]);
    const back = promoteAlternate(promoted, 'root')!;
    expect(back.metadata.storageKey).toBe('key-root');
    expect(back.metadata.mediaVariantId).toBeUndefined();
    expect(nodeAlternates(back).map(item => item.id)).toEqual(['a1']);
  });

  it('promotes across image / video in a mixed set', () => {
    const base = prependAlternates(media('root', 'image'), [alternateFromNode(media('v1', 'video', {}, { durationMs: 4000, posterStorageKey: 'poster-v1' }))]);
    const promoted = promoteAlternate(base, 'v1')!;
    expect(promoted.type).toBe('video');
    expect(promoted.metadata.durationMs).toBe(4000);
    expect(promoted.metadata.posterStorageKey).toBe('poster-v1');
    const [outgoing] = nodeAlternates(promoted);
    expect(outgoing.type).toBe('image');
    expect(outgoing.metadata.durationMs).toBeUndefined();
  });

  it('set_batch_primary pointing at an alternate swaps media in one undoable op', () => {
    const owner = prependAlternates(media('root', 'video'), ['a', 'b'].map(id => alternateFromNode(media(id, 'video'), { batchId: 'B' })));
    const downstream = media('down', 'image');
    const result = applyWorkflowOps(snapshot([owner, downstream], [{ id: 'c', fromNodeId: 'root', toNodeId: 'down' }]), [{ type: 'set_batch_primary', batchId: 'B', nodeId: 'b' }]);
    expect(result.rejections).toEqual([]);
    const next = result.snapshot.nodes.find(node => node.id === 'root')!;
    expect(next.metadata.storageKey).toBe('key-b');
    expect(result.snapshot.connections).toEqual([{ id: 'c', fromNodeId: 'root', toNodeId: 'down' }]);
    expect(result.snapshot.nodes).toHaveLength(2);
  });

  it('removes and splits alternates into standalone nodes beside the primary', () => {
    const owner = prependAlternates(media('root', 'image'), ['a', 'b', 'c'].map(id => alternateFromNode(media(id, id === 'c' ? 'video' : 'image'))));
    expect(nodeAlternates(removeAlternates(owner, ['a'])).map(item => item.id)).toEqual(['b', 'c']);
    const { primary, nodes } = splitAlternates(owner, ['b', 'c'], new Set(['root', 'b']), () => 'fresh');
    expect(nodeAlternates(primary).map(item => item.id)).toEqual(['a']);
    expect(nodes.map(node => [node.id, node.type, node.metadata.storageKey])).toEqual([['fresh', 'image', 'key-b'], ['c', 'video', 'key-c']]);
    nodes.forEach(node => expect(node.position.x).toBeGreaterThan(owner.position.x + owner.width));
  });
});

describe('legacy stacked batches fold into the primary on load', () => {
  it.each(['image', 'video'] as const)('folds a 4-result %s stack into one node with 3 alternates (no stranded member)', type => {
    const { nodes, changed } = foldResultBatches(legacyStack(type), []);
    expect(changed).toBe(true);
    expect(nodes).toHaveLength(1);
    const [root] = nodes;
    expect(root.id).toBe('root');
    expect(root.batchId).toBeUndefined();
    expect(nodeAlternates(root).map(item => [item.id, item.type, item.batchId])).toEqual([['s1', type, 'B'], ['s2', type, 'B'], ['s3', type, 'B']]);
    expect(root.metadata.operationTakeId).toBe('t1');
  });

  it('keeps the cover the user saw when the legacy pointer chose another member', () => {
    const stack = legacyStack('image');
    stack[0] = { ...stack[0], metadata: { ...stack[0].metadata, primaryImageId: 's2' } };
    const [root] = foldResultBatches(stack, []).nodes;
    expect(root.metadata.storageKey).toBe('key-s2');
    expect(root.metadata.primaryImageId).toBeUndefined();
    expect(nodeAlternates(root).map(item => item.id)).toEqual(['s1', 'root', 's3']);
  });

  it('turns a member with edges into a normal, reachable node instead of dropping the edge', () => {
    const stack = legacyStack('image');
    const extra = media('down', 'image');
    const { nodes } = foldResultBatches([...stack, extra], [{ id: 'c', fromNodeId: 's3', toNodeId: 'down' }]);
    const s3 = nodes.find(node => node.id === 's3')!;
    expect(s3.batchId).toBeUndefined();
    // 不再与首图完全重叠：能点到、能拖
    expect(s3.position).not.toEqual(nodes.find(node => node.id === 'root')!.position);
    expect(nodeAlternates(nodes.find(node => node.id === 'root')).map(item => item.id)).toEqual(['s1', 's2']);
  });

  it('places a detached member in free space instead of on top of a neighbour', () => {
    const stack = legacyStack('image');
    // 邻居正好占着“首图右侧 40px”这个默认落点
    const neighbour = { ...media('down', 'image'), position: { x: 100 + 320 + 40 + 100, y: 100 } };
    const { nodes } = foldResultBatches([...stack, neighbour], [{ id: 'c', fromNodeId: 's3', toNodeId: 'down' }]);
    const s3 = nodes.find(node => node.id === 's3')!;
    const overlaps = (a: WorkflowNode, b: WorkflowNode) => a.position.x < b.position.x + b.width && b.position.x < a.position.x + a.width && a.position.y < b.position.y + b.height && b.position.y < a.position.y + a.height;
    for (const other of nodes) if (other.id !== 's3') expect(overlaps(s3, other)).toBe(false);
    expect(s3.position.x).toBeGreaterThan(100 + 320);
  });

  it('leaves manual groups and storyboard batches (no batchIndex) untouched', () => {
    const manual = legacyStack('image').map(node => ({ ...node, batchGroupSource: 'manual' as const }));
    expect(foldResultBatches(manual, []).changed).toBe(false);
    const storyboard = ['x', 'y'].map(id => media(id, 'image', { batchId: 'S', batchGroupSource: 'auto' }));
    expect(foldResultBatches(storyboard, []).changed).toBe(false);
  });

  it('runs inside project migration and drops folded ids from the selection', () => {
    const project = migrateWorkflowProject({ id: 'p', title: 't', nodes: legacyStack('video'), connections: [], selectedNodeIds: ['root', 's1', 's2', 's3'] });
    expect(project.nodes.map(node => node.id)).toEqual(['root']);
    expect(project.selectedNodeIds).toEqual(['root']);
    expect(nodeAlternates(project.nodes[0])).toHaveLength(3);
  });
});

describe('alternate id resolution (Agent / dispatcher)', () => {
  it('resolves a folded alternate id back to a viewable temporary node', () => {
    const { nodes } = foldResultBatches(legacyStack('image'), []);
    expect(nodes.map(node => node.id)).toEqual(['root']);
    const resolved = resolveNodeOrAlternate(nodes, 's2');
    expect(resolved?.kind).toBe('alternate');
    if (resolved?.kind !== 'alternate') return;
    expect(resolved.owner.id).toBe('root');
    expect(resolved.node.id).toBe('s2');
    expect(resolved.node.position).toEqual(resolved.owner.position);
    expect(resolved.node.metadata.storageKey).toBe('key-s2');
    expect(resolveNodeOrAlternate(nodes, 'root')?.kind).toBe('node');
    expect(resolveNodeOrAlternate(nodes, 'nope')).toBeNull();
  });

  it('explains alternate ids instead of a bare "node not found"', () => {
    const { nodes } = foldResultBatches(legacyStack('image'), []);
    expect(missingNodeMessage(nodes, 's1')).toContain('是节点 root 的备选结果');
    expect(missingNodeMessage(nodes, 'nope')).toBe('节点不存在：nope');
  });
});
