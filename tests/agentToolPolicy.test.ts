import { describe, expect, it } from 'vitest';
import { decideToolCall, policyForMode, toolRiskFor } from '../services/agentToolPolicy';
import { workflowCommandNeedsConfirmation } from '../services/workflowDispatcher';

describe('agent tool policy', () => {
  it('maps the two composer modes onto sandbox and approval', () => {
    expect(policyForMode('manual')).toEqual({ sandbox: 'workspace-write', approval: 'untrusted' });
    expect(policyForMode('auto')).toEqual({ sandbox: 'workspace-write', approval: 'on-request' });
  });

  it('asks on every write in untrusted mode and only on run/delete on request', () => {
    const untrusted = { sandbox: 'workspace-write', approval: 'untrusted' } as const;
    const onRequest = { sandbox: 'workspace-write', approval: 'on-request' } as const;
    expect(decideToolCall({ ...untrusted, risk: 'write' }).decision).toBe('ask');
    expect(decideToolCall({ ...onRequest, risk: 'write' }).decision).toBe('allow');
    expect(decideToolCall({ ...onRequest, risk: 'delete' }).decision).toBe('ask');
    expect(decideToolCall({ ...onRequest, risk: 'run' }).decision).toBe('ask');
    expect(decideToolCall({ ...onRequest, risk: 'read' }).decision).toBe('allow');
  });

  it('read-only denies mutations and network but keeps reads and local search', () => {
    const readOnly = { sandbox: 'read-only', approval: 'never' } as const;
    expect(decideToolCall({ ...readOnly, risk: 'write' })).toMatchObject({ decision: 'deny' });
    expect(decideToolCall({ ...readOnly, risk: 'run' })).toMatchObject({ decision: 'deny' });
    expect(decideToolCall({ ...readOnly, risk: 'network' })).toMatchObject({ decision: 'deny' });
    expect(decideToolCall({ ...readOnly, risk: 'read' }).decision).toBe('allow');
    expect(decideToolCall({ ...readOnly, risk: 'filesystem-read' }).decision).toBe('allow');
  });

  it('classifies commands by what they can do', () => {
    expect(toolRiskFor('workflow.inspect')).toBe('read');
    expect(toolRiskFor('flovart_workflow_media_view')).toBe('read');
    expect(toolRiskFor('workflow.apply', { operations: [{ type: 'update_node', id: 'n1', patch: { title: 'x' } }] })).toBe('write');
    expect(toolRiskFor('workflow.apply', { operations: [{ type: 'delete_nodes', ids: ['n1'] }] })).toBe('delete');
    expect(toolRiskFor('workflow.apply', { operations: [{ type: 'delete_connections', ids: ['c1'] }] })).toBe('delete');
    expect(toolRiskFor('workflow.node.run')).toBe('run');
    expect(toolRiskFor('workflow.node.delete')).toBe('delete');
    expect(toolRiskFor('workflow.node.stop')).toBe('read');
    expect(toolRiskFor('workflow.select')).toBe('read');
    expect(toolRiskFor('flovart_web_search')).toBe('network');
    expect(toolRiskFor('flovart_grep')).toBe('filesystem-read');
    expect(toolRiskFor('unknown.command')).toBe('write');
  });

  it('knows which commands already confirm themselves, so the policy does not double-ask', () => {
    expect(workflowCommandNeedsConfirmation('workflow.apply', { operations: [{ type: 'delete_nodes', ids: ['n'] }] })).toBe(true);
    expect(workflowCommandNeedsConfirmation('workflow.apply', { operations: [{ type: 'update_node', id: 'n', patch: { title: 'x' } }] })).toBe(false);
    expect(workflowCommandNeedsConfirmation('workflow.node.run', { nodeId: 'n' })).toBe(true);
    expect(workflowCommandNeedsConfirmation('workflow.inspect', {})).toBe(false);
  });
});
