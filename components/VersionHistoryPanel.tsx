import React, { useMemo } from 'react';
import { useVersionHistoryStore, type CanvasVersion, type VersionType } from '../stores/useVersionHistoryStore';

interface Props {
    open: boolean;
    onClose: () => void;
    onRestore: (version: CanvasVersion) => void;
    theme: 'light' | 'dark';
}

const TYPE_LABEL: Record<VersionType, string> = {
    generate: '生成',
    split: '拆分图层',
    inpaint: '局部重绘',
    video: '视频生成',
    restore: '恢复版本',
    initial: '初始',
};

const TYPE_ICON: Record<VersionType, React.ReactNode> = {
    generate: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><circle cx="12" cy="12" r="4" /></svg>,
    split: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></svg>,
    inpaint: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>,
    video: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m22 8-6 4 6 4V8Z" /></svg>,
    restore: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>,
    initial: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 3" /></svg>,
};

function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

export const VersionHistoryPanel: React.FC<Props> = ({ open, onClose, onRestore, theme }) => {
    const versions = useVersionHistoryStore(s => s.versions);
    const clearVersions = useVersionHistoryStore(s => s.clearVersions);
    const removeVersion = useVersionHistoryStore(s => s.removeVersion);

    const reversed = useMemo(() => [...versions].reverse(), [versions]);

    if (!open) return null;

    return (
        <div
            className="absolute right-4 top-16 z-40 flex flex-col rounded-2xl border-[1px]"
            style={{
                width: 280,
                maxHeight: '60vh',
                background: theme === 'dark' ? 'rgba(32,31,29,0.82)' : 'rgba(255,255,255,0.82)',
                backdropFilter: 'blur(24px) saturate(180%)',
                borderColor: 'var(--isl-border)',
                boxShadow: 'var(--isl-shadow)',
            }}
        >
            <div
                className="flex items-center justify-between px-3 py-2 border-b-[1px]"
                style={{ borderColor: 'var(--isl-border)', background: 'linear-gradient(180deg, var(--isl-surface), transparent)' }}
            >
                <span className="text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>历史版本</span>
                <div className="flex items-center gap-1">
                    {versions.length > 0 && (
                        <button
                            type="button"
                            className="isl-icon-btn h-6 w-6"
                            title="清空"
                            onClick={() => {
                                if (confirm('确定清空全部历史版本？')) clearVersions();
                            }}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                    )}
                    <button type="button" className="isl-icon-btn h-6 w-6" title="关闭" onClick={onClose}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2" style={{ scrollbarWidth: 'thin' }}>
                {reversed.length === 0 ? (
                    <div className="px-2 py-6 text-center text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
                        暂无历史版本<br /><span className="opacity-60">生成、拆分、重绘后会自动记录</span>
                    </div>
                ) : (
                    <ul className="flex flex-col gap-1">
                        {reversed.map(v => (
                            <li
                                key={v.id}
                                className="group flex items-start gap-2 rounded-lg px-2 py-1.5"
                                style={{ background: 'transparent' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--isl-surface)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                                <span className="mt-0.5 shrink-0" style={{ color: 'var(--isl-ink-soft)' }}>
                                    {TYPE_ICON[v.type]}
                                </span>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-ink)' }}>
                                            {TYPE_LABEL[v.type]}
                                        </span>
                                        <span className="text-[10px] tabular-nums" style={{ color: 'var(--isl-ink-soft)' }}>{formatTime(v.timestamp)}</span>
                                    </div>
                                    <div className="truncate text-xs mt-0.5" style={{ color: 'var(--isl-ink)' }} title={v.description}>
                                        {v.description}
                                    </div>
                                    <div className="text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{v.elements.length} 个元素</div>
                                </div>
                                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        type="button"
                                        className="isl-icon-btn h-6 w-6"
                                        title="恢复此版本"
                                        onClick={() => {
                                            onRestore(v);
                                        }}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                                    </button>
                                    <button
                                        type="button"
                                        className="isl-icon-btn h-6 w-6"
                                        title="删除此版本"
                                        onClick={() => removeVersion(v.id)}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};