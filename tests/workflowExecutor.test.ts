import { describe, expect, it, vi } from 'vitest';
import { buildCanonicalGenerationInput, resolveWorkflowInputs } from '../components/workflow/inputResolver';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowExecutor, normalizeWorkflowExecutionError } from '../services/workflowExecutor';
import { SeedanceSubmissionUnknownError } from '../services/aiGateway';

describe('workflow executor seam', () => {
  it('passes surface for tracing, creates a run identity, and preserves the workflow command', async () => {
    const runNode = vi.fn().mockResolvedValue(undefined);
    const executor = createWorkflowExecutor({ runNode }, { createRunId: () => 'run-1' });

    await expect(executor.runNode({ projectId: 'project-1', nodeId: 'node-1' }, { surface: 'browser-agent', correlationId: 'trace-1' })).resolves.toMatchObject({
      runId: 'run-1',
      projectId: 'project-1',
      nodeId: 'node-1',
    });

    expect(runNode).toHaveBeenCalledWith(
      { projectId: 'project-1', nodeId: 'node-1' },
      { surface: 'browser-agent', correlationId: 'trace-1', runId: 'run-1' },
    );
  });

  it('normalizes execution failures without changing their explicit error code', async () => {
    const failure = Object.assign(new Error('当前 API 线路不支持图生视频'), { code: 'UNSUPPORTED_INPUT_MODE' });
    const executor = createWorkflowExecutor({ runNode: vi.fn().mockRejectedValue(failure) }, { createRunId: () => 'run-failed' });

    await expect(executor.runNode({ projectId: 'project-1', nodeId: 'node-1' })).rejects.toMatchObject({
      name: 'WorkflowExecutionError',
      code: 'UNSUPPORTED_INPUT_MODE',
      runId: 'run-failed',
    });
  });

  it('preserves a failed adapter outcome for callers that keep the node error visible', async () => {
    const executor = createWorkflowExecutor({
      runNode: vi.fn().mockResolvedValue({
        status: 'failed',
        error: { code: 'PROVIDER_REQUEST_FAILED', message: 'Provider 暂时不可用。' },
      }),
    }, { createRunId: () => 'run-failed-outcome' });

    await expect(executor.runNode({ projectId: 'project-1', nodeId: 'node-1' })).resolves.toMatchObject({
      status: 'failed',
      error: { code: 'PROVIDER_REQUEST_FAILED', message: 'Provider 暂时不可用。' },
    });
  });

  it('produces one canonical input across UI, Browser Agent, CLI, and Runtime surfaces', async () => {
    const firstFrame = createWorkflowNode('A', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png' });
    const character = createWorkflowNode('C', 'image', { x: 0, y: 120 }, { href: 'https://cdn.example.com/c.png' });
    const target = createWorkflowNode('B', 'video', { x: 420, y: 0 }, { prompt: '人物缓慢转身' });
    const inputs = resolveWorkflowInputs(target, [firstFrame, character, target], [
      { id: 'a-edge', fromNodeId: 'A', toNodeId: 'B', role: 'source_image' },
      { id: 'c-edge', fromNodeId: 'C', toNodeId: 'B', role: 'reference_image' },
    ]);
    const canonicalInput = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '人物缓慢转身', mode: 'video', submode: 'image-to-video' });
    const runNode = vi.fn().mockImplementation(async (command) => ({
      runId: 'adapter-run',
      projectId: command.projectId,
      nodeId: command.nodeId,
      canonicalInput,
    }));
    let sequence = 0;
    const executor = createWorkflowExecutor({ runNode }, { createRunId: () => `run-${++sequence}` });
    const command = { projectId: 'project-1', nodeId: 'B' };

    const results = await Promise.all([
      executor.runNode(command, { surface: 'ui', correlationId: 'ui-run' }),
      executor.runNode(command, { surface: 'browser-agent', correlationId: 'agent-run' }),
      executor.runNode(command, { surface: 'cli', correlationId: 'cli-run' }),
      executor.runNode(command, { surface: 'runtime', correlationId: 'runtime-run' }),
    ]);

    expect(results.map(result => result.canonicalInput)).toEqual([canonicalInput, canonicalInput, canonicalInput, canonicalInput]);
    expect(canonicalInput).toMatchObject({
      capability: 'image-to-video',
      references: [
        { resource: { sourceNodeId: 'A' }, role: 'first_frame', order: 0 },
        { resource: { sourceNodeId: 'C' }, role: 'reference', order: 1 },
      ],
    });
    expect(runNode.mock.calls.map(([, context]) => context.surface)).toEqual(['ui', 'browser-agent', 'cli', 'runtime']);
  });
});

describe('workflow error code normalization', () => {
  it('keeps the Seedance submission-unknown code from the thrown error and from its persisted message', () => {
    const thrown = new SeedanceSubmissionUnknownError();
    expect(normalizeWorkflowExecutionError(thrown).code).toBe('SEEDANCE_SUBMISSION_UNKNOWN');
    expect(normalizeWorkflowExecutionError(new Error(thrown.message)).code).toBe('SEEDANCE_SUBMISSION_UNKNOWN');
  });

  it('does not infer UNSUPPORTED_INPUT_MODE or REVISION_CONFLICT from incidental words', () => {
    expect(normalizeWorkflowExecutionError(new Error('首帧上传失败，请重试')).code).not.toBe('UNSUPPORTED_INPUT_MODE');
    expect(normalizeWorkflowExecutionError(new Error('图生视频生成失败')).code).not.toBe('UNSUPPORTED_INPUT_MODE');
    expect(normalizeWorkflowExecutionError(new Error('API Key 已过期')).code).not.toBe('REVISION_CONFLICT');
  });

  it('still infers explicit unsupported-mode and revision messages', () => {
    expect(normalizeWorkflowExecutionError(new Error('当前线路不支持首帧输入')).code).toBe('UNSUPPORTED_INPUT_MODE');
    expect(normalizeWorkflowExecutionError(new Error('Workflow 草稿版本已变化：期望 2，当前 3。')).code).toBe('REVISION_CONFLICT');
  });
});
