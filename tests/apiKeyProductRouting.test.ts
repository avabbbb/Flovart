import { describe, expect, it } from 'vitest';
import { mergeExtensionApiKeys } from '../hooks/useApiKeys';
import type { UserApiKey } from '../types';

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
  it('merges extension updates into an existing key without dropping routing, pricing, or budget fields', () => {
    const routeMappings = [{ target: { kind: 'product-mode' as const, productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' as const }, routeId: 'gpt-image-2', order: 0 }];
    const pricingRules = [{ id: 'gpt-image-price', routeId: 'gpt-image-2', unit: 'image' as const, rate: 0.04, currency: 'USD' as const, source: 'manual' as const }];
    const budgetPolicy = { enabled: true, currency: 'USD' as const, monthlyLimit: 5, warningPercent: 80, hardStop: true };

    const [merged] = mergeExtensionApiKeys([currentKey], [{
      id: currentKey.id,
      provider: currentKey.provider,
      key: currentKey.key,
      baseUrl: 'https://new-proxy.example.com/v1',
      routeMappings,
      pricingRules,
      budgetPolicy,
      updatedAt: 2,
    }]);

    expect(merged).toMatchObject({
      id: currentKey.id,
      baseUrl: 'https://new-proxy.example.com/v1',
      routeMappings,
      pricingRules,
      budgetPolicy,
      updatedAt: 2,
    });
  });
});
