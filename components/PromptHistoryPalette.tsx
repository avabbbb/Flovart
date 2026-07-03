import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Trash2, X, Image, Video, FileText, ArrowRight } from 'lucide-react';
import { usePromptHistoryStore, type PromptHistoryEntry } from '../stores/usePromptHistoryStore';

const MODE_ICON = {
    image: Image,
    video: Video,
    text: FileText,
} as const;

const SOURCE_LABEL = { canvas: '画布', workflow: '工作流' } as const;

function formatTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function PromptHistoryPalette({ theme }: { theme: 'light' | 'dark' }) {
    const { isOpen, close, insert, search, clearAll } = usePromptHistoryStore();
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const dark = theme === 'dark';

    const results = useMemo<PromptHistoryEntry[]>(() => search(query), [query, search]);

    useEffect(() => {
        if (isOpen) {
            setQuery('');
            setActiveIndex(0);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [isOpen]);

    useEffect(() => { setActiveIndex(0); }, [query]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); close(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => Math.min(i + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => Math.max(i - 1, 0)); }
            else if (e.key === 'Enter' && results[activeIndex]) { e.preventDefault(); insert(results[activeIndex].prompt); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, results, activeIndex, close, insert]);

    useEffect(() => {
        const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
        el?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
             onClick={close}>
            <div className={`relative w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden mx-4
                ${dark ? 'bg-[#1C2333] text-white' : 'bg-white text-gray-900'}`}
                 onClick={e => e.stopPropagation()}>
                <div className={`flex items-center gap-3 px-4 py-3 border-b ${dark ? 'border-[#2A3142]' : 'border-gray-100'}`}>
                    <Search className="w-5 h-5 opacity-50 shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="搜索历史提示词..."
                        className="flex-1 bg-transparent outline-none text-base placeholder:opacity-40"
                    />
                    <kbd className={`text-xs px-1.5 py-0.5 rounded ${dark ? 'bg-[#2A3142] text-gray-400' : 'bg-gray-100 text-gray-500'}`}>ESC</kbd>
                    <button onClick={close} className="opacity-50 hover:opacity-100 transition">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                    {results.length === 0 ? (
                        <div className="px-4 py-12 text-center opacity-40 text-sm">
                            {query ? '没有匹配的历史提示词' : '还没有历史提示词，生成后会自动记录'}
                        </div>
                    ) : results.map((entry, idx) => {
                        const Icon = MODE_ICON[entry.mode] || FileText;
                        const isActive = idx === activeIndex;
                        return (
                            <div key={entry.id} data-idx={idx}
                                 onClick={() => insert(entry.prompt)}
                                 onMouseEnter={() => setActiveIndex(idx)}
                                 className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition ${isActive ? (dark ? 'bg-[#2A3142]' : 'bg-gray-50') : ''}`}>
                                <Icon className="w-4 h-4 mt-0.5 opacity-40 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm line-clamp-2 break-words">{entry.prompt}</p>
                                    <div className="flex items-center gap-2 mt-1 text-xs opacity-40">
                                        <span>{SOURCE_LABEL[entry.source]}</span>
                                        {entry.model && <span>· {entry.model}</span>}
                                        <span>· {formatTime(entry.timestamp)}</span>
                                    </div>
                                </div>
                                {isActive && <ArrowRight className="w-4 h-4 mt-0.5 opacity-30 shrink-0" />}
                            </div>
                        );
                    })}
                </div>
                {results.length > 0 && (
                    <div className={`flex items-center justify-between px-4 py-2 border-t text-xs ${dark ? 'border-[#2A3142] text-gray-500' : 'border-gray-100 text-gray-400'}`}>
                        <span>↑↓ 导航 · Enter 插入 · ESC 关闭</span>
                        <button onClick={() => { if (confirm('确定清空全部历史提示词？')) void clearAll(); }}
                                className="flex items-center gap-1 hover:text-red-500 transition">
                            <Trash2 className="w-3.5 h-3.5" /> 清空
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
