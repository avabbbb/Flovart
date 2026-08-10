import { describe, expect, it } from 'vitest';
import {
  bindProductionDraftEnvelope,
  prepareRuntimeAgentEnvelope,
  redactWorkflowAgentSnapshot,
  requiresRuntimeAgentConfirmation,
  runtimeAgentConfirmationSummary,
  validateWorkflowAgentAttachments,
} from '../services/workflowAgentBridge';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject } from '../components/workflow/store';

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

  it('accepts bounded image attachments and rejects other payloads', () => {
    expect(() => validateWorkflowAgentAttachments([{ id: '1', name: 'a.png', type: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AAA=' }])).not.toThrow();
    expect(() => validateWorkflowAgentAttachments([{ id: '1', name: 'a.txt', type: 'text/plain', size: 3, dataUrl: 'data:text/plain;base64,AAA=' }])).toThrow('仅支持图片');
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
