import type { UsageRecord } from '../utils/usageMonitor';

// 媒体账单统计：汇总 usageMonitor 已有的图片/视频调用记录（预估或实际费用），只读不写。

export interface MediaUsageRow {
  provider: string;
  model: string;
  type: 'image' | 'video';
  currency?: 'USD' | 'CNY';
  calls: number;
  succeeded: number;
  failed: number;
  /** 优先实际费用，否则预估；已退款/不计费的不计入。 */
  cost: number;
  /** 费用未知（没有定价规则）的调用数。 */
  unknownCostCalls: number;
}

const NOT_COUNTED = new Set(['not_billable', 'refunded']);

export function summarizeMediaUsage(records: readonly UsageRecord[], options: { since?: Date } = {}): MediaUsageRow[] {
  const since = options.since?.getTime() ?? -Infinity;
  const rows = new Map<string, MediaUsageRow>();
  for (const record of records) {
    if (record.type !== 'image' && record.type !== 'video') continue;
    if (record.timestamp < since) continue;
    const key = `${record.provider}\u0000${record.model}\u0000${record.type}\u0000${record.currency ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      row = { provider: record.provider, model: record.model, type: record.type, currency: record.currency, calls: 0, succeeded: 0, failed: 0, cost: 0, unknownCostCalls: 0 };
      rows.set(key, row);
    }
    row.calls += 1;
    if (record.status === 'succeeded') row.succeeded += 1;
    else if (record.status === 'failed' || record.status === 'canceled') row.failed += 1;
    if (NOT_COUNTED.has(record.billableState)) continue;
    const cost = record.actualCost ?? record.estimatedCost;
    if (cost === undefined) row.unknownCostCalls += 1;
    else row.cost += cost;
  }
  return [...rows.values()].sort((a, b) => b.cost - a.cost || b.calls - a.calls);
}
