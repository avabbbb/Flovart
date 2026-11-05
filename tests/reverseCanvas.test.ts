import { describe, expect, it } from 'vitest';
import { REVERSE_SUBGRAPH_TYPE, SUBGRAPH_CHILD_TITLE_CLEARANCE, SUBGRAPH_HEADER_HEIGHT, reverseToSubgraph, syncSubgraph } from '../services/reverse/canvas';
import type { ReverseShot, ReverseVideoProject, ReverseWord } from '../services/reverse/types';
import type { WorkflowNode } from '../components/workflow/types';

const words: ReverseWord[] = [
  { index: 0, text: 'Tired', startMs: 100, endMs: 400 },
  { index: 1, text: 'of', startMs: 420, endMs: 600 },
  { index: 2, text: 'waiting?', startMs: 620, endMs: 900 },
  { index: 3, text: 'Try', startMs: 1100, endMs: 1300 },
  { index: 4, text: 'Brew.', startMs: 1320, endMs: 1700 },
];

function shot(id: string, index: number, startMs: number, endMs: number, extra: Partial<ReverseShot> = {}): ReverseShot {
  return { id, index, startMs, endMs, slotIds: [], ...extra };
}

function project(shots: ReverseShot[], over: Partial<ReverseVideoProject> = {}): ReverseVideoProject {
  return {
    id: 'rp1',
    title: 'Coffee ad',
    direction: 'video',
    status: 'ready',
    references: [],
    anchors: [],
    outputs: [],
    gates: [],
    slots: [],
    axes: [],
    variants: [],
    createdAt: 'fixture',
    updatedAt: 'fixture',
    analysis: { durationMs: 2000, shots, words, segments: [], analyzedAt: 'fixture', source: 'manual' },
    ...over,
  };
}

const base = () => project([shot('s1', 1, 0, 1000, { description: 'close-up of a sleepy face', camera: 'push in' }), shot('s2', 2, 1000, 2000)]);

function counter(prefix: string): () => string {
  let n = 0;
  return () => prefix + ++n;
}

const byKey = (nodes: readonly WorkflowNode[], key: string) => nodes.find((n) => n.metadata.reverseKey === key);

describe('reverse canvas', () => {
  it('creates a subgraph frame with a script node, one text node per shot, and script→shot edges', () => {
    const plan = reverseToSubgraph(base(), { x: 100, y: 80 }, counter('id-'));
    expect(plan.frame.type).toBe(REVERSE_SUBGRAPH_TYPE);
    expect(plan.frame.position).toEqual({ x: 100, y: 80 });
    expect(plan.frame.metadata).toMatchObject({ reverseProjectId: 'rp1', collapsed: false, childKeys: ['script', 'shot:s1', 'shot:s2'] });
    expect(plan.children.every((n) => n.parentId === plan.frame.id)).toBe(true);

    const script = byKey(plan.children, 'script')!;
    expect(script.type).toBe('script');
    expect(script.metadata.scriptBreakdown?.shots.map((s) => s.dialogue)).toEqual(['Tired of waiting?', 'Try Brew.']);

    const s1 = byKey(plan.children, 'shot:s1')!;
    expect(s1.type).toBe('text');
    expect(s1.metadata.prompt).toBe('close-up of a sleepy face\n运镜：push in');
    expect(s1.metadata.content).toContain('台词：Tired of waiting?');
    expect(s1.shot).toMatchObject({ index: 1, durationSec: 1, camera: 'push in', dialogue: 'Tired of waiting?' });

    expect(plan.connections.map((c) => [c.fromNodeId, c.toNodeId])).toEqual([
      [script.id, s1.id],
      [script.id, byKey(plan.children, 'shot:s2')!.id],
    ]);
    // 子节点都落在框内。
    for (const n of plan.children) {
      expect(n.position.x + n.width).toBeLessThanOrEqual(plan.frame.position.x + plan.frame.width);
      expect(n.position.y + n.height).toBeLessThanOrEqual(plan.frame.position.y + plan.frame.height);
    }
    // 子节点及其悬于上方的标题条都在框头部之下，不与头部提示重叠。
    for (const n of plan.children) {
      expect(n.position.y).toBeGreaterThanOrEqual(plan.frame.position.y + SUBGRAPH_HEADER_HEIGHT);
      expect(n.position.y - SUBGRAPH_CHILD_TITLE_CLEARANCE).toBeGreaterThanOrEqual(plan.frame.position.y + SUBGRAPH_HEADER_HEIGHT);
    }
  });

  it('is deterministic without an id factory', () => {
    const a = reverseToSubgraph(base(), { x: 0, y: 0 });
    const b = reverseToSubgraph(base(), { x: 0, y: 0 });
    expect(a).toEqual(b);
    expect(new Set([a.frame.id, ...a.children.map((n) => n.id)]).size).toBe(4);
  });

  it('is a no-op when nothing changed', () => {
    const plan = reverseToSubgraph(base(), { x: 0, y: 0 });
    const sync = syncSubgraph(base(), { frame: plan.frame, children: plan.children });
    expect(sync).toMatchObject({ add: [], update: [], remove: [] });
    expect(sync.connections.map((c) => [c.fromNodeId, c.toNodeId])).toEqual(plan.connections.map((c) => [c.fromNodeId, c.toNodeId]));
  });

  it('adds new shots and removes deleted ones, leaving user nodes alone', () => {
    const plan = reverseToSubgraph(base(), { x: 0, y: 0 });
    const userNode: WorkflowNode = { ...plan.children[1]!, id: 'user-note', metadata: { content: 'my note' } };
    const next = project([shot('s1', 1, 0, 1000, { description: 'close-up of a sleepy face', camera: 'push in' }), shot('s3', 2, 1000, 2000)]);
    const sync = syncSubgraph(next, { frame: plan.frame, children: [...plan.children, userNode] }, counter('new-'));

    expect(sync.remove).toEqual([byKey(plan.children, 'shot:s2')!.id]);
    expect(sync.add).toHaveLength(1);
    const added = sync.add[0]!;
    expect(added).toMatchObject({ type: 'text', parentId: plan.frame.id, metadata: { reverseKey: 'shot:s3' } });
    // 新镜头排在已有镜头列下方，不与之重叠。
    const lowest = Math.max(...plan.children.filter((n) => n.type === 'text').map((n) => n.position.y + n.height));
    expect(added.position.y).toBeGreaterThan(lowest);
    expect(sync.remove).not.toContain('user-note');
    expect(sync.update.find((n) => n.id === plan.frame.id)?.metadata.childKeys).toEqual(['script', 'shot:s1', 'shot:s3']);
    const script = sync.update.find((n) => n.metadata.reverseKey === 'script')!;
    expect(script.metadata.scriptBreakdown?.shots.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(sync.connections.some((c) => c.toNodeId === added.id && c.fromNodeId === script.id)).toBe(true);
  });

  it('updates content but keeps user layout and the selected generation version', () => {
    const plan = reverseToSubgraph(base(), { x: 0, y: 0 });
    const s1 = byKey(plan.children, 'shot:s1')!;
    const script = byKey(plan.children, 'script')!;
    const edited: WorkflowNode[] = plan.children.map((n) => {
      if (n.id === s1.id) {
        return {
          ...n,
          position: { x: 999, y: 777 },
          width: 500,
          height: 300,
          shot: { ...n.shot!, anchorNodeIds: ['anchor-1'] },
          metadata: { ...n.metadata, primaryImageId: 'take-2', generationHistoryId: 'hist-2', href: 'blob:v2' },
        };
      }
      if (n.id === script.id) {
        const bd = n.metadata.scriptBreakdown!;
        return {
          ...n,
          position: { x: 5, y: 6 },
          metadata: { ...n.metadata, scriptBreakdown: { ...bd, shots: bd.shots.map((s) => (s.id === 's1' ? { ...s, imageNodeId: 'img-9', status: 'success' as const } : s)) } },
        };
      }
      return n;
    });
    const frame = { ...plan.frame, position: { x: -50, y: -60 }, width: 2000, height: 1500, metadata: { ...plan.frame.metadata, collapsed: true } };
    const changed = project([shot('s1', 1, 0, 1000, { description: 'wide shot of a kitchen', camera: 'static' }), shot('s2', 2, 1000, 2000)]);

    const sync = syncSubgraph(changed, { frame, children: edited });
    expect(sync.add).toEqual([]);
    expect(sync.remove).toEqual([]);
    // 框没有变化（childKeys / 标题相同），不出现在 update 里。
    expect(sync.update.find((n) => n.id === frame.id)).toBeUndefined();

    const u1 = sync.update.find((n) => n.id === s1.id)!;
    expect(u1.position).toEqual({ x: 999, y: 777 });
    expect([u1.width, u1.height]).toEqual([500, 300]);
    expect(u1.metadata).toMatchObject({ primaryImageId: 'take-2', generationHistoryId: 'hist-2', href: 'blob:v2', prompt: 'wide shot of a kitchen\n运镜：static' });
    expect(u1.shot).toMatchObject({ camera: 'static', anchorNodeIds: ['anchor-1'], dialogue: 'Tired of waiting?' });

    const us = sync.update.find((n) => n.id === script.id)!;
    expect(us.position).toEqual({ x: 5, y: 6 });
    expect(us.metadata.scriptBreakdown?.shots[0]).toMatchObject({ id: 's1', imageNodeId: 'img-9', status: 'success', camera: 'static', action: 'wide shot of a kitchen' });
    // 未变化的镜头不更新。
    expect(sync.update.find((n) => n.metadata.reverseKey === 'shot:s2')).toBeUndefined();
  });

  it('clears a removed camera instead of keeping the stale value', () => {
    const plan = reverseToSubgraph(base(), { x: 0, y: 0 });
    const next = project([shot('s1', 1, 0, 1000, { description: 'close-up of a sleepy face' }), shot('s2', 2, 1000, 2000)]);
    const sync = syncSubgraph(next, { frame: plan.frame, children: plan.children });
    const u1 = sync.update.find((n) => n.metadata.reverseKey === 'shot:s1')!;
    expect(u1.shot?.camera).toBeUndefined();
    expect(u1.metadata.prompt).toBe('close-up of a sleepy face');
  });
});
