import React, { useMemo, useRef, useState, useEffect } from 'react';
import type { AssetLibrary, AssetCategory, AssetItem } from '../types';

interface AssetLibraryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    library: AssetLibrary;
    onRemove: (category: AssetCategory, id: string) => void;
    onRename: (category: AssetCategory, id: string, name: string) => void;
    docked?: boolean; // 右侧停靠
    initialWidth?: number; // 停靠时默认宽度
    onGenerate?: (prompt: string) => void; // 顶部输入框生成
    onReversePrompt?: (imageDataUrl: string, mimeType: string, width?: number, height?: number) => void; // 反推 Prompt
}

const CategoryTabs: React.FC<{ value: AssetCategory; onChange: (c: AssetCategory) => void }>=({ value, onChange }) => (
    <div className="isl-tabbar">
        {(['character','scene','prop'] as AssetCategory[]).map(cat => (
            <button key={cat} onClick={() => onChange(cat)} className={`isl-tab px-3 py-1.5 text-sm ${value===cat ? 'isl-tab--active' : ''}`}>{cat === 'character' ? '角色' : cat === 'scene' ? '场景' : '道具'}</button>
        ))}
    </div>
);

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({ isOpen, onClose, library, onRemove, onRename, docked = false, initialWidth, onGenerate, onReversePrompt }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const [category, setCategory] = useState<AssetCategory>('character');
    const [dragItem, setDragItem] = useState<AssetItem | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string>('');
    const editInputRef = useRef<HTMLInputElement>(null);
    
    // Panel drag/size (docked: width only; modal: pos + size)
    const [panelPosition, setPanelPosition] = useState({ x: 0, y: 64 });
    const [panelSize, setPanelSize] = useState<{ width: number; height: number }>({ width: initialWidth || 420, height: 560 });
    const [isDraggingPanel, setIsDraggingPanel] = useState(false);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStartPointer, setResizeStartPointer] = useState({ x: 0, y: 0 });
    const [resizeStartSize, setResizeStartSize] = useState({ width: 800, height: 560 });

    useEffect(() => {
        if (!isOpen) return;
        if (docked) {
            // Docked: set default width and full height
            const defaultWidth = Math.min(560, Math.max(360, initialWidth || 420));
            setPanelSize({ width: defaultWidth, height: window.innerHeight - 32 });
            setPanelPosition({ x: window.innerWidth - defaultWidth - 16, y: 16 });
        } else {
            // Modal center
            const w = Math.min(960, Math.max(520, Math.round(window.innerWidth * 0.7)));
            const h = Math.min(Math.round(window.innerHeight * 0.7), 720);
            setPanelSize({ width: w, height: h });
            setPanelPosition({ x: Math.max(0, Math.round((window.innerWidth - w) / 2)), y: 64 });
        }

        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose, docked, initialWidth]);

    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    // Panel dragging handlers
    const handlePanelPointerDown = (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        setIsDraggingPanel(true);
        setDragOffset({ x: e.clientX - panelPosition.x, y: e.clientY - panelPosition.y });
    };

    useEffect(() => {
        if (!isDraggingPanel && !isResizing) return;

        const handlePointerMove = (e: PointerEvent) => {
            if (isDraggingPanel && !docked) {
                const maxX = Math.max(0, window.innerWidth - panelSize.width);
                const maxY = Math.max(0, window.innerHeight - panelSize.height);
                const newX = Math.min(maxX, Math.max(0, e.clientX - dragOffset.x));
                const newY = Math.min(maxY, Math.max(0, e.clientY - dragOffset.y));
                setPanelPosition({ x: newX, y: newY });
            } else if (isResizing) {
                if (docked) {
                    const dx = e.clientX - resizeStartPointer.x; // dragging from left edge
                    const minW = 320; const maxW = Math.min(960, window.innerWidth - 160);
                    const nextW = Math.min(maxW, Math.max(minW, resizeStartSize.width - dx));
                    const nextX = window.innerWidth - nextW - 16;
                    setPanelSize(prev => ({ ...prev, width: nextW }));
                    setPanelPosition(prev => ({ ...prev, x: nextX, y: 16 }));
                } else {
                    const dx = e.clientX - resizeStartPointer.x;
                    const dy = e.clientY - resizeStartPointer.y;
                    const minW = 520; const minH = 320;
                    const maxW = Math.min(1200, window.innerWidth - 32);
                    const maxH = Math.min(900, window.innerHeight - 32);
                    const nextW = Math.min(maxW, Math.max(minW, resizeStartSize.width + dx));
                    const nextH = Math.min(maxH, Math.max(minH, resizeStartSize.height + dy));
                    setPanelSize({ width: nextW, height: nextH });
                }
            }
        };

        const handlePointerUp = () => {
            setIsDraggingPanel(false);
            setIsResizing(false);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [isDraggingPanel, isResizing, dragOffset, resizeStartPointer, resizeStartSize, panelSize.width, panelSize.height]);

    const handleResizePointerDown = (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        setIsResizing(true);
        setResizeStartPointer({ x: e.clientX, y: e.clientY });
        setResizeStartSize({ width: panelSize.width, height: panelSize.height });
        e.stopPropagation();
    };

    if (!isOpen) return null;

    const items = library[category];

    const handleDragStart = (e: React.DragEvent, item: AssetItem) => {
        setDragItem(item);
        e.dataTransfer.setData('text/plain', JSON.stringify({ __makingAsset: true, item }));
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleNameEdit = (cat: AssetCategory, id: string, current?: string) => {
        const name = window.prompt('重命名素材', current || '');
        if (name != null) onRename(cat, id, name);
    };

    const handleDoubleClick = (item: AssetItem) => {
        setEditingId(item.id);
        setEditingName(item.name || '');
    };

    const handleSaveEdit = (itemId: string) => {
        if (editingId === itemId && editingName.trim()) {
            onRename(category, itemId, editingName.trim());
        }
        setEditingId(null);
        setEditingName('');
    };

    const handleKeyDown = (e: React.KeyboardEvent, itemId: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSaveEdit(itemId);
        } else if (e.key === 'Escape') {
            setEditingId(null);
            setEditingName('');
        }
    };

    return (
        <>
            {/* Backdrop overlay - click to close (only modal mode) */}
            {!docked && (
                <div 
                    className="fixed inset-0 bg-black/20 z-20"
                    onClick={onClose}
                />
            )}
            
            {/* Draggable + Resizable panel */}
            <div
                className={`isl-panel theme-aware fixed ${docked ? 'right-4 top-4' : ''} z-30 overflow-hidden`}
                ref={panelRef}
                style={{
                    left: docked ? undefined : `${panelPosition.x}px`,
                    top: docked ? undefined : `${panelPosition.y}px`,
                    width: `${panelSize.width}px`,
                    height: docked ? `${window.innerHeight - 32}px` : `${panelSize.height}px`,
                    cursor: isDraggingPanel ? 'grabbing' : 'default'
                }}
            >
                {/* Draggable header */}
                <div
                    ref={headerRef}
                    className={`flex flex-wrap items-center justify-between gap-3 p-3 border-b ${docked ? '' : 'cursor-move select-none'}`}
                    style={{ borderColor: 'var(--isl-border)' }}
                    onPointerDown={docked ? undefined : handlePanelPointerDown}
                >
                    <div className="flex items-center gap-3">
                        <strong style={{ color: 'var(--isl-ink)' }}>灵感库</strong>
                        <CategoryTabs value={category} onChange={setCategory} />
                    </div>
                    <button
                        onClick={onClose}
                        className="isl-icon-btn h-8 w-8"
                        aria-label="关闭"
                        title="关闭"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            {/* prompt input */}
            {onGenerate && (
                <div className="p-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--isl-border)' }}>
                    <input
                        type="text"
                        placeholder="描述你想要生成的图片..."
                        className="isl-well flex-1 px-3 py-2 outline-none"
                        onKeyDown={(e) => {
                            const target = e.target as HTMLInputElement;
                            if (e.key === 'Enter' && target.value.trim()) {
                                onGenerate(target.value.trim());
                                target.value = '';
                            }
                        }}
                    />
                    <button
                        className="isl-go h-auto px-4 py-2 text-sm"
                        onClick={() => {
                            const el = panelRef.current?.querySelector('input[type="text"]') as HTMLInputElement | null;
                            if (el && el.value.trim()) { onGenerate(el.value.trim()); el.value = ''; }
                        }}
                    >生成</button>
                </div>
            )}
            <div className="p-3 overflow-y-auto" style={{ height: docked ? `calc(100% - ${onGenerate ? 56+48 : 56}px)` : `calc(${panelSize.height}px - ${onGenerate ? 56+48 : 56}px)` }}>
                {items.length === 0 && (
                    <div className="w-full text-center py-10" style={{ color: 'var(--isl-ink-soft)' }}>该分类暂无素材，选中图片后使用"加入素材库"按钮添加</div>
                )}
                <div className="columns-2 md:columns-3 lg:columns-4 gap-3 [column-fill:balance]">
                    {items.map(item => (
                        <div
                            key={item.id}
                            className="isl-elastic group inline-block w-full mb-3 break-inside-avoid rounded-2xl border-[1.5px] overflow-hidden cursor-grab active:cursor-grabbing relative"
                            style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-2)' }}
                            draggable
                            onDragStart={(e) => handleDragStart(e, item)}
                        >
                            <img src={item.dataUrl} alt={item.name || ''} className="w-full h-auto object-contain" style={{ background: 'var(--isl-surface-2)' }} />

                            {/* Hover overlay with info */}
                            {editingId === item.id ? (
                                <div className="absolute inset-x-2 bottom-2 flex items-center gap-2">
                                    <input
                                        ref={editInputRef}
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        onBlur={() => handleSaveEdit(item.id)}
                                        onKeyDown={(e) => handleKeyDown(e, item.id)}
                                        className="isl-well text-xs px-2 py-1 outline-none min-w-0 flex-1"
                                        placeholder="输入素材名称"
                                        aria-label="素材名称"
                                    />
                                </div>
                            ) : (
                                <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
                                    <div className="absolute bottom-2 left-2 right-2 text-white flex items-end justify-between gap-2">
                                        <div className="min-w-0 pointer-events-auto" onDoubleClick={() => handleDoubleClick(item)}>
                                            <div className="text-[13px] font-medium truncate">{item.name || '未命名'}</div>
                                            <div className="text-[11px] opacity-80">{item.width}×{item.height}</div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {onReversePrompt && (
                                                <button
                                                    className="pointer-events-auto p-1 rounded bg-white/10 hover:bg-white/20"
                                                    title="反推 Prompt"
                                                    onClick={(e) => { e.stopPropagation(); onReversePrompt(item.dataUrl, 'image/png', item.width, item.height); }}
                                                >
                                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                                </button>
                                            )}
                                            <button 
                                                className="pointer-events-auto p-1 rounded bg-white/10 hover:bg-white/20"
                                                title="删除"
                                                onClick={(e) => { e.stopPropagation(); onRemove(category, item.id); }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-white"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
                {/* Resize handle */}
                <div
                    className={`absolute ${docked ? 'left-2 top-1/2 -translate-y-1/2 cursor-ew-resize' : 'right-2 bottom-2 cursor-se-resize'} w-4 h-4`}
                    style={{ color: 'var(--isl-ink-ghost)' }}
                    onPointerDown={handleResizePointerDown}
                    aria-label="调整大小"
                >
                    {docked ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6v12"/><path d="M16 6v12"/></svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20h-6"/><path d="M20 16h-2"/><path d="M16 20v-2"/></svg>
                    )}
                </div>
            </div>
        </>
    );
};


