import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { buildStoryboardView } from '../components/workflow/productionBible';
import type { WorkflowNode } from '../components/workflow/types';

const node = (id: string, type: string, patch: Partial<WorkflowNode> = {}, metadata: Record<string, unknown> = {}) =>
  ({ ...createWorkflowNode(id, type as never, { x: 0, y: 0 }, metadata), ...patch }) as WorkflowNode;

describe('buildStoryboardView', () => {
  const nodes = [
    node('scene', 'image', { title: '街景', anchor: { kind: 'scene', approved: true } }, { href: 'https://x/s.png' }),
    node('hero', 'image', { title: '主角', anchor: { kind: 'character', approved: true, code: 'A01' } }, { storageKey: 'hero-key' }),
    node('ref', 'image', { title: '构图参考' }, { href: 'https://x/r.png' }),
    node('v2', 'video', { title: '镜头 2', shot: { index: 2, durationSec: 4 } }, { prompt: '转身', storageKey: 'v2-key', durationMs: 4200 }),
    node('v1', 'video', { title: '镜头 1', shot: { index: 1, durationSec: 5 } }, { prompt: '走进雨里', href: 'https://x/v1.mp4' }),
    node('i3', 'image', { title: '镜头 3 静帧', shot: { index: 3 } }, { prompt: '特写' }),
    node('v4', 'video', { title: '镜头 4', shot: { index: 4, durationSec: 3 } }, { prompt: '收尾' }),
    node('cut', 'video', {}, { operation: { capabilityId: 'video.merge@1', recipe: { inputBindings: [] }, takes: [] } }),
  ];
  const connections = [
    { id: 'c1', fromNodeId: 'hero', toNodeId: 'v1' },
    { id: 'c2', fromNodeId: 'scene', toNodeId: 'v1' },
    { id: 'c3', fromNodeId: 'ref', toNodeId: 'v1' },
    { id: 'c4', fromNodeId: 'hero', toNodeId: 'v2' },
  ];
  const view = buildStoryboardView({ nodes, connections });

  it('lists anchors in code order with media', () => {
    expect(view.anchors.map(anchor => [anchor.code, anchor.nodeId])).toEqual([['A01', 'hero'], ['S01', 'scene']]);
    expect(view.anchors[0].media).toEqual({ storageKey: 'hero-key' });
  });

  it('builds shot rows in index order with anchor codes, prompt and reference images', () => {
    expect(view.rows.map(row => row.index)).toEqual([1, 2, 3, 4]);
    expect(view.rows[0]).toMatchObject({ nodeId: 'v1', type: 'video', prompt: '走进雨里', anchorCodes: ['A01', 'S01'], referenceImageIds: ['ref'] });
    expect(view.images.map(row => row.nodeId)).toEqual(['i3']);
  });

  it('lays video shots on a timeline (measured duration wins) and plans the final cut', () => {
    expect(view.timeline.map(clip => [clip.nodeId, clip.startSec, clip.durationSec])).toEqual([['v1', 0, 5], ['v2', 5, 4.2], ['v4', 9.2, 3]]);
    expect(view.final.plan.ready).toBe(false);
    expect(view.final.plan.missingShots).toEqual([4]);
    expect(view.final.plan.sourceNodeIds).toEqual(['v1', 'v2']);
    expect(view.final.mergedNodeIds).toEqual(['cut']);
  });

  it('is empty-safe', () => {
    expect(buildStoryboardView(null)).toMatchObject({ anchors: [], rows: [], timeline: [], final: { mergedNodeIds: [] } });
  });
});
