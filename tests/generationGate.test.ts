import { describe, expect, it } from 'vitest';
import { buildGenerationGateSummary, formatGenerationCost, getGenerationGateDetails, requiresExternalGenerationGate } from '../services/generationGate';
import { createWorkflowNode } from '../components/workflow/constants';

describe('external generation gate', () => {
  it('gates provider generation but leaves local transforms free', () => {
    const image = createWorkflowNode('image', 'image', { x: 0, y: 0 });
    expect(requiresExternalGenerationGate(image, { executor: 'provider-generation', mediaType: 'image' })).toBe(true);
    expect(requiresExternalGenerationGate(image, { executor: 'provider-image-tool', mediaType: 'image' })).toBe(true);
    expect(requiresExternalGenerationGate(image, { executor: 'local-transform', mediaType: 'image' })).toBe(false);
  });

  it('gates unknown executors instead of failing open', () => {
    const image = createWorkflowNode('image', 'image', { x: 0, y: 0 });
    expect(requiresExternalGenerationGate(image, { executor: 'future-executor', mediaType: 'image' })).toBe(true);
    expect(requiresExternalGenerationGate(image, { mediaType: 'image' })).toBe(true);
  });

  it('always states the estimated cost or that it is unknown', () => {
    expect(formatGenerationCost(null)).toContain('未知');
    expect(formatGenerationCost({ amount: 1.5, currency: 'CNY' })).toBe('预计费用：约 CNY 1.50');
  });

  it('builds a product-language confirmation without credentials or wire terms', () => {
    const node = createWorkflowNode('video', 'video', { x: 0, y: 0 }, {
      config: { mode: 'video', modelId: 'flovart:grok-imagine-video', count: 2 },
    });
    const details = getGenerationGateDetails(node, { executor: 'provider-generation', mediaType: 'video' }, [{
      id: 'key-1', provider: 'openai_compatible', capabilities: ['video'], key: 'secret', createdAt: 1, updatedAt: 1,
    }]);
    const summary = buildGenerationGateSummary(details);

    expect(summary).toContain('AI 服务：OpenAI 兼容服务');
    expect(summary).toContain('模型：grok-imagine-video');
    expect(summary).toContain('任务：2 个视频生成');
    expect(summary).toContain('可能产生费用');
    expect(summary).toContain('预计费用：未知');
    expect(summary).not.toContain('secret');
    expect(summary).not.toContain('Provider');
  });
});
