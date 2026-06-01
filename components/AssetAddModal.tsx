import React from 'react';
import type { AssetCategory } from '../types';

interface AssetAddModalProps {
    isOpen: boolean;
    onClose: () => void;
    previewDataUrl: string;
    onConfirm: (category: AssetCategory, name?: string) => void;
}

export const AssetAddModal: React.FC<AssetAddModalProps> = ({ isOpen, onClose, previewDataUrl, onConfirm }) => {
    const [category, setCategory] = React.useState<AssetCategory>('character');
    const [name, setName] = React.useState<string>('');

    React.useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
            <div className="isl-panel isl-bounce-in w-[680px] max-w-[92vw] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--isl-border)' }}>
                    <strong style={{ color: 'var(--isl-ink)' }}>加入素材库</strong>
                    <button onClick={onClose} className="isl-icon-btn h-8 w-8" title="关闭" aria-label="关闭">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
                <div className="p-4 grid grid-cols-2 gap-4">
                    <div className="isl-well p-2">
                        <img src={previewDataUrl} alt="预览" className="w-full h-64 object-contain" />
                    </div>
                    <div className="flex flex-col gap-3">
                        <label className="text-sm font-bold" style={{ color: 'var(--isl-ink-soft)' }}>分类</label>
                        <div className="isl-tabbar grid w-full max-w-sm grid-cols-3">
                            {(['character','scene','prop'] as AssetCategory[]).map((cat) => (
                                <button key={cat} onClick={() => setCategory(cat)}
                                        className={`isl-tab px-3 py-1.5 text-sm ${category===cat ? 'isl-tab--active' : ''}`}>
                                    {cat==='character'?'角色':cat==='scene'?'场景':'道具'}
                                </button>
                            ))}
                        </div>
                        <label className="text-sm font-bold" style={{ color: 'var(--isl-ink-soft)' }}>名称（可选）</label>
                        <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="给素材起个名字" className="isl-well px-3 py-2 outline-none" />
                        <div className="flex justify-end gap-2 mt-auto pt-2">
                            <button onClick={onClose} className="isl-chip h-auto px-3 py-2">取消</button>
                            <button onClick={()=> onConfirm(category, name || undefined)} className="isl-go h-auto px-4 py-2 text-sm">加入</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};


