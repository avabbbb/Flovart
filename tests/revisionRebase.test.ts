import { describe, expect, it } from 'vitest';
import { checkRevision, commandTargetNodeIds } from '../components/workflow/revisionRebase';
import { createWorkflowProject } from '../components/workflow/store';
import { WorkspaceLeaseManager } from '../agent/workspace-lease.js';

const project = (changedIds: string[]) => ({
  ...createWorkflowProject('rebase'),
  draftVersion: 22,
  draftChangeSets: [{ id: 'cs', resultDraftVersion: 22, nodeChanges: changedIds.map(id => ({ id })), connectionChanges: [] }],
}) as never;

describe('per-node revision check', () => {
  it('lets a node-scoped command through when only other nodes changed (field test: v21 read, UI drag → v22)', () => {
    expect(checkRevision(project(['dragged']), 'workflow.node.update', { nodeId: 'target' }, 21)).toMatchObject({ ok: true, changedObjectIds: ['dragged'] });
    expect(checkRevision(project(['target']), 'workflow.node.update', { nodeId: 'target' }, 21)).toMatchObject({ ok: false, conflictingIds: ['target'] });
  });

  it('keeps whole-draft semantics for structural commands and future revisions', () => {
    expect(checkRevision(project(['dragged']), 'workflow.node.delete', { nodeId: 'target' }, 21).ok).toBe(false);
    expect(checkRevision(project([]), 'workflow.node.update', { nodeId: 'target' }, 23).ok).toBe(false);
    expect(commandTargetNodeIds('workflow.apply', { operations: [{ type: 'update_node', id: 'a' }, { type: 'add_node', node: {} }] })).toBeNull();
    expect(commandTargetNodeIds('workflow.node.run', { nodeIds: 'a,b' })).toEqual(['a', 'b']);
  });

  it('the local agent lease defers node-scoped revision checks and marks conflicts retryable', () => {
    const manager = new WorkspaceLeaseManager({ idFactory: () => 'lease-1' as never });
    const lease = manager.acquire({ agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', baseRevision: 21 });
    const context = { leaseId: lease.leaseId, agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', currentClientId: 'browser-a', currentProjectId: 'project-a', expectedRevision: 21, currentRevision: 22, mutation: true, mutationId: 'm-1' };
    expect(() => manager.validate({ ...context, deferRevision: true })).not.toThrow();
    let error: { toJSON(): { retryable: boolean; code: string } } | undefined;
    try { manager.validate(context); } catch (cause) { error = cause as never; }
    expect(error?.toJSON()).toMatchObject({ code: 'REVISION_CONFLICT', retryable: true });
  });
});
