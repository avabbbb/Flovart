import { describe, expect, it, vi } from 'vitest';
import { estimateRunCost } from '../services/runApproval';
import { createWorkflowDispatcher, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { toolApprovalFor } from '../services/agentToolPolicy';
import { agentToolCommand, getAgentToolSpecs } from '../tools/flovart/agent-tools.js';
import { AGENT_PUBLIC_COMMAND_SET } from '../tools/flovart/agent-surface.js';
import { createAgentTaskLayer as createLayer, TASKABLE_COMMANDS } from '../agent/task-layer.js';
import { describeAgentConfirmation } from '../components/agent/agentConfirmCopy';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';
import type { GenerationGateDetails } from '../services/generationGate';

const createAgentTaskLayer = createLayer as unknown as (options: Record<string, unknown>) => any;

const gate = (node: WorkflowNode, amount: number | null, extra: Partial<GenerationGateDetails> = {}): GenerationGateDetails => ({
  serviceLabel: 'RunningHub',
  modelLabel: 'seedance',
  mediaType: node.type === 'video' ? 'video' : 'image',
  taskCount: 1,
  estimatedCost: amount === null ? null : { amount, currency: 'CNY' },
  ...extra,
});

const nodes = [
  { ...createWorkflowNode('s1', 'image', { x: 0, y: 0 }, { prompt: '第一镜' }), title: '镜头1' },
  { ...createWorkflowNode('s2', 'video', { x: 0, y: 300 }, { prompt: '第二镜' }), title: '镜头2' },
  createWorkflowNode('note', 'text', { x: 0, y: 600 }, { content: '备注' }),
];

describe('estimateRunCost (pure)', () => {
  it('sums the same plan the approval card shows', () => {
    const estimate = estimateRunCost(nodes, ['s1', 's2', 's1'], node => gate(node, node.id === 's1' ? 0.5 : 2));
    expect('ok' in estimate).toBe(false);
    if ('ok' in estimate) return;
    expect(estimate.nodeIds).toEqual(['s1', 's2']);
    expect(estimate.items.map(item => [item.nodeId, item.mode, item.estimatedCost?.amount])).toEqual([['s1', 'image', 0.5], ['s2', 'video', 2]]);
    expect(estimate.total).toEqual({ tasks: 2, cost: { amount: 2.5, currency: 'CNY' } });
    expect(estimate.unknownCostNodeIds).toEqual([]);
    expect(estimate.summary).toBe('批准运行这 2 个节点（各一次） · 共 2 个任务 · 预估 ¥2.50 · 一次确认覆盖整张清单');
  });

  it('reports unknown cost and blockers instead of guessing', () => {
    const estimate = estimateRunCost(nodes, ['s1', 's2'], node => node.id === 's1'
      ? gate(node, null)
      : gate(node, 1, { blockers: [{ code: 'reference-limit', message: '参考超限' }] }));
    if ('ok' in estimate) throw new Error('unexpected rejection');
    expect(estimate.total.cost).toBeNull();
    expect(estimate.unknownCostNodeIds).toEqual(['s1']);
    expect(estimate.blockedNodeIds).toEqual(['s2']);
    expect(estimate.items[1].blockers).toEqual(['参考超限']);
  });

  it('rejects the same lists the approval card rejects', () => {
    expect(estimateRunCost(nodes, ['s1', 'note'], node => gate(node, 1))).toMatchObject({ ok: false, code: 'NOTE_IS_ANNOTATION' });
    expect(estimateRunCost(nodes, ['zz'], node => gate(node, 1))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

const setup = () => {
  let projects: WorkflowProject[] = [createWorkflowProject('预估')];
  projects[0].nodes = [
    createWorkflowNode('s1', 'image', { x: 0, y: 0 }, { prompt: '第一镜' }),
    createWorkflowNode('s2', 'image', { x: 400, y: 0 }, { prompt: '第二镜' }),
  ];
  projects[0].connections = [{ id: 'c1', fromNodeId: 's1', toNodeId: 's2' }];
  const runNode = vi.fn();
  const dependencies: WorkflowDispatcherDependencies = {
    getState: () => ({ projects, activeProjectId: projects[0].id }),
    createProject: () => '', setActiveProject: () => {}, deleteProjects: () => {},
    updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
    executor: createWorkflowExecutor({ runNode: runNode as never, stopNode: vi.fn() }, { createRunId: () => 'r' }),
    getUserApiKeys: () => [],
  };
  return { dispatch: createWorkflowDispatcher(dependencies), runNode };
};

describe('workflow.cost.estimate', () => {
  it('estimates nodeIds read-only: no confirmation, no run', async () => {
    const { dispatch, runNode } = setup();
    const result = await dispatch({ id: 'e', command: 'workflow.cost.estimate', source: 'agent', args: { nodeIds: ['s1', 's2'] } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.confirmation).toBeUndefined();
    expect(result.result).toMatchObject({ nodeIds: ['s1', 's2'], total: { tasks: 2, cost: null }, unknownCostNodeIds: ['s1', 's2'] });
    expect(runNode).not.toHaveBeenCalled();
  });

  it('estimates the members a group run would run, in the same order', async () => {
    const { dispatch } = setup();
    const created = await dispatch({ id: 'g', command: 'workflow.group.create', source: 'agent', idempotencyKey: 'g1', args: { nodeIds: ['s2', 's1'] } });
    const { groupId } = created.result as { groupId: string };
    const dry = await dispatch({ id: 'd', command: 'workflow.group.run', source: 'agent', args: { groupId, dryRun: true } });
    const estimate = await dispatch({ id: 'e', command: 'workflow.cost.estimate', source: 'agent', args: { groupId } });
    expect(estimate.ok, JSON.stringify(estimate.error)).toBe(true);
    expect((estimate.result as { nodeIds: string[] }).nodeIds).toEqual((dry.result as { order: string[] }).order);
    expect(estimate.result).toMatchObject({ groupId });
  });

  it('needs exactly one of nodeIds and groupId', async () => {
    const { dispatch } = setup();
    expect((await dispatch({ id: 'a', command: 'workflow.cost.estimate', source: 'agent', args: {} })).error?.code).toBe('BAD_REQUEST');
    expect((await dispatch({ id: 'b', command: 'workflow.cost.estimate', source: 'agent', args: { nodeIds: ['s1'], groupId: 'x' } })).error?.code).toBe('BAD_REQUEST');
    expect((await dispatch({ id: 'c', command: 'workflow.cost.estimate', source: 'agent', args: { groupId: 'missing' } })).error?.code).toBe('NOT_FOUND');
  });

  it('is a public, read-tier tool on every host', () => {
    expect(AGENT_PUBLIC_COMMAND_SET.has('workflow.cost.estimate')).toBe(true);
    expect(agentToolCommand('flovart_cost_estimate')).toBe('workflow.cost.estimate');
    expect(agentToolCommand('flovart_estimate_cost')).toBe('workflow.cost.estimate');
    expect(toolApprovalFor('workflow.cost.estimate', { nodeIds: ['s1'] })).toEqual({ tier: 'read' });
    for (const host of ['builtin', 'local', 'mcp', 'dsh']) {
      expect(getAgentToolSpecs(host).some((spec: { command: string }) => spec.command === 'workflow.cost.estimate')).toBe(true);
    }
  });
});

describe('group run approval card', () => {
  it('shows the per-node plan and one total, like a batch run', () => {
    const copy = describeAgentConfirmation({
      kind: 'generation',
      command: 'workflow.group.run',
      args: { groupId: 'g' },
      gates: [gate(nodes[0], 1), gate(nodes[1], 2)],
    }, nodes, 'zho');
    expect(copy).toEqual({ title: '批准运行这 2 个节点（各一次）', detail: '共 2 个任务 · 预估 ¥3.00 · 一次确认覆盖整张清单' });
  });
});

describe('async group run (agent.task.*)', () => {
  it('can start workflow.group.run in the background', async () => {
    expect(TASKABLE_COMMANDS).toContain('workflow.group.run');
    const run = vi.fn(() => new Promise(() => {}));
    const layer = createAgentTaskLayer({ run });
    const started = layer.start({ command: 'workflow.group.run', args: { groupId: 'g1' }, idempotencyKey: 'k' });
    expect(started).toMatchObject({ status: 'queued', done: false });
    expect(layer.start({ command: 'workflow.group.run', args: { groupId: 'g1' }, idempotencyKey: 'k' }).taskId).toBe(started.taskId);
  });

  it('stops every group member on cancel, resolved from the same run list', async () => {
    const stop = vi.fn(async (command: string, args: Record<string, unknown>) => (
      command === 'workflow.cost.estimate' ? { ok: true, result: { nodeIds: ['s1', 's2'] } } : { ok: true, result: { nodeId: args.nodeId } }
    ));
    const layer = createAgentTaskLayer({ run: () => new Promise(() => {}), stop });
    const started = layer.start({ command: 'workflow.group.run', args: { groupId: 'g1', projectId: 'p' } });
    await Promise.resolve(); await Promise.resolve();
    const cancelled = await layer.cancel({ taskId: started.taskId });
    expect(stop).toHaveBeenNthCalledWith(1, 'workflow.cost.estimate', { groupId: 'g1', projectId: 'p' }, 'agent', undefined);
    expect(stop).toHaveBeenCalledWith('workflow.node.stop', { nodeId: 's1', projectId: 'p' }, 'agent', undefined);
    expect(stop).toHaveBeenCalledWith('workflow.node.stop', { nodeId: 's2', projectId: 'p' }, 'agent', undefined);
    expect(cancelled.stoppedNodeIds).toEqual(['s1', 's2']);
  });
});
