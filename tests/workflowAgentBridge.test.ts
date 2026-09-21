import { describe, expect, it, vi } from 'vitest';
import {
  bindProductionDraftEnvelope,
  prepareRuntimeAgentEnvelope,
  redactWorkflowAgentSnapshot,
  requiresRuntimeAgentConfirmation,
  runtimeAgentConfirmationSummary,
  validateBrowserWorkspaceLease,
} from '../services/workflowAgentBridge';
import type { WorkflowCommandEnvelope } from '../services/workflowDispatcher';
import { dispatchWorkflowCommand, setWorkflowExecutor, withWorkflowHumanApproval } from '../services/workflowDispatcher';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { createWorkflowExecutor } from '../services/workflowExecutor';

describe('workflow Agent browser bridge', () => {
  it('removes media payloads before sending state to loopback Agent', () => {
    const snapshot = redactWorkflowAgentSnapshot({
      id: 'project',
      nodes: [{ id: 'image', metadata: { href: 'data:image/png;base64,SECRET', poster: 'data:image/jpeg;base64,POSTER', storageKey: 'local/private', localPath: 'C:\\secret\\asset.png' } }],
    });
    expect(JSON.stringify(snapshot)).not.toContain('SECRET');
    expect(JSON.stringify(snapshot)).not.toContain('POSTER');
    expect(JSON.stringify(snapshot)).not.toContain('local/private');
    expect(JSON.stringify(snapshot)).not.toContain('secret\\asset');
  });

  it('sends a Browser Agent node run through the globally installed WorkflowExecutor', async () => {
    const project = createWorkflowProject('浏览器执行测试');
    project.id = 'project-browser-agent';
    project.nodes = [createWorkflowNode('image-1', 'image', { x: 0, y: 0 })];
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id, hydrated: true });
    const runNode = vi.fn().mockResolvedValue({ status: 'completed' });
    setWorkflowExecutor(createWorkflowExecutor({ runNode }, { createRunId: () => 'run-browser-agent' }));

    try {
      const result = await dispatchWorkflowCommand(withWorkflowHumanApproval({
        id: 'browser-agent-run',
        command: 'workflow.node.run',
        args: { projectId: project.id, nodeId: 'image-1' },
        source: 'agent',
      }));

      expect(result).toMatchObject({ ok: true, result: { projectId: project.id, nodeId: 'image-1', runId: 'run-browser-agent' } });
      expect(runNode).toHaveBeenCalledWith(
        { projectId: project.id, nodeId: 'image-1' },
        { surface: 'browser-agent', correlationId: 'browser-agent-run', runId: 'run-browser-agent' },
      );
    } finally {
      setWorkflowExecutor(undefined);
    }
  });

  it('routes Runtime writes with envelope idempotency and gates only paid or destructive actions', () => {
    const envelope = prepareRuntimeAgentEnvelope({
      id: 'command-1',
      command: 'production.run',
      source: 'agent',
      idempotencyKey: 'run-once',
      args: { runId: 'run-1', idempotencyKey: 'legacy-copy' },
    });

    expect(envelope.args).toEqual({ runId: 'run-1' });
    expect(envelope.idempotencyKey).toBe('run-once');
    expect(requiresRuntimeAgentConfirmation('production.dry-run')).toBe(false);
    expect(requiresRuntimeAgentConfirmation('production.status')).toBe(false);
    expect(requiresRuntimeAgentConfirmation('production.approve')).toBe(true);
    expect(requiresRuntimeAgentConfirmation('production.run')).toBe(true);
    expect(requiresRuntimeAgentConfirmation('task.cancel')).toBe(true);
    expect(runtimeAgentConfirmationSummary({
      id: 'approve-style',
      command: 'production.approve',
      source: 'agent',
      args: { gateType: 'style-reference', approvedStageKey: 'style:bakeoff:swiss-modern' },
    })).toContain('style:bakeoff:swiss-modern');
  });

  it('rejects a workflow command whose workspace lease has expired (lease blind-window re-check)', () => {
    const project = createWorkflowProject('Lease 测试');
    project.id = 'project-lease';
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id, hydrated: true });
    const envelope: WorkflowCommandEnvelope = {
      id: 'lease-1',
      command: 'workflow.node.run',
      source: 'agent',
      args: { projectId: project.id, nodeId: 'n1' },
      workspaceLease: {
        leaseId: 'lease-1',
        agentIdentity: 'codex',
        clientId: 'client-A',
        projectId: project.id,
        baseRevision: project.draftVersion || 1,
        issuedAt: 0,
        expiresAt: 1_000,
      },
    };
    // now = 2_000 > expiresAt 1_000 → lease expired even though the entry-time check passed earlier
    const result = validateBrowserWorkspaceLease(envelope, 'client-A', 2_000);
    expect(result?.error?.code).toBe('LEASE_EXPIRED');
  });

  it('freezes production.dry-run against the inspected visible Draft and source nodes', async () => {
    const node = { ...createWorkflowNode('brief-node', 'text', { x: 40, y: 60 }), objectVersion: 4 };
    const project = { ...createWorkflowProject('VOX 画布'), id: 'workflow-1', draftVersion: 7, nodes: [node] };
    const envelope = await bindProductionDraftEnvelope({
      id: 'compile-1',
      command: 'production.dry-run',
      source: 'agent',
      args: {
        projectId: project.id,
        draftBinding: { draftVersion: 7, sourceNodeIds: ['brief-node'] },
      },
    }, project);

    expect(envelope.args.draftBinding).toMatchObject({
      schemaVersion: 'flovart.workflow-draft-binding/1',
      projectId: 'workflow-1',
      draftVersion: 7,
      sourceNodeIds: ['brief-node'],
      objectVersions: { 'brief-node': 4 },
    });
    expect((envelope.args.draftBinding as any).snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(bindProductionDraftEnvelope({
      id: 'compile-stale',
      command: 'production.dry-run',
      source: 'agent',
      args: { projectId: project.id, draftBinding: { draftVersion: 6, sourceNodeIds: ['brief-node'] } },
    }, project)).rejects.toThrow('Draft 版本已变化');
  });
});
