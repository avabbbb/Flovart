import { describe, expect, it, vi } from 'vitest';
import { terminalFromFailure, terminalFromRunResult, terminalStatusForCode } from '../services/workflowRunTerminal';
import { createWorkflowDispatcher, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';

describe('workflow run terminal states', () => {
  it('maps every outcome onto succeeded / failed / timeout / unknown_after_submit', () => {
    expect(terminalFromRunResult({ runId: 'r', status: 'completed' })).toMatchObject({ status: 'succeeded', runId: 'r', retryable: false });
    expect(terminalFromRunResult({ runId: 'r', status: 'cancelled' })).toMatchObject({ status: 'failed', failedReason: { code: 'RUN_CANCELLED' }, retryable: true });
    expect(terminalFromRunResult({ runId: 'r', status: 'failed', error: { code: 'SEEDANCE_SUBMISSION_UNKNOWN', message: '提交结果未知' } }))
      .toMatchObject({ status: 'unknown_after_submit', retryable: false, failedReason: { code: 'SEEDANCE_SUBMISSION_UNKNOWN' } });
    expect(terminalFromFailure('WORKSPACE_TIMEOUT', '超时')).toMatchObject({ status: 'timeout', retryable: false });
    expect(terminalStatusForCode('COMMAND_TIMEOUT')).toBe('timeout');
    expect(terminalStatusForCode('PROVIDER_REQUEST_FAILED')).toBe('failed');
    expect(terminalStatusForCode(undefined)).toBe('failed');
    expect(terminalFromFailure('SEEDANCE_SUBMISSION_UNKNOWN', 'x').next).toContain('不要重试');
  });

  it('reports the unified status through workflow.node.run, single and batch', async () => {
    let projects: WorkflowProject[] = [createWorkflowProject('t')];
    projects[0].nodes = [createWorkflowNode('a', 'image', { x: 0, y: 0 }), createWorkflowNode('b', 'image', { x: 0, y: 300 })];
    const runNode = vi.fn(async ({ nodeId }: { nodeId: string }) => {
      if (nodeId === 'b') throw Object.assign(new Error('提交结果未知'), { code: 'SEEDANCE_SUBMISSION_UNKNOWN' });
      return { status: 'completed' as const };
    });
    const dependencies: WorkflowDispatcherDependencies = {
      getState: () => ({ projects, activeProjectId: projects[0].id }),
      createProject: () => '', setActiveProject: () => {}, deleteProjects: () => {},
      updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
      executor: createWorkflowExecutor({ runNode: runNode as never, stopNode: vi.fn() }, { createRunId: () => 'run-x' }),
    };
    const dispatch = createWorkflowDispatcher(dependencies);
    const single = await dispatch({ id: 's', command: 'workflow.node.run', source: 'cli', args: { nodeId: 'a' } });
    expect(single.result).toMatchObject({ status: 'succeeded', runId: 'run-x' });
    const unknown = await dispatch({ id: 'u', command: 'workflow.node.run', source: 'cli', args: { nodeId: 'b' } });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.code).toBe('SEEDANCE_SUBMISSION_UNKNOWN');
    expect(unknown.error?.details).toMatchObject({ run: { status: 'unknown_after_submit', retryable: false } });
    const batch = await dispatch({ id: 'b2', command: 'workflow.node.run', source: 'cli', args: { nodeIds: ['a', 'b'] } });
    const runs = (batch.result as { runs: Array<{ nodeId: string; status: string }> }).runs;
    expect(runs.map(run => [run.nodeId, run.status])).toEqual([['a', 'succeeded'], ['b', 'unknown_after_submit']]);
  });
});
