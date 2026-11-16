import { describe, expect, it } from 'vitest';
import { buildRunPlanView, isRunPlanRequest, runPlanApproved, runPlanItemStatus, runPlanNodeIds } from '../components/agent/agentRunPlan';
import { CONFIRM_DENIED_MESSAGE, readConfirmVerdict, runPlanDenialNote } from '../services/runApproval';
import type { AgentConfirmRequest } from '../services/agentSpendMandate';
import type { GenerationGateDetails } from '../services/generationGate';
import type { WorkflowNode } from '../components/workflow/types';

const gate = (extra: Partial<GenerationGateDetails> = {}) => ({ serviceLabel: 'RunningHub', modelLabel: 'image-g-2', mediaType: 'image', taskCount: 1, ...extra }) as GenerationGateDetails;
const node = (id: string, extra: Partial<WorkflowNode> = {}, metadata: WorkflowNode['metadata'] = {}) => ({
  id, type: 'image', title: id.toUpperCase(), position: { x: 0, y: 0 }, width: 100, height: 100, ...extra, metadata,
}) as WorkflowNode;
const request = (nodeIds: string[], gates = nodeIds.map(() => gate())): AgentConfirmRequest => ({ kind: 'generation', command: 'workflow.node.run', args: { nodeIds }, gates });

describe('run plan card view model', () => {
  it('only takes over generation run confirmations that carry gates', () => {
    expect(isRunPlanRequest(request(['a', 'b']))).toBe(true);
    expect(isRunPlanRequest({ ...request(['a']), gates: [] })).toBe(false);
    expect(isRunPlanRequest({ kind: 'destructive', command: 'workflow.node.delete' })).toBe(false);
    expect(isRunPlanRequest(undefined)).toBe(false);
  });

  it('dedupes node ids and falls back to nodeId', () => {
    expect(runPlanNodeIds(request(['a', 'b', 'a']))).toEqual(['a', 'b']);
    expect(runPlanNodeIds({ kind: 'generation', command: 'workflow.node.run', args: { nodeId: 'x' } })).toEqual(['x']);
  });

  it('derives model, group and chips from the existing plan data', () => {
    const group = node('g', { type: 'subgraph' as WorkflowNode['type'], title: '真实会议摄影三机位补充' }, { groupKind: 'group' });
    const nodes = [group, node('a', { parentId: 'g' }), node('b', { parentId: 'g', title: '' })];
    const view = buildRunPlanView({ request: request(['a', 'b'], [gate(), gate({ nodeTitle: '舞台侧前方45度' })]), nodes });
    expect(view).toMatchObject({ model: 'image-g-2', groupName: '真实会议摄影三机位补充', total: 2, done: 0, phase: 'pending' });
    expect(view.items.map(item => item.title)).toEqual(['A', '舞台侧前方45度']);
  });

  it('hides rows it cannot derive', () => {
    const view = buildRunPlanView({ request: request(['a', 'b'], [gate({ modelLabel: '' }), gate({ modelLabel: ' ' })]), nodes: [node('a', { parentId: 'g1' }), node('b')] });
    expect(view.model).toBeUndefined();
    expect(view.groupName).toBeUndefined();
    // 分组不是用户分组框（逆向子画布）时也不显示
    const reverse = node('g', { type: 'subgraph' as WorkflowNode['type'], title: '逆向' });
    expect(buildRunPlanView({ request: request(['a']), nodes: [reverse, node('a', { parentId: 'g' })] }).groupName).toBeUndefined();
  });

  it('joins several models', () => {
    expect(buildRunPlanView({ request: request(['a', 'b'], [gate(), gate({ modelLabel: 'seedance' })]), nodes: [] }).model).toBe('image-g-2、seedance');
  });

  it('tracks progress after approval and ignores results from before it', () => {
    const decidedAt = 1000;
    const nodes = [
      node('a', {}, { status: 'success', generationStartedAt: 1200 }),
      node('b', {}, { status: 'loading' }),
      node('c', {}, { status: 'success', generationStartedAt: 500 }),
    ];
    const running = buildRunPlanView({ request: request(['a', 'b', 'c']), nodes, decision: 'auto', decidedAt });
    expect(running).toMatchObject({ phase: 'running', done: 1, total: 3 });
    expect(running.items.map(item => item.status)).toEqual(['done', 'running', 'idle']);

    const finished = buildRunPlanView({
      request: request(['a', 'b']),
      nodes: [node('a', {}, { status: 'success', generationStartedAt: 1200 }), node('b', {}, { status: 'success' })],
      decision: 'auto', decidedAt,
    });
    expect(finished).toMatchObject({ phase: 'done', done: 2 });

    const failed = buildRunPlanView({
      request: request(['a', 'b']),
      nodes: [node('a', {}, { status: 'success', generationStartedAt: 1200 }), node('b', {}, { status: 'error', generationStartedAt: 1300 })],
      decision: 'auto', decidedAt,
    });
    expect(failed).toMatchObject({ phase: 'failed', done: 1, failed: 1 });
  });

  it('does not track progress for the non-running choices', () => {
    const nodes = [node('a', {}, { status: 'success' })];
    expect(buildRunPlanView({ request: request(['a']), nodes, decision: 'manual', decidedAt: 1 })).toMatchObject({ phase: 'manual', done: 0 });
    expect(buildRunPlanView({ request: request(['a']), nodes, decision: 'adjust', decidedAt: 1 }).phase).toBe('adjust');
    expect(runPlanItemStatus(undefined, 1)).toBe('idle');
    expect(runPlanItemStatus(nodes[0])).toBe('idle');
  });

  it('maps choices onto the existing approval verdict', () => {
    expect(runPlanApproved('auto')).toBe(true);
    expect(runPlanApproved('manual')).toBe(false);
    expect(runPlanApproved('adjust')).toBe(false);
    expect(readConfirmVerdict(true)).toEqual({ approved: true, message: '' });
    expect(readConfirmVerdict(false)).toEqual({ approved: false, message: CONFIRM_DENIED_MESSAGE });
    const manual = runPlanDenialNote('manual', 3);
    expect(manual).toContain('3 个节点已保留');
    expect(readConfirmVerdict({ approved: false, note: manual })).toEqual({ approved: false, message: manual });
    expect(readConfirmVerdict({ approved: false, note: '  ' }).message).toBe(CONFIRM_DENIED_MESSAGE);
    expect(runPlanDenialNote('adjust', 2)).toContain('调整后再创建');
  });
});

describe('kernel honours the plan card verdict', () => {
  it('throws the plan card note to the Agent instead of a bare denial', async () => {
    const { createBrowserAgentTools } = await import('../services/browserAgentKernel');
    const { createWorkflowProject, useWorkflowStore } = await import('../components/workflow/store');
    const { createWorkflowNode } = await import('../components/workflow/constants');
    const image = createWorkflowNode('image-1', 'image', { x: 0, y: 0 });
    const project = { ...createWorkflowProject('计划卡'), id: 'project-plan-verdict', nodes: [image] };
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const note = runPlanDenialNote('adjust', 1);
    const tool = createBrowserAgentTools({ projectId: project.id, confirm: async () => ({ approved: false as const, note }), activeChangeSetId: 't', getApproval: () => ({ mode: 'always-ask' }) })
      .find(item => item.label === 'workflow.apply')!;
    await expect(tool.execute('c1', { operations: [{ type: 'update_node', id: 'image-1', patch: { title: '新' } }] } as never, undefined as never)).rejects.toThrow('调整后再创建');
    const plain = createBrowserAgentTools({ projectId: project.id, confirm: async () => false, activeChangeSetId: 't', getApproval: () => ({ mode: 'always-ask' }) })
      .find(item => item.label === 'workflow.apply')!;
    await expect(plain.execute('c2', { operations: [{ type: 'update_node', id: 'image-1', patch: { title: '新' } }] } as never, undefined as never)).rejects.toThrow(CONFIRM_DENIED_MESSAGE);
  });
});
