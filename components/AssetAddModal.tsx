import React, { useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { AssetFolder, AssetLibrary } from '../types';

interface AssetAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    previewDataUrl: string;
    library: AssetLibrary;
    onConfirm: (folderIds: string[], name?: string, tags?: string[]) => void;
}

function buildOrderedFolders(folders: AssetFolder[]): Array<AssetFolder & { depth: number }> {
    const byParent = new Map<string | null, AssetFolder[]>();
    for (const f of folders) {
        const list = byParent.get(f.parentId) || [];
        list.push(f);
        byParent.set(f.parentId, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const out: Array<AssetFolder & { depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
        const children = byParent.get(parentId) || [];
        for (const c of children) {
            out.push({ ...c, depth });
            walk(c.id, depth + 1);
        }
    };
    walk(null, 0);
    return out;
}

export const AssetAddModal: React.FC<AssetAddModalProps> = ({ isOpen, onClose, previewDataUrl, library, onConfirm }) => {
    const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
    const [name, setName] = useState('');
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState<string[]>([]);

    const orderedFolders = useMemo(() => buildOrderedFolders(library.folders), [library.folders]);

    React.useEffect(() => {
        if (!isOpen) return;
        setSelectedFolderIds([]);
        setName('');
        setTagInput('');
        setTags([]);
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const toggleFolder = (id: string) => {
        setSelectedFolderIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const addTag = () => {
        const t = tagInput.trim();
        if (!t || tags.includes(t)) { setTagInput(''); return; }
        setTags(prev => [...prev, t]);
        setTagInput('');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
            <div className="isl-panel isl-bounce-in w-[720px] max-w-[92vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--isl-border)' }}>
                    <strong style={{ color: 'var(--isl-ink)' }}>加入素材库</strong>
                    <button onClick={onClose} className="isl-icon-btn h-8 w-8" title="关闭" aria-label="关闭">
                        <X size={18} />
                    </button>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                    <div className="isl-well p-2">
                        <img src={previewDataUrl} alt="预览" className="w-full h-64 object-contain" />
                    </div>
                    <div className="flex flex-col gap-3 min-h-0">
                        <div>
                            <label className="text-sm font-bold block mb-1.5" style={{ color: 'var(--isl-ink-soft)' }}>归属文件夹（可多选）</label>
                            <div className="isl-well max-h-40 overflow-y-auto p-1.5">
                                {orderedFolders.length === 0 ? (
                                    <div className="px-2 py-3 text-xs text-center" style={{ color: 'var(--isl-ink-ghost)' }}>暂无文件夹，可直接加入为未分类</div>
                                ) : orderedFolders.map(f => (
                                    <label key={f.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--isl-surface-2)] cursor-pointer text-sm" style={{ color: 'var(--isl-ink)' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedFolderIds.includes(f.id)}
                                            onChange={() => toggleFolder(f.id)}
                                            className="h-3.5 w-3.5"
                                        />
                                        <span className="truncate" style={{ paddingLeft: `${f.depth * 12}px` }}>{f.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-bold block mb-1.5" style={{ color: 'var(--isl-ink-soft)' }}>名称（可选）</label>
                            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="给素材起个名字" className="isl-well px-3 py-2 outline-none w-full text-sm" />
                        </div>
                        <div>
                            <label className="text-sm font-bold block mb-1.5" style={{ color: 'var(--isl-ink-soft)' }}>标签（可选）</label>
                            <div className="flex items-center gap-1.5">
                                <input
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                                    placeholder="输入标签后回车"
                                    className="isl-well px-3 py-2 outline-none flex-1 text-sm"
                                />
                                <button type="button" onClick={addTag} className="isl-icon-btn h-9 w-9 shrink-0" title="添加标签" aria-label="添加标签">
                                    <Plus size={16} />
                                </button>
                            </div>
                            {tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {tags.map(t => (
                                        <button
                                            key={t}
                                            type="button"
                                            onClick={() => setTags(prev => prev.filter(x => x !== t))}
                                            className="rounded-md px-2 py-0.5 text-xs inline-flex items-center gap-1"
                                            style={{ background: 'rgba(25,200,185,0.14)', color: '#19c8b9' }}
                                            title="点击移除"
                                        >
                                            #{t} <X size={10} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 mt-auto pt-2">
                            <button onClick={onClose} className="isl-chip h-auto px-3 py-2">取消</button>
                            <button
                                onClick={() => onConfirm(selectedFolderIds, name || undefined, tags.length > 0 ? tags : undefined)}
                                className="isl-go h-auto px-4 py-2 text-sm"
                            >
                                加入
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
