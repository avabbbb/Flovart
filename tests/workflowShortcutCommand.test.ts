import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDispatcher, withWorkflowHumanApproval, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { toolApprovalFor } from '../services/agentToolPolicy';
import { paidUnits } from '../agent/session-budget.js';
import { AGENT_TOOL_SPEC_BY_COMMAND, agentToolCommand } from '../tools/flovart/agent-tools.js';
import { AGENT_PUBLIC_COMMAND_SET } from '../tools/flovart/agent-surface.js';
import type { WorkflowProject } from '../components/workflow/types';

const setup = (runNode = vi.fn()) => {
  let projects: WorkflowProject[] = [createWorkflowProject('快捷')];
  projects[0].nodes = [
    createWorkflowNode('img-a', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png', storageKey: 'a', mimeType: 'image/png' }),
    createWorkflowNode('note-1', 'text', { x: 0, y: 800 }, { content: '备注' }),
  ];
  let activeProjectId: string | null = projects[0].id;
  const dependencies: WorkflowDispatcherDependencies = {
    getState: () => ({ projects, activeProjectId }),
    createProject: () => { throw new Error('unused'); },
    setActiveProject: id => { activeProjectId = id; },
    deleteProjects: () => {},
    updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
    executor: createWorkflowExecutor({ runNode: runNode as Parameters<typeof createWorkflowExecutor>[0]['runNode'], stopNode: vi.fn() }, { createRunId: () => 'run-1' }),
    getUserApiKeys: () => [],
  };
  return { dispatch: createWorkflowDispatcher(dependencies), project: () => dependencies.getState().projects[0], runNode };
};

describe('workflow.shortcut.*', () => {
  it('lists the registry with stable scenes', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'l', command: 'workflow.shortcut.list', source: 'agent', args: {} });
    expect(result.ok).toBe(true);
    const shortcuts = (result.result as { shortcuts: Array<{ scene: string; kind: string }> }).shortcuts;
    expect(shortcuts.map(item => item.scene)).toContain('multi-camera-9');
    expect(shortcuts.find(item => item.scene === 'lighting-fix')?.kind).toBe('single');
  });

  it('applies a grid shortcut to a bare image: one new node to the right, count 1, no run', async () => {
    const { dispatch, project, runNode } = setup();
    const result = await dispatch({ id: 'a', command: 'workflow.shortcut.apply', source: 'agent', idempotencyKey: 'grid-1', args: { scene: 'multi-camera-9', nodeId: 'img-a' } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const body = result.result as { nodeId: string; placement: string; created: boolean; ran: boolean; grid: unknown };
    expect(body).toMatchObject({ placement: 'new-node', created: true, ran: false, grid: { rows: 3, cols: 3 }, scene: 'multi-camera-9' });
    const after = project();
    expect(after.nodes).toHaveLength(3);
    const created = after.nodes.find(node => node.id === body.nodeId)!;
    expect(created.metadata.config?.count).toBe(1);
    expect(created.position.x).toBeGreaterThan(0);
    expect(after.connections).toEqual([expect.objectContaining({ fromNodeId: 'img-a', toNodeId: body.nodeId })]);
    expect(runNode).not.toHaveBeenCalled();

    const replay = await dispatch({ id: 'a2', command: 'workflow.shortcut.apply', source: 'agent', idempotencyKey: 'grid-1', args: { scene: 'multi-camera-9', nodeId: 'img-a' } });
    expect(replay.ok).toBe(true);
    expect(project().nodes).toHaveLength(3);
  });

  it('gates run=true behind confirmation and runs exactly one node after approval', async () => {
    const runNode = vi.fn().mockResolvedValue({ artifact: { artifactId: 'run-1', kind: 'image', mimeType: 'image/png' } });
    const { dispatch } = setup(runNode);
    const args = { scene: 'lighting-fix', nodeId: 'img-a', run: true };
    const gated = await dispatch({ id: 'r', command: 'workflow.shortcut.apply', source: 'agent', idempotencyKey: 'r1', args });
    expect(gated.confirmation?.required).toBe(true);
    expect(runNode).not.toHaveBeenCalled();
    const approved = await dispatch(withWorkflowHumanApproval({ id: 'r', command: 'workflow.shortcut.apply', source: 'agent', idempotencyKey: 'r2', args }));
    expect(approved.ok, JSON.stringify(approved.error)).toBe(true);
    expect(runNode).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown scenes, notes and missing sources with structured codes', async () => {
    const { dispatch } = setup();
    const unknown = await dispatch({ id: 'u', command: 'workflow.shortcut.apply', source: 'agent', args: { scene: 'nope' } });
    expect(unknown.error?.code).toBe('NOT_FOUND');
    const note = await dispatch({ id: 'n', command: 'workflow.shortcut.apply', source: 'agent', args: { scene: 'lighting-fix', nodeId: 'note-1' } });
    expect(note.error?.code).toBe('NOTE_IS_ANNOTATION');
    const missing = await dispatch({ id: 'm', command: 'workflow.shortcut.apply', source: 'agent', args: { scene: 'portrait-enhance' } });
    expect(missing.error?.code).toBe('NEEDS_SOURCE');
  });

  it('is registered once for every host with the same approval and budget rules as generate', () => {
    expect(AGENT_PUBLIC_COMMAND_SET.has('workflow.shortcut.apply')).toBe(true);
    expect(AGENT_PUBLIC_COMMAND_SET.has('workflow.shortcut.list')).toBe(true);
    expect(agentToolCommand('flovart_shortcut_apply')).toBe('workflow.shortcut.apply');
    expect(AGENT_TOOL_SPEC_BY_COMMAND['workflow.shortcut.apply'].inputSchema.required).toEqual(['scene']);
    expect(toolApprovalFor('workflow.shortcut.list')).toEqual({ tier: 'read' });
    expect(toolApprovalFor('workflow.shortcut.apply', {}).tier).toBe('write');
    expect(toolApprovalFor('workflow.shortcut.apply', { run: true }).hardGate).toBe('spend');
    expect(paidUnits('workflow.shortcut.apply', {})).toBe(0);
    expect(paidUnits('workflow.shortcut.apply', { run: true })).toBe(1);
  });
});
