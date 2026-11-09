import { describe, expect, it, vi } from 'vitest';
import { runWorkflowGeneration, stopOrphanedWorkflowNode, terminalGenerationPatch } from '../services/workflowGeneration';
import { deriveWorkflowGenerationPhase } from '../components/workflow/runState';
import type { UserApiKey } from '../types';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';

vi.mock('../utils/assetStorage', () => ({ getAssetById: vi.fn(async () => undefined) }));
vi.mock('../utils/mediaIndexedDB', () => ({ readColdMedia: vi.fn(async () => 'data:image/png;base64,QkJC') }));
vi.mock('../services/promptPreflight', () => ({
  runPreflight: vi.fn(async (prompt: string) => ({ optimizedPrompt: prompt, complianceWarnings: ['敏感词'] })),
}));

const IN_FLIGHT = ['generationRequestId', 'generationStartedAt', 'generationMessage', 'generationTransfer'] as const;

function expectInFlightCleared(patch: Record<string, unknown>) {
  for (const key of IN_FLIGHT) {
    expect(key in patch).toBe(true);
    expect(patch[key]).toBeUndefined();
  }
  expect('progress' in patch).toBe(true);
}

const node = (metadata: Partial<WorkflowNode['metadata']>): WorkflowNode => ({
  id: 'n1', type: 'config', title: '生成配置', position: { x: 0, y: 0 }, width: 300, height: 200,
  metadata: { status: 'loading', generationRequestId: 'run-1', generationStartedAt: 1, generationMessage: '供应商正在生成', progress: 40, ...metadata },
});

const projectWith = (nodes: WorkflowNode[]): WorkflowProject => ({
  id: 'project-t', title: 't', nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('terminalGenerationPatch', () => {
  it('succeeded clears in-flight fields and download flag', () => {
    const patch = terminalGenerationPatch({ kind: 'succeeded' });
    expectInFlightCleared(patch);
    expect(patch).toMatchObject({ status: 'success', error: undefined, progress: 100 });
    expect('generationDownloadPending' in patch && patch.generationDownloadPending === undefined).toBe(true);
    expect('generationProviderTaskId' in patch).toBe(false);
  });

  it('failed clears in-flight fields and keeps provider task id untouched', () => {
    const patch = terminalGenerationPatch({ kind: 'failed', error: '生成失败' });
    expectInFlightCleared(patch);
    expect(patch).toMatchObject({ status: 'error', error: '生成失败', progress: undefined });
    expect('generationProviderTaskId' in patch).toBe(false);
  });

  it('failed download keeps the upstream task and marks it pending', () => {
    const patch = terminalGenerationPatch({ kind: 'failed', error: '下载失败', download: { providerTaskId: 'task-9' } });
    expectInFlightCleared(patch);
    expect(patch).toMatchObject({ status: 'error', generationProviderTaskId: 'task-9', generationDownloadPending: true });
  });

  it('interrupted becomes an error and clears the start time too', () => {
    const patch = terminalGenerationPatch({ kind: 'interrupted', error: '页面刷新后生成已中断' });
    expectInFlightCleared(patch);
    expect(patch).toMatchObject({ status: 'error', error: '页面刷新后生成已中断', progress: undefined });
  });

  it('stopped without a submitted task returns to idle', () => {
    const patch = terminalGenerationPatch({ kind: 'stopped', node: node({}) });
    expectInFlightCleared(patch);
    expect(patch).toMatchObject({ status: 'idle', error: undefined, progress: undefined });
  });

  it('stopped with an unrefunded submitted task stays a visible billing-unknown error', () => {
    const patch = terminalGenerationPatch({ kind: 'stopped', node: node({ generationProviderTaskId: 'task-1', generationBillableState: 'actual' }) });
    expectInFlightCleared(patch);
    expect(patch).toMatchObject({ status: 'error', generationBillableState: 'unknown' });
    expect(String(patch.error)).toContain('计费');
  });

  it('stopped after a confirmed refund returns to idle', () => {
    const patch = terminalGenerationPatch({ kind: 'stopped', node: node({ generationProviderTaskId: 'task-1', generationBillableState: 'refunded' }) });
    expect(patch).toMatchObject({ status: 'idle' });
  });
});

describe('stopOrphanedWorkflowNode (App stop fallback)', () => {
  it('does not silently idle a loading node with a submitted provider task', () => {
    const next = stopOrphanedWorkflowNode(projectWith([node({ generationProviderTaskId: 'task-1' })]), 'n1');
    const meta = next?.nodes[0].metadata;
    expect(meta).toMatchObject({ status: 'error', generationBillableState: 'unknown', generationProviderTaskId: 'task-1' });
    expect(meta?.generationRequestId).toBeUndefined();
    expect(meta?.generationStartedAt).toBeUndefined();
    expect(meta?.progress).toBeUndefined();
  });

  it('frees a loading node without a provider task to idle', () => {
    const next = stopOrphanedWorkflowNode(projectWith([node({})]), 'n1');
    expect(next?.nodes[0].metadata).toMatchObject({ status: 'idle', generationRequestId: undefined, progress: undefined });
  });

  it('leaves non-loading or missing nodes alone', () => {
    expect(stopOrphanedWorkflowNode(projectWith([node({ status: 'success' })]), 'n1')).toBeNull();
    expect(stopOrphanedWorkflowNode(projectWith([]), 'n1')).toBeNull();
  });
});

describe('deriveWorkflowGenerationPhase', () => {
  it('maps status to phase and lets status win over contradictory fields', () => {
    expect(deriveWorkflowGenerationPhase({})).toBe('idle');
    expect(deriveWorkflowGenerationPhase({ status: 'idle' })).toBe('idle');
    expect(deriveWorkflowGenerationPhase({ status: 'loading' })).toBe('running');
    expect(deriveWorkflowGenerationPhase({ status: 'success' })).toBe('succeeded');
    expect(deriveWorkflowGenerationPhase({ status: 'error' })).toBe('failed');
    expect(deriveWorkflowGenerationPhase(node({ status: 'success', generationRequestId: 'stale-run' }).metadata)).toBe('succeeded');
    expect(deriveWorkflowGenerationPhase(node({ status: 'idle', generationRequestId: 'stale-run' }).metadata)).toBe('idle');
    expect(deriveWorkflowGenerationPhase(node({ status: 'loading', error: 'old', generationRequestId: undefined }).metadata)).toBe('running');
  });
});

const imageKey: UserApiKey = {
  id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret', customModels: ['gpt-image-2'],
  routeMappings: [
    { target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const }, routeId: 'gpt-image-2', order: 0 },
    { target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' as const }, routeId: 'gpt-image-2', order: 0 },
  ],
  createdAt: 1, updatedAt: 1,
};

describe('compliance failure', () => {
  it('never publishes an error state that still holds the request id', async () => {
    let latest = projectWith([
      { id: 'text-1', type: 'text', title: '角色', position: { x: 0, y: 0 }, width: 300, height: 180, metadata: { content: '银色机器人' } },
      { id: 'config-1', type: 'config', title: '生成配置', position: { x: 420, y: 80 }, width: 360, height: 260, metadata: { prompt: '电影光线', config: { mode: 'image', modelId: 'flovart:gpt-image-2' } } },
    ]);
    latest = { ...latest, connections: [{ id: 'a', fromNodeId: 'text-1', toNodeId: 'config-1' }] };
    const published: WorkflowProject[] = [];
    const executeMedia = vi.fn();
    const result = await runWorkflowGeneration(latest, 'config-1', {
      userApiKeys: [imageKey], executeMedia,
      getProject: () => latest,
      onProjectChange: next => { latest = next; published.push(next); },
    });
    const errors = published.map(project => project.nodes.find(item => item.id === 'config-1')!.metadata).filter(meta => meta.status === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].error).toContain('合规警告');
    for (const meta of errors) {
      expect(meta.generationRequestId).toBeUndefined();
      expect(meta.generationStartedAt).toBeUndefined();
    }
    expect(executeMedia).not.toHaveBeenCalled();
    expect(result.nodes.find(item => item.id === 'config-1')?.metadata).toMatchObject({ status: 'error', generationRequestId: undefined });
  });
});
