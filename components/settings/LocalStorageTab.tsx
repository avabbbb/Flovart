import { useCallback, useEffect, useState } from 'react';
import { collectStorageReport, formatBytes, usagePercent, type StorageReport } from '../../services/storageStats';

const buttonClass = 'isl-chip px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
const tileClass = 'rounded-xl border border-[var(--isl-border)] bg-[var(--isl-surface-2)] settings-elevated px-3 py-2.5';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={tileClass}>
      <div className="text-[11px] text-[var(--isl-ink-soft)]">{label}</div>
      <div className="mt-1 text-lg font-extrabold text-[var(--isl-ink)]">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-[var(--isl-ink-soft)]">{hint}</div>}
    </div>
  );
}

export function LocalStorageTab() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await collectStorageReport());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const percent = report ? usagePercent(report.usage, report.quota) : null;
  const rows = report
    ? report.databases.flatMap(db => (db.stores.length
      ? db.stores.map(store => ({ key: db.name + '/' + store.name, db: db.name, store: store.name, count: store.count, bytes: store.bytes, error: db.error }))
      : [{ key: db.name, db: db.name, store: '—', count: 0, bytes: db.bytes, error: db.error }]))
    : [];

  return (
    <section className="space-y-4" data-testid="settings-local-storage">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold text-[var(--isl-ink)]">本地存储</div>
          <div className="mt-1 text-xs text-[var(--isl-ink-soft)]">画布、素材与会话缓存都保存在本浏览器的 IndexedDB 中，只统计不修改。</div>
        </div>
        <button type="button" className={buttonClass} disabled={loading} onClick={() => void refresh()}>
          {loading ? '统计中…' : '刷新统计'}
        </button>
      </div>
      {error && <div role="alert" className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{error}</div>}
      <div className="grid gap-2 sm:grid-cols-4">
        <Tile label="IndexedDB 占用" value={report ? formatBytes(report.indexedDbBytes) : '—'} hint="按内容估算" />
        <Tile label="站点总占用" value={report && report.usage !== null ? formatBytes(report.usage) : '—'} hint="含缓存等" />
        <Tile label="可用配额" value={report && report.quota !== null ? formatBytes(report.quota) : '—'} hint="浏览器分配" />
        <Tile label="使用率" value={percent === null ? '—' : percent.toFixed(percent < 1 ? 2 : 1) + '%'} />
      </div>
      {percent !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--isl-border)]" aria-hidden="true">
          <div className="h-full rounded-full bg-[var(--isl-mint)]" style={{ width: Math.max(percent, 1) + '%' }} />
        </div>
      )}
      {report && !report.supported.databases && (
        <div className="text-xs text-[var(--isl-ink-soft)]">当前浏览器不支持列出 IndexedDB 数据库，只能显示站点总占用。</div>
      )}
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--isl-border)] settings-elevated">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--isl-surface-2)] text-[var(--isl-ink-soft)]">
              <tr>
                <th className="px-3 py-2 font-semibold">数据库</th>
                <th className="px-3 py-2 font-semibold">对象仓库</th>
                <th className="px-3 py-2 text-right font-semibold">条数</th>
                <th className="px-3 py-2 text-right font-semibold">体积</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="border-t border-[var(--isl-border)] text-[var(--isl-ink)]">
                  <td className="px-3 py-1.5">{row.db}</td>
                  <td className="px-3 py-1.5" title={row.error}>{row.error ? '读取失败' : row.store}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(row.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
