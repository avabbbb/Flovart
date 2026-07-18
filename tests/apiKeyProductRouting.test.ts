import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_PREFS, mergeExtensionApiKeys, normalizeProductModelPreference } from '../hooks/useApiKeys';
import type { ModelPreference, UserApiKey } from '../types';

const currentKey: UserApiKey = {
  id: 'existing-key',
  provider: 'custom',
  capabilities: ['image'],
  key: 'secret',
  baseUrl: 'https://proxy.example.com/v1',
  customModels: ['gpt-image-2'],
  createdAt: 1,
  updatedAt: 1,
};

describe('API key product routing state', () => {
  it('normalizes known upstream aliases to fixed product ids and rejects unknown media preferences', () => {
    const preference: ModelPreference = {
      textModel: 'custom-text',
      imageModel: 'gpt-image-2',
      videoModel: 'unknown-video-model',
    };

    expect(normalizeProductModelPreference(preference)).toEqual({
      textModel: 'custom-text',
      imageModel: 'flovart:gpt-image-2',
      videoModel: DEFAULT_MODEL_PREFS.videoModel,
    });
  });

  it('merges extension updates into an existing key without dropping routing, pricing, or budget fields', () => {
    const routeBindings = [{ productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const, routeId: 'gpt-image-2', priority: 0, enabled: true, confirmed: true }];
    const pricingRules = [{ id: 'gpt-image-price', routeId: 'gpt-image-2', unit: 'image' as const, rate: 0.04, currency: 'USD' as const, source: 'manual' as const }];
    const budgetPolicy = { enabled: true, currency: 'USD' as const, monthlyLimit: 5, warningPercent: 80, hardStop: true };

    const [merged] = mergeExtensionApiKeys([currentKey], [{
      id: currentKey.id,
      provider: currentKey.provider,
      key: currentKey.key,
      baseUrl: 'https://new-proxy.example.com/v1',
      routeBindings,
      pricingRules,
      budgetPolicy,
      updatedAt: 2,
    }]);

    expect(merged).toMatchObject({
      id: currentKey.id,
      baseUrl: 'https://new-proxy.example.com/v1',
      routeBindings,
      pricingRules,
      budgetPolicy,
      updatedAt: 2,
    });
  });
});
