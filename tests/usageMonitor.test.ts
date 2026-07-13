import { beforeEach, describe, expect, it } from 'vitest';
import type { UserApiKey } from '../types';
import { assertApiBudget, clearAllUsageData, estimateApiCost, getKeyRecords, getUsageSummary, reserveApiUsage, updateApiUsage } from '../utils/usageMonitor';

const key: UserApiKey = {
  id: 'budget-key', provider: 'openai', capabilities: ['image'], key: 'secret', createdAt: 1, updatedAt: 1,
  pricingRules: [{ id: 'price', productModelId: 'flovart:gpt-image-2', unit: 'image', rate: 0.6, currency: 'USD', source: 'manual' }],
  budgetPolicy: { enabled: true, monthlyLimit: 1, warningPercent: 80, hardStop: true, currency: 'USD' },
};

describe('API usage ledger and budget', () => {
  beforeEach(async () => clearAllUsageData());

  it('reserves estimated cost before submission and blocks only the next task over budget', async () => {
    const input = { key, productModelId: 'flovart:gpt-image-2', upstreamModelId: 'gpt-image-2', type: 'image' as const };
    const record = await reserveApiUsage(input);
    expect(record).toMatchObject({ status: 'reserved', estimatedCost: 0.6, billableState: 'estimated' });
    expect(getUsageSummary([key])).resolves.toEqual(new Map([[key.id, expect.objectContaining({ currentMonthCostCents: 60 })]]));
    await expect(assertApiBudget(input)).rejects.toThrow('月度预算上限');
  });

  it('keeps failed provider cost unknown instead of automatically refunding it', async () => {
    const record = await reserveApiUsage({ key, productModelId: 'flovart:gpt-image-2', upstreamModelId: 'gpt-image-2', type: 'image' });
    await updateApiUsage(record.id, { status: 'failed', billableState: 'unknown', error: 'provider failed' });
    expect(await getKeyRecords(key.id)).toContainEqual(expect.objectContaining({ id: record.id, status: 'failed', billableState: 'unknown' }));
  });

  it('adds compatible pricing components at the same scope and rejects mixed currencies', () => {
    const composite = { ...key, pricingRules: [
      { id: 'base', productModelId: 'flovart:gpt-image-2', unit: 'request' as const, rate: 0.1, currency: 'USD' as const, source: 'manual' as const },
      { id: 'image', productModelId: 'flovart:gpt-image-2', unit: 'image' as const, rate: 0.6, currency: 'USD' as const, source: 'manual' as const },
    ] };
    expect(estimateApiCost({ key: composite, productModelId: 'flovart:gpt-image-2', upstreamModelId: 'gpt-image-2', type: 'image', count: 2 })).toEqual({ amount: 1.4, currency: 'USD' });
    expect(estimateApiCost({ key: { ...composite, pricingRules: composite.pricingRules.map((rule, index) => index ? { ...rule, currency: 'CNY' as const } : rule) }, productModelId: 'flovart:gpt-image-2', upstreamModelId: 'gpt-image-2', type: 'image' })).toBeNull();
  });
});
