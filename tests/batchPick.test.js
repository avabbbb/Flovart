import { describe, expect, it } from 'vitest';
import { planBatchPick, scoreBatchCandidates } from '../agent/batch-pick.js';
import { WorkflowAgentSession } from '../agent/session.js';

const node = (id, batchIndex, metadata) => ({ id, title: '候选 ' + id, batchId: 'b1', batchIndex, metadata });
const snapshot = {
  id: 'p1',
  nodes: [
    node('a', 0, { href: 'blob:a', naturalWidth: 1024, naturalHeight: 1024, config: { aspectRatio: '16:9' } }),
    node('b', 1, { href: 'blob:b', naturalWidth: 1920, naturalHeight: 1080, config: { aspectRatio: '16:9' } }),
    node('c', 2, { href: 'blob:c', status: 'error', error: 'timeout' }),
    node('d', 3, {}),
    { id: 'other', batchId: 'b2', metadata: { href: 'blob:x' } },
  ],
};

describe('batch auto pick', () => {
  it('prefers the candidate matching resolution and aspect, and never picks failed ones', () => {
    const plan = planBatchPick({ snapshot, batchId: 'b1' });
    expect(plan.primaryNodeId).toBe('b');
    expect(plan.operations).toEqual([{ type: 'set_batch_primary', batchId: 'b1', nodeId: 'b' }]);
    expect(plan.ranking.filter(item => !item.eligible).map(item => item.nodeId).sort()).toEqual(['c', 'd']);
    expect(plan.receipt).toMatchObject({ projectId: 'p1', kind: 'decision', externalRef: 'batch-pick:b1:b' });
    expect(plan.receipt.summary).toContain('仅基于启发式');
  });

  it('lets external scores decide when provided', () => {
    const plan = planBatchPick({ snapshot, batchId: 'b1', scores: { a: 95, b: 10 } });
    expect(plan.primaryNodeId).toBe('a');
    expect(plan.receipt.summary).not.toContain('仅基于启发式');
  });

  it('rejects batches that cannot be picked', () => {
    expect(() => planBatchPick({ snapshot, batchId: 'b2' })).toThrow('少于 2 个候选');
    expect(() => planBatchPick({ snapshot: { nodes: [node('x', 0, { error: 'x' }), node('y', 1, {})] }, batchId: 'b1' })).toThrow('没有可用的成功候选');
    expect(scoreBatchCandidates([])).toEqual([]);
  });

  it('session dry-run returns the plan without touching the browser', async () => {
    const session = new WorkflowAgentSession();
    session.updateSnapshot(snapshot);
    const result = await session.callCommand('workflow.batch.pick', { batchId: 'b1', dryRun: true }, 'cli');
    expect(result).toMatchObject({ ok: true, result: { primaryNodeId: 'b', applied: false } });
    const bad = await session.callCommand('workflow.batch.pick', { batchId: 'nope' }, 'cli');
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });
});
