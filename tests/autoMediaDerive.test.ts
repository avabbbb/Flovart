import { describe, expect, it } from 'vitest';
import type { WorkflowNode } from '../components/workflow/types';
import { DEFAULT_AUTO_MEDIA_DERIVE, planAutoMediaDerivations } from '../services/autoMediaDerive';

function video(id: string, metadata: Record<string, unknown> = {}): WorkflowNode {
  return { id, type: 'video', metadata: { status: 'success', storageKey: 'k-' + id, ...metadata } } as unknown as WorkflowNode;
}
const all = { firstFrame: true, lastFrame: true, avSplit: true };

describe('planAutoMediaDerivations', () => {
  it('plans nothing when disabled or on first load', () => {
    expect(planAutoMediaDerivations([], [video('a')], DEFAULT_AUTO_MEDIA_DERIVE)).toEqual([]);
    expect(planAutoMediaDerivations(undefined, [video('a')], all)).toEqual([]);
  });

  it('plans enabled kinds for a video that just became ready', () => {
    const before = [video('a', { status: 'running' })];
    const after = [video('a')];
    expect(planAutoMediaDerivations(before, after, { firstFrame: false, lastFrame: true, avSplit: true })).toEqual([
      { nodeId: 'a', kind: 'last-frame' },
      { nodeId: 'a', kind: 'av-split' },
    ]);
  });

  it('skips already-ready, handled, operation outputs and media-less nodes', () => {
    const before = [video('old')];
    const after = [
      video('old'),
      video('done'),
      video('derived', { sourceOperationNodeId: 'op1' }),
      video('empty', { storageKey: undefined }),
      { id: 'img', type: 'image', metadata: { status: 'success', storageKey: 'x' } } as unknown as WorkflowNode,
      video('fresh'),
    ];
    const tasks = planAutoMediaDerivations(before, after, { firstFrame: true, lastFrame: false, avSplit: false }, new Set(['done']));
    expect(tasks).toEqual([{ nodeId: 'fresh', kind: 'first-frame' }]);
  });
});
