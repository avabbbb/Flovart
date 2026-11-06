import { describe, expect, it } from 'vitest';
import type { UserApiKey } from '../types';
import { explainApiCost, estimateApiCost } from '../utils/usageMonitor';
import { getGenerationGateDetails } from '../services/generationGate';
import { createWorkflowNode } from '../components/workflow/constants';

const seedanceKey: UserApiKey = {
  id: 'k', provider: 'openai_compatible', capabilities: ['video'], key: 'secret', createdAt: 1, updatedAt: 1,
  pricingRules: [
    { id: '720', productModelId: 'flovart:seedance-2', unit: 'video_second', rate: 0.04, currency: 'CNY', resolution: '720p', source: 'manual' },
    { id: '1080', productModelId: 'flovart:seedance-2', unit: 'video_second', rate: 0.08, currency: 'CNY', resolution: '1080p', source: 'manual' },
  ],
};

describe('cost breakdown', () => {
  it('returns the matched rule components and keeps estimateApiCost shape', () => {
    const input = { key: seedanceKey, productModelId: 'flovart:seedance-2', routeId: 'seedance-2', type: 'video' as const, durationSec: 8, count: 1, resolution: '720p' };
    const explained = explainApiCost(input);
    expect(explained?.currency).toBe('CNY');
    expect(explained?.amount).toBeCloseTo(0.32);
    expect(explained?.components).toEqual([{ rate: 0.04, unit: 'video_second', units: 8, amount: expect.closeTo(0.32) }]);
    expect(estimateApiCost(input)).toEqual({ amount: explained!.amount, currency: 'CNY' });
  });

  it('returns null when no rule matches', () => {
    expect(explainApiCost({ key: { ...seedanceKey, pricingRules: [] }, routeId: 'x', type: 'video' })).toBeNull();
  });
});

describe('generation gate plan fields', () => {
  it('carries resolution, duration, aspect ratio and title; marks unknown cost', () => {
    const node = createWorkflowNode('video', 'video', { x: 0, y: 0 }, {
      config: { mode: 'video', modelId: 'flovart:grok-imagine-video', resolution: '720p', durationSec: 8, aspectRatio: '16:9' },
    });
    const details = getGenerationGateDetails(node, { executor: 'provider-generation', mediaType: 'video' }, [{
      id: 'key-1', provider: 'openai_compatible', capabilities: ['video'], key: 'secret', createdAt: 1, updatedAt: 1,
    }]);
    expect(details).toMatchObject({ resolution: '720p', durationSec: 8, aspectRatio: '16:9', costBasis: 'unknown', estimatedCost: null });
    expect(details.nodeTitle).toBe(node.title);
    expect(details.costComponents).toBeUndefined();
  });

  it('omits duration for image generation', () => {
    const node = createWorkflowNode('image', 'image', { x: 0, y: 0 }, { config: { mode: 'image', durationSec: 8 } });
    expect(getGenerationGateDetails(node, { executor: 'provider-generation', mediaType: 'image' }, []).durationSec).toBeUndefined();
  });
});
