import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  applyWorkflowMutation,
  applyWorkflowViewOperations,
  redoWorkflowDraftChangeSet,
  undoWorkflowDraftChangeSet,
} from '../components/workflow/draftAuthority';
import { createWorkflowProject } from '../components/workflow/store';
import type { WorkflowMutationEnvelope } from '../components/workflow/types';

const envelope = (projectId: string): WorkflowMutationEnvelope => ({
  projectId,
  expectedRevision: 1,
  mutationId: 'mutation-batch-1',
  source: 'cli',
  intent: '创建并连接节点',
  ops: [
    { type: 'add_node', node: createWorkflowNode('source-1', 'text', { x: 0, y: 0 }, { content: '脚本' }) },
    { type: 'add_node', node: createWorkflowNode('shot-1', 'image', { x: 420, y: 0 }) },
    { type: 'connect_nodes', id: 'edge-1', fromNodeId: 'source-1', toNodeId: 'shot-1' },
  ],
});

describe('WorkflowMutationEnvelope', () => {
  it('produces the same document result for UI and CLI adapters', () => {
    const uiProject = createWorkflowProject('UI');
    const cliProject = createWorkflowProject('CLI');
    const ui = applyWorkflowMutation(uiProject, { ...envelope(uiProject.id), source: 'ui' });
    const cli = applyWorkflowMutation(cliProject, { ...envelope(cliProject.id), source: 'cli' });

    expect(ui.ok).toBe(true);
    expect(cli.ok).toBe(true);
    if (ui.ok === false || cli.ok === false) throw new Error('Mutation parity fixture failed');
    expect({ nodes: ui.project.nodes, connections: ui.project.connections, selectedNodeIds: ui.project.selectedNodeIds, viewport: ui.project.viewport, draftVersion: ui.project.draftVersion })
      .toEqual({ nodes: cli.project.nodes, connections: cli.project.connections, selectedNodeIds: cli.project.selectedNodeIds, viewport: cli.project.viewport, draftVersion: cli.project.draftVersion });
  });

  it('commits a document batch atomically as one ChangeSet and one revision', () => {
    const project = createWorkflowProject('批量变更');
    const result = applyWorkflowMutation(project, envelope(project.id));

    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.error.message);
    expect(result.project.nodes.map(node => node.id)).toEqual(['source-1', 'shot-1']);
    expect(result.project.connections).toEqual([
      expect.objectContaining({ id: 'edge-1', fromNodeId: 'source-1', toNodeId: 'shot-1' }),
    ]);
    expect(result.project.draftVersion).toBe(2);
    expect(result.project.draftChangeSets).toHaveLength(1);
    expect(result.project.draftChangeSets?.[0]).toMatchObject({ id: 'mutation-batch-1', baseDraftVersion: 1, resultDraftVersion: 2 });
    expect(result.receipt).toMatchObject({
      mutationId: 'mutation-batch-1',
      projectId: project.id,
      previousRevision: 1,
      revision: 2,
      applied: true,
      replayed: false,
    });
    expect(result.receipt.operationResults).toHaveLength(3);
  });

  it('persists idempotency receipts and replays without mutating again', () => {
    const project = createWorkflowProject('幂等');
    const first = applyWorkflowMutation(project, envelope(project.id));
    expect(first.ok).toBe(true);
    if (first.ok === false) throw new Error(first.error.message);

    const replay = applyWorkflowMutation(first.project, envelope(project.id));
    expect(replay.ok).toBe(true);
    if (replay.ok === false) throw new Error(replay.error.message);
    expect(replay.project).toBe(first.project);
    expect(replay.project.draftVersion).toBe(2);
    expect(replay.project.draftChangeSets).toHaveLength(1);
    expect(replay.receipt).toMatchObject({ mutationId: 'mutation-batch-1', applied: true, replayed: true, revision: 2 });
  });

  it('rejects mutationId reuse with a different payload before revision validation', () => {
    const project = createWorkflowProject('复用冲突');
    const first = applyWorkflowMutation(project, envelope(project.id));
    expect(first.ok).toBe(true);
    if (first.ok === false) throw new Error(first.error.message);

    const reused = applyWorkflowMutation(first.project, {
      ...envelope(project.id),
      ops: [{ type: 'update_node', id: 'shot-1', patch: { title: '不同载荷' } }],
    });
    expect(reused).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_KEY_REUSE' } });
    expect(first.project.nodes.find(node => node.id === 'shot-1')?.title).toBe('图片');
  });

  it('rejects stale expectedRevision without changing the project', () => {
    const project = createWorkflowProject('版本冲突');
    project.draftVersion = 4;
    const result = applyWorkflowMutation(project, { ...envelope(project.id), expectedRevision: 3 });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'REVISION_CONFLICT', expectedRevision: 3, actualRevision: 4 },
    });
    expect(project.nodes).toEqual([]);
  });

  it('keeps view operations out of document revision, receipts, and undo history', () => {
    const project = createWorkflowProject('视图状态');
    project.nodes = [createWorkflowNode('node-1', 'text', { x: 0, y: 0 })];
    const viewed = applyWorkflowViewOperations(project, [
      { type: 'select_nodes', ids: ['node-1'] },
      { type: 'set_viewport', viewport: { x: 40, y: 80, k: 1.5 } },
    ]);

    expect(viewed.ok).toBe(true);
    if (viewed.ok === false) throw new Error(viewed.error.message);
    expect(viewed.project.selectedNodeIds).toEqual(['node-1']);
    expect(viewed.project.viewport).toEqual({ x: 40, y: 80, k: 1.5 });
    expect(viewed.project.draftVersion).toBe(1);
    expect(viewed.project.draftChangeSets).toEqual([]);
    expect(viewed.project.workflowMutationReceipts).toEqual([]);
  });

  it('fills node defaults for a bare workflow.apply add_node payload', () => {
    const project = createWorkflowProject('裸节点');
    const result = applyWorkflowMutation(project, {
      projectId: project.id,
      expectedRevision: project.draftVersion || 1,
      mutationId: 'bare-add-node',
      source: 'cli',
      intent: '创建文本节点',
      ops: [{
        type: 'add_node',
        node: { id: 'x', type: 'text', title: 'T', position: { x: 80, y: 120 } } as never,
      }],
    });

    expect(result.ok).toBe(true);
    if (result.ok === false) throw new Error(result.error.message);
    const node = result.project.nodes.find(item => item.id === 'x');
    expect(node).toMatchObject({
      id: 'x',
      type: 'text',
      title: 'T',
      position: { x: 80, y: 120 },
      isVisible: true,
      isLocked: false,
    });
    expect(node?.metadata).toMatchObject({ status: 'idle' });
    expect(result.project.draftVersion).toBe(2);
  });

  it('preserves one-step undo and redo for a batch mutation', () => {
    const project = createWorkflowProject('撤销重做');
    const applied = applyWorkflowMutation(project, envelope(project.id));
    expect(applied.ok).toBe(true);
    if (applied.ok === false) throw new Error(applied.error.message);

    const undone = undoWorkflowDraftChangeSet(applied.project);
    expect(undone.ok).toBe(true);
    if (undone.ok === false) throw new Error(undone.error.message);
    expect(undone.project.nodes).toEqual([]);

    const redone = redoWorkflowDraftChangeSet(undone.project);
    expect(redone.ok).toBe(true);
    if (redone.ok === false) throw new Error(redone.error.message);
    expect(redone.project.nodes.map(node => node.id)).toEqual(['source-1', 'shot-1']);
    expect(redone.project.connections).toHaveLength(1);
  });
});
