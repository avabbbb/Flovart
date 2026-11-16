import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDispatcher, withWorkflowHumanApproval, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { toolApprovalFor } from '../services/agentToolPolicy';
import { AGENT_PUBLIC_COMMAND_SET } from '../tools/flovart/agent-surface.js';
import { agentToolCommand } from '../tools/flovart/agent-tools.js';
import { isGroupFrame } from '../components/workflow/canvasGroups';
import type { WorkflowProject } from '../components/workflow/types';

const setup = (runNode = vi.fn().mockResolvedValue({ artifact: { artifactId: 'a', kind: 'image', mimeType: 'image/png' } })) => {
  let projects: WorkflowProject[] = [createWorkflowProject('分组')];
  projects[0].nodes = [
    createWorkflowNode('up', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/u.png', storageKey: 'u', mimeType: 'image/png' }),
    createWorkflowNode('s1', 'image', { x: 400, y: 0 }, { prompt: '第一镜' }),
    createWorkflowNode('s2', 'image', { x: 800, y: 0 }, { prompt: '第二镜' }),
  ];
  projects[0].connections = [
    { id: 'c1', fromNodeId: 'up', toNodeId: 's1' },
    { id: 'c2', fromNodeId: 's1', toNodeId: 's2' },
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

describe('workflow.group.*', () => {
  it('creates a group frame (not a batchId) idempotently', async () => {
    const { dispatch, project } = setup();
    const result = await dispatch({ id: 'g', command: 'workflow.group.create', source: 'agent', idempotencyKey: 'g1', args: { nodeIds: ['up', 's1', 's2'], title: '第一场' } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const { groupId, memberIds } = result.result as { groupId: string; memberIds: string[] };
    expect(memberIds).toEqual(['up', 's1', 's2']);
    const after = project();
    expect(isGroupFrame(after.nodes.find(node => node.id === groupId))).toBe(true);
    expect(after.nodes.filter(node => node.parentId === groupId)).toHaveLength(3);
    expect(after.nodes.some(node => node.batchId)).toBe(false);
    await dispatch({ id: 'g2', command: 'workflow.group.create', source: 'agent', idempotencyKey: 'g1', args: { nodeIds: ['up', 's1', 's2'], title: '第一场' } });
    expect(project().nodes.filter(node => node.type === 'subgraph')).toHaveLength(1);
  });

  it('rejects groups with fewer than two nodes', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'g', command: 'workflow.group.create', source: 'agent', args: { nodeIds: ['s1'] } });
    expect(result.error?.code).toBe('BAD_REQUEST');
  });

  it('runs a group in dependency order after one confirmation and dry-runs for free', async () => {
    const { dispatch, runNode } = setup();
    const created = await dispatch({ id: 'g', command: 'workflow.group.create', source: 'agent', idempotencyKey: 'g1', args: { nodeIds: ['s2', 'up', 's1'] } });
    const { groupId } = created.result as { groupId: string };

    const dry = await dispatch({ id: 'd', command: 'workflow.group.run', source: 'agent', args: { groupId, dryRun: true } });
    expect(dry.result).toMatchObject({ order: ['s1', 's2'], dryRun: true });
    expect(runNode).not.toHaveBeenCalled();

    const gated = await dispatch({ id: 'r', command: 'workflow.group.run', source: 'agent', idempotencyKey: 'r1', args: { groupId } });
    expect(gated.confirmation?.required).toBe(true);
    expect(runNode).not.toHaveBeenCalled();

    const approved = await dispatch(withWorkflowHumanApproval({ id: 'r', command: 'workflow.group.run', source: 'agent', idempotencyKey: 'r2', args: { groupId } }));
    expect(approved.ok, JSON.stringify(approved.error)).toBe(true);
    expect(runNode.mock.calls.map(call => call[0].nodeId)).toEqual(['s1', 's2']);
    expect(approved.result).toMatchObject({ order: ['s1', 's2'], failed: 0 });
  });

  it('skips downstream nodes when an upstream run fails', async () => {
    const runNode = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ artifact: { artifactId: 'a', kind: 'image', mimeType: 'image/png' } });
    const { dispatch } = setup(runNode);
    const created = await dispatch({ id: 'g', command: 'workflow.group.create', source: 'agent', idempotencyKey: 'g1', args: { nodeIds: ['up', 's1', 's2'] } });
    const { groupId } = created.result as { groupId: string };
    const result = await dispatch(withWorkflowHumanApproval({ id: 'r', command: 'workflow.group.run', source: 'agent', idempotencyKey: 'r', args: { groupId } }));
    expect(result.ok).toBe(false);
    expect(runNode).toHaveBeenCalledTimes(1);
  });

  it('is registered for every host with write / spend approval', () => {
    expect(AGENT_PUBLIC_COMMAND_SET.has('workflow.group.create')).toBe(true);
    expect(agentToolCommand('flovart_group_run')).toBe('workflow.group.run');
    expect(toolApprovalFor('workflow.group.create').tier).toBe('write');
    expect(toolApprovalFor('workflow.group.run', {}).hardGate).toBe('spend');
    expect(toolApprovalFor('workflow.group.run', { dryRun: true }).tier).toBe('read');
  });
});
