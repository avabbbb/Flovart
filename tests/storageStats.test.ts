import { describe, expect, it } from 'vitest';
import { collectStorageReport, estimateValueBytes, formatBytes, usagePercent } from '../services/storageStats';

describe('storageStats', () => {
  it('estimates structured values', () => {
    expect(estimateValueBytes('ab')).toBe(4);
    expect(estimateValueBytes(new Uint8Array(10))).toBe(10);
    expect(estimateValueBytes(new Blob(['12345']))).toBe(5);
    expect(estimateValueBytes({ a: 1 })).toBe(2 + 8);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(estimateValueBytes(loop)).toBe(8);
  });

  it('formats bytes and usage percent', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(696)).toBe('696 B');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
    expect(formatBytes(10 * 1024 ** 3)).toBe('10.00 GB');
    expect(usagePercent(1, 4)).toBe(25);
    expect(usagePercent(null, 4)).toBeNull();
  });

  it('reports estimate even when database listing is unsupported', async () => {
    const report = await collectStorageReport({
      indexedDB: {} as IDBFactory,
      storage: { estimate: async () => ({ usage: 100, quota: 1000 }) },
    });
    expect(report.supported).toEqual({ databases: false, estimate: true });
    expect(report.usage).toBe(100);
    expect(report.quota).toBe(1000);
    expect(report.databases).toEqual([]);
  });
});
