import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiGateway from '../services/aiGateway';
import type { UnifiedIgnitionInput } from '../services/aiGateway';
import type * as UsageMonitor from '../utils/usageMonitor';
import type { WorkflowProject } from '../components/workflow/types';
import type { UserApiKey } from '../types';

const mocks = vi.hoisted(() => ({
  executeUnifiedIgnition: vi.fn(),
  reserveApiUsage: vi.fn(),
  updateApiUsage: vi.fn(),
  refundApiUsage: vi.fn(),
}));

vi.mock('../services/aiGateway', async importOriginal => ({
  ...(await importOriginal<typeof AiGateway>()),
  executeUnifiedIgnition: mocks.executeUnifiedIgnition,
}));
vi.mock('../utils/usageMonitor', async importOriginal => ({
  ...(await importOriginal<typeof UsageMonitor>()),
  reserveApiUsage: mocks.reserveApiUsage,
  updateApiUsage: mocks.updateApiUsage,
  refundApiUsage: mocks.refundApiUsage,
}));
vi.mock('../utils/assetStorage', () => ({ getAssetById: vi.fn(async () => undefined) }));
vi.mock('../utils/mediaIndexedDB', () => ({ readColdMedia: vi.fn(async () => 'data:image/png;base64,QkJC') }));

import { cancelWorkflowGeneration, runWorkflowGeneration } from '../services/workflowGeneration';

const imageKey: UserApiKey = {
  id: 'image-key',
  provider: 'openai',
  capabilities: ['image'],
  key: 'secret',
  customModels: ['gpt-image-2'],
  routeMappings: [
    { target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const }, routeId: 'gpt-image-2', order: 0 },
    { target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' as const }, routeId: 'gpt-image-2', order: 0 },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const project = (): WorkflowProject => ({
  id: 'usage-project',
  title: '计费测试',
  nodes: [
    { id: 'config-1', type: 'config', title: '生成配置', position: { x: 0, y: 0 }, width: 360, height: 260, metadata: { prompt: '电影光线', config: { mode: 'image', modelId: 'flovart:gpt-image-2' } } },
  ],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

const stop = () => cancelWorkflowGeneration('usage-project', 'config-1');

async function runUntilStopped(provider: (input: UnifiedIgnitionInput) => Promise<unknown>) {
  mocks.executeUnifiedIgnition.mockImplementation(provider);
  let latest = project();
  await runWorkflowGeneration(latest, 'config-1', {
    userApiKeys: [imageKey],
    getProject: () => latest,
    onProjectChange: next => { latest = next; },
  }).catch(() => undefined);
  return latest;
}

const never = () => Promise.withResolvers<never>().promise;

describe('停止生成时的 usage 状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reserveApiUsage.mockResolvedValue({ id: 'usage-1', estimatedCost: 0.1, currency: 'USD', billableState: 'estimated' });
    mocks.updateApiUsage.mockResolvedValue(undefined);
    mocks.refundApiUsage.mockResolvedValue(undefined);
  });

  it('上游未提交就停止：记为 canceled，不带 providerTaskId', async () => {
    await runUntilStopped(async () => {
      stop();
      return never();
    });

    expect(mocks.reserveApiUsage).toHaveBeenCalledTimes(1);
    const finalPatch = mocks.updateApiUsage.mock.calls.at(-1);
    expect(finalPatch?.[0]).toBe('usage-1');
    expect(finalPatch?.[1]).toMatchObject({ status: 'canceled', billableState: 'unknown' });
    expect(finalPatch?.[1]).not.toHaveProperty('providerTaskId');
  });

  it('上游已提交后停止：记为 submission_unknown 并保留 providerTaskId', async () => {
    const latest = await runUntilStopped(async input => {
      await input.onProviderTaskLifecycle?.({ phase: 'submitted', providerTaskId: 'upstream-1', submittedAt: 1 });
      stop();
      return never();
    });

    expect(mocks.updateApiUsage).toHaveBeenCalledWith('usage-1', expect.objectContaining({ status: 'queued', providerTaskId: 'upstream-1' }));
    expect(mocks.updateApiUsage.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'submission_unknown',
      providerTaskId: 'upstream-1',
      billableState: 'unknown',
    });
    expect(mocks.refundApiUsage).not.toHaveBeenCalled();
    const node = latest.nodes.find(item => item.id === 'config-1');
    expect(node?.metadata.status).toBe('error');
    expect(node?.metadata.generationBillableState).toBe('unknown');
    expect(node?.metadata.error).toContain('计费');
  });

  it('供应商确认取消：退还预留费用', async () => {
    const latest = await runUntilStopped(async input => {
      await input.onProviderTaskLifecycle?.({ phase: 'submitted', providerTaskId: 'upstream-2', submittedAt: 1 });
      await input.onProviderTaskLifecycle?.({ phase: 'cancelled', providerTaskId: 'upstream-2', canceled: true });
      stop();
      return never();
    });

    expect(mocks.refundApiUsage).toHaveBeenCalledWith('usage-1', '供应商已确认取消');
    expect(latest.nodes.find(item => item.id === 'config-1')?.metadata.status).toBe('idle');
  });
});
