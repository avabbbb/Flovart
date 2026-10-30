import React from 'react';
import { clearTokenUsage, countUsageMissing, listTokenUsage, listUsageMissing, subscribeTokenUsage, summarizeTokenUsage, type TokenUsageRecord, type UsageMissingRecord } from '../services/tokenUsage';
import { summarizeMediaUsage } from '../services/mediaUsage';
import { formatCost, listUsageRecords, type UsageRecord } from '../utils/usageMonitor';

// 允许传入更窄的 i18n t()（方法双变技巧）。
type Translate = { bivarianceHack(key: string): string }['bivarianceHack'];

function tr(t: Translate | undefined, key: string, fallback: string): string {
    const value = t?.(key);
    return value && value !== key ? value : fallback;
}

export function usageTabLabel(t?: Translate): string {
    return tr(t, 'settingsExtra.usageTab', '用量');
}

type UsageRange = 'today' | '7d' | 'all';

export function usageRangeStart(range: UsageRange, now: Date = new Date()): Date | undefined {
    if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (range === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return undefined;
}

const formatCount = (value: number) => value.toLocaleString();

const SOURCE_FALLBACK_LABELS: Record<string, string> = {
    text: '文本生成',
    'prompt-enhance': '提示词润色',
    'reverse-prompt': '图片反推',
    'reverse-prompt-stream': '图片反推（流式）',
    'browser-agent': '内置 Assistant',
};

export function usageSourceLabel(source: string, t?: Translate): string {
    const fallback = SOURCE_FALLBACK_LABELS[source];
    return fallback ? tr(t, `settingsExtra.usage.source.${source}`, fallback) : source;
}

export const TokenUsageSection: React.FC<{ t?: Translate }> = ({ t }) => {
    const [records, setRecords] = React.useState<readonly TokenUsageRecord[]>(() => listTokenUsage());
    const [missing, setMissing] = React.useState<readonly UsageMissingRecord[]>(() => listUsageMissing());
    const [range, setRange] = React.useState<UsageRange>('7d');
    const [source, setSource] = React.useState<string>('all');
    React.useEffect(() => subscribeTokenUsage(next => { setRecords([...next]); setMissing([...listUsageMissing()]); }), []);
    const [mediaRecords, setMediaRecords] = React.useState<UsageRecord[]>([]);
    React.useEffect(() => {
        let alive = true;
        listUsageRecords().then(next => { if (alive) setMediaRecords(next); }).catch(() => undefined);
        return () => { alive = false; };
    }, []);
    const mediaRows = React.useMemo(() => summarizeMediaUsage(mediaRecords, { since: usageRangeStart(range) }), [mediaRecords, range]);

    const rows = React.useMemo(() => summarizeTokenUsage(source === 'all' ? records : records.filter(item => item.source === source), { since: usageRangeStart(range) }), [records, range, source]);
    const missingCount = React.useMemo(() => countUsageMissing(missing, { since: usageRangeStart(range), source: source === 'all' ? undefined : source }), [missing, range, source]);
    const totals = rows.reduce((acc, row) => ({
        calls: acc.calls + row.calls,
        input: acc.input + row.inputTokens,
        output: acc.output + row.outputTokens,
        total: acc.total + row.totalTokens,
    }), { calls: 0, input: 0, output: 0, total: 0 });

    const ranges: Array<{ key: UsageRange; label: string }> = [
        { key: 'today', label: tr(t, 'settingsExtra.usage.today', '今天') },
        { key: '7d', label: tr(t, 'settingsExtra.usage.last7d', '近 7 天') },
        { key: 'all', label: tr(t, 'settingsExtra.usage.all', '全部') },
    ];
    const sources = React.useMemo(() => [...new Set([...records.map(item => item.source), ...missing.map(item => item.source)])].sort(), [records, missing]);

    const handleClear = () => {
        if (typeof window !== 'undefined' && !window.confirm(tr(t, 'settingsExtra.usage.clearConfirm', '确定清空本地 Token 用量记录？'))) return;
        clearTokenUsage();
        setSource('all');
    };

    return (
        <section className="space-y-3" data-testid="token-usage-section">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--isl-ink-ghost)]">{tr(t, 'settingsExtra.usage.title', 'Token 用量')}</div>
                    <p className="mb-0 mt-1 text-xs leading-5 text-[var(--isl-ink-soft)]">{tr(t, 'settingsExtra.usage.intro', '仅统计供应商响应中返回的 usage（流式调用含取消/出错时已下发的部分）；未返回的调用不估算，只计次数；数据只保存在本机。')}</p>
                </div>
                <button type="button" onClick={handleClear} disabled={records.length === 0 && missing.length === 0} data-testid="token-usage-clear" className="shrink-0 rounded-md border border-[var(--isl-border)] px-2 py-1 text-xs text-[var(--isl-ink-soft)] transition hover:bg-black/5 disabled:opacity-40">
                    {tr(t, 'settingsExtra.usage.clear', '清空')}
                </button>
            </div>
            <div className="flex gap-1" role="tablist">
                {ranges.map(item => (
                    <button key={item.key} type="button" role="tab" aria-selected={range === item.key} data-testid={`token-usage-range-${item.key}`} onClick={() => setRange(item.key)} className={`rounded-md px-2 py-1 text-xs transition ${range === item.key ? 'bg-[var(--isl-surface-2)] font-semibold text-[var(--isl-ink)]' : 'text-[var(--isl-ink-soft)] hover:bg-black/5'}`}>
                        {item.label}
                    </button>
                ))}
            </div>
            {sources.length > 1 && (
                <div className="flex flex-wrap gap-1" role="tablist" data-testid="token-usage-sources">
                    {['all', ...sources].map(key => (
                        <button key={key} type="button" role="tab" aria-selected={source === key} data-testid={`token-usage-source-${key}`} onClick={() => setSource(key)} className={`rounded-md px-2 py-1 text-xs transition ${source === key ? 'bg-[var(--isl-surface-2)] font-semibold text-[var(--isl-ink)]' : 'text-[var(--isl-ink-soft)] hover:bg-black/5'}`}>
                            {key === 'all' ? tr(t, 'settingsExtra.usage.allSources', '全部来源') : usageSourceLabel(key, t)}
                        </button>
                    ))}
                </div>
            )}
            <div className="grid grid-cols-4 gap-2 text-xs" data-testid="token-usage-totals">
                {[
                    [tr(t, 'settingsExtra.usage.calls', '调用'), totals.calls],
                    [tr(t, 'settingsExtra.usage.input', '输入'), totals.input],
                    [tr(t, 'settingsExtra.usage.output', '输出'), totals.output],
                    [tr(t, 'settingsExtra.usage.total', '合计'), totals.total],
                ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-[var(--isl-border)] px-2 py-1.5">
                        <div className="text-[var(--isl-ink-soft)]">{label}</div>
                        <div className="font-semibold tabular-nums text-[var(--isl-ink)]">{formatCount(Number(value))}</div>
                    </div>
                ))}
            </div>
            {missingCount > 0 && (
                <div className="rounded-md border border-[var(--isl-border)] px-2 py-1.5 text-xs text-[var(--isl-ink-soft)]" data-testid="token-usage-missing">
                    {`${formatCount(missingCount)} ${tr(t, 'settingsExtra.usage.missing', '次流式调用未返回 usage，未计入上方统计')}`}
                </div>
            )}
            {rows.length === 0 ? (
                <div className="rounded-md border border-dashed border-[var(--isl-border)] p-3 text-xs text-[var(--isl-ink-soft)]" data-testid="token-usage-empty">
                    {tr(t, 'settingsExtra.usage.empty', '这段时间没有记录到 Token 用量。')}
                </div>
            ) : (
                <table className="w-full text-left text-xs" data-testid="token-usage-table">
                    <thead className="text-[var(--isl-ink-soft)]">
                        <tr>
                            <th className="py-1 font-medium">{tr(t, 'settingsExtra.usage.model', '模型')}</th>
                            <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.calls', '调用')}</th>
                            <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.input', '输入')}</th>
                            <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.output', '输出')}</th>
                            <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.total', '合计')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={`${row.provider}/${row.model}`} className="border-t border-[var(--isl-border)] text-[var(--isl-ink)]">
                                <td className="py-1.5"><div className="font-medium">{row.model}</div><div className="text-[10px] text-[var(--isl-ink-soft)]">{row.provider}{row.cachedInputTokens ? ` · cache ${formatCount(row.cachedInputTokens)}` : ''}{row.reasoningTokens ? ` · reasoning ${formatCount(row.reasoningTokens)}` : ''}</div></td>
                                <td className="py-1.5 text-right tabular-nums">{formatCount(row.calls)}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatCount(row.inputTokens)}</td>
                                <td className="py-1.5 text-right tabular-nums">{formatCount(row.outputTokens)}</td>
                                <td className="py-1.5 text-right font-semibold tabular-nums">{formatCount(row.totalTokens)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
            <div className="space-y-2 pt-2" data-testid="media-usage-section">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--isl-ink-ghost)]">{tr(t, 'settingsExtra.usage.mediaTitle', '图片 / 视频费用')}</div>
                    <p className="mb-0 mt-1 text-xs leading-5 text-[var(--isl-ink-soft)]">{tr(t, 'settingsExtra.usage.mediaIntro', '按 API Key 的定价规则预估，有实际账单时以实际为准；已退款和不计费的调用不计入。')}</p>
                </div>
                {mediaRows.length === 0 ? (
                    <div className="rounded-md border border-dashed border-[var(--isl-border)] p-3 text-xs text-[var(--isl-ink-soft)]" data-testid="media-usage-empty">
                        {tr(t, 'settingsExtra.usage.mediaEmpty', '这段时间没有图片或视频生成记录。')}
                    </div>
                ) : (
                    <table className="w-full text-left text-xs" data-testid="media-usage-table">
                        <thead className="text-[var(--isl-ink-soft)]">
                            <tr>
                                <th className="py-1 font-medium">{tr(t, 'settingsExtra.usage.model', '模型')}</th>
                                <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.calls', '调用')}</th>
                                <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.failed', '失败')}</th>
                                <th className="py-1 text-right font-medium">{tr(t, 'settingsExtra.usage.cost', '费用')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mediaRows.map(row => (
                                <tr key={`${row.provider}/${row.model}/${row.type}/${row.currency ?? ''}`} className="border-t border-[var(--isl-border)] text-[var(--isl-ink)]">
                                    <td className="py-1.5"><div className="font-medium">{row.model}</div><div className="text-[10px] text-[var(--isl-ink-soft)]">{row.provider} · {row.type === 'video' ? tr(t, 'settingsExtra.usage.video', '视频') : tr(t, 'settingsExtra.usage.image', '图片')}</div></td>
                                    <td className="py-1.5 text-right tabular-nums">{formatCount(row.calls)}</td>
                                    <td className="py-1.5 text-right tabular-nums">{formatCount(row.failed)}</td>
                                    <td className="py-1.5 text-right font-semibold tabular-nums">
                                        {row.currency ? formatCost(row.cost * 100, row.currency) : '—'}
                                        {row.unknownCostCalls > 0 && <div className="text-[10px] font-normal text-[var(--isl-ink-soft)]">{`${row.unknownCostCalls} ${tr(t, 'settingsExtra.usage.unpriced', '次未定价')}`}</div>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </section>
    );
};
