import { describe, expect, it, vi } from 'vitest';
import { describeRunApproval, planRunApproval } from '../services/runApproval';
import { describeAgentConfirmation } from '../components/agent/agentConfirmCopy';
import { createWorkflowDispatcher, withWorkflowHumanApproval, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { agentToolCommand } from '../tools/flovart/agent-tools.js';
import type { WorkflowProject } from '../components/workflow/types';
import type { GenerationGateDetails } from '../services/generationGate';

const nodes = [
  { ...createWorkflowNode('s1', 'image', { x: 0, y: 0 }), title: '镜头1' },
  { ...createWorkflowNode('s2', 'video', { x: 0, y: 300 }), title: '镜头2' },
  createWorkflowNode('note', 'text', { x: 0, y: 600 }, { content: '备注' }),
  createWorkflowNode('aud', 'audio', { x: 0, y: 900 }),
];
const gate = (amount: number): GenerationGateDetails => ({ serviceLabel: 'RH', modelLabel: 'M', mediaType: 'image', taskCount: 1, estimatedCost: { amount, currency: 'CNY' } });

describe('run approval (build then approve once)', () => {
  it('dedupes the list and rejects notes, non-generation and missing nodes', () => {
    expect(planRunApproval(nodes, ['s1', 's2', 's1'])).toMatchObject({ ok: true, nodeIds: ['s1', 's2'], items: [{ nodeId: 's1', mode: 'image' }, { nodeId: 's2', mode: 'video' }] });
    expect(planRunApproval(nodes, ['s1', 'note'])).toMatchObject({ ok: false, code: 'NOTE_IS_ANNOTATION', nodeIds: ['note'] });
    expect(planRunApproval(nodes, ['aud'])).toMatchObject({ ok: false, code: 'NOT_RUNNABLE' });
    expect(planRunApproval(nodes, ['zz'])).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('sums the cost once for the whole list', () => {
    expect(describeRunApproval(2, [gate(0.5), gate(1)], 'zho')).toEqual({ title: '批准运行这 2 个节点（各一次）', detail: '共 2 个任务 · 预估 ¥1.50 · 一次确认覆盖整张清单' });
    expect(describeRunApproval(3, [], 'en').detail).toContain('cost unknown');
    const copy = describeAgentConfirmation({ kind: 'generation', command: 'workflow.node.run', args: { nodeIds: ['s1', 's2'] }, gates: [gate(1), gate(1)] }, nodes, 'zho');
    expect(copy.title).toBe('批准运行这 2 个节点（各一次）');
  });

  it('exposes flovart_approve_run as the batch-run tool', () => {
    expect(agentToolCommand('flovart_approve_run')).toBe('workflow.node.run');
  });

  it('refuses an unrunnable list before asking, then runs each approved node once', async () => {
    let projects: WorkflowProject[] = [createWorkflowProject('t')];
    projects[0].nodes = [...nodes];
    const runNode = vi.fn(async () => ({ status: 'completed' as const }));
    const dependencies: WorkflowDispatcherDependencies = {
      getState: () => ({ projects, activeProjectId: projects[0].id }),
      createProject: () => '', setActiveProject: () => {}, deleteProjects: () => {},
      updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
      executor: createWorkflowExecutor({ runNode: runNode as never, stopNode: vi.fn() }, { createRunId: () => 'r' }),
    };
    const dispatch = createWorkflowDispatcher(dependencies);
    const bad = await dispatch({ id: 'b', command: 'workflow.node.run', source: 'agent', args: { nodeIds: ['s1', 'note'] } });
    expect(bad.confirmation).toBeUndefined();
    expect(bad.error?.code).toBe('NOTE_IS_ANNOTATION');
    const asked = await dispatch({ id: 'a', command: 'workflow.node.run', source: 'agent', args: { nodeIds: ['s1', 's2', 's1'] } });
    expect(asked.confirmation?.required).toBe(true);
    const ran = await dispatch(withWorkflowHumanApproval({ id: 'a', command: 'workflow.node.run', source: 'agent', args: { nodeIds: ['s1', 's2', 's1'] } }));
    expect(ran.ok).toBe(true);
    expect(runNode).toHaveBeenCalledTimes(2);
  });
});
