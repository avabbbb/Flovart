import { describe, expect, it } from 'vitest';
import { summarizeMediaUsage } from '../services/mediaUsage';
import type { UsageRecord } from '../utils/usageMonitor';

function rec(patch: Partial<UsageRecord>): UsageRecord {
  return { id: Math.random().toString(36), keyId: 'k', provider: 'ark', model: 'seedance', timestamp: 1000, updatedAt: 1000, type: 'video', status: 'succeeded', billableState: 'estimated', ...patch } as UsageRecord;
}

describe('summarizeMediaUsage', () => {
  it('groups image/video calls by provider, model, type and currency', () => {
    const rows = summarizeMediaUsage([
      rec({ estimatedCost: 1.5, currency: 'CNY' }),
      rec({ actualCost: 2, estimatedCost: 9, currency: 'CNY' }),
      rec({ type: 'image', model: 'seedream', estimatedCost: 0.2, currency: 'CNY' }),
      rec({ type: 'text', estimatedCost: 99 }),
    ]);
    expect(rows.map(r => [r.model, r.type, r.calls, r.cost])).toEqual([
      ['seedance', 'video', 2, 3.5],
      ['seedream', 'image', 1, 0.2],
    ]);
  });

  it('excludes refunded/not_billable cost, counts unknown cost and failures', () => {
    const [row] = summarizeMediaUsage([
      rec({ estimatedCost: 5, billableState: 'refunded', status: 'canceled' }),
      rec({ billableState: 'unknown', status: 'failed' }),
      rec({ estimatedCost: 1 }),
    ]);
    expect(row).toMatchObject({ calls: 3, succeeded: 1, failed: 2, cost: 1, unknownCostCalls: 1 });
  });

  it('filters by since', () => {
    expect(summarizeMediaUsage([rec({ timestamp: 10 }), rec({ timestamp: 5000 })], { since: new Date(1000) })[0].calls).toBe(1);
  });
});
