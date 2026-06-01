import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Board, Element } from '../types';

interface WorkspaceSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    outerGap: number;
    panelWidth: number;
    boards: Board[];
    activeBoardId: string;
    onSwitchBoard: (id: string) => void;
    onAddBoard: () => void;
    onRenameBoard: (id: string, name: string) => void;
    onDuplicateBoard: (id: string) => void;
    onDeleteBoard: (id: string) => void;
    generateBoardThumbnail: (elements: Board['elements']) => string;
    elements: Element[];
    selectedElementIds: string[];
    onSelectElement: (id: string | null, additive?: boolean) => void;
    onToggleVisibility: (id: string) => void;
    onToggleLock: (id: string) => void;
    onRenameElement: (id: string, name: string) => void;
    onReorder: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
}

const iconProps = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};

function getElementIcon(element: Element) {
    switch (element.type) {
        case 'image':
            return <svg {...iconProps}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>;
        case 'video':
            return <svg {...iconProps}><path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" /></svg>;
        case 'text':
            return <svg {...iconProps}><path d="M4 7V4h16v3" /><path d="M12 4v16" /><path d="M9 20h6" /></svg>;
        case 'shape':
            if (element.shapeType === 'circle') {
                return <svg {...iconProps}><circle cx="12" cy="12" r="9" /></svg>;
            }
            if (element.shapeType === 'triangle') {
                return <svg {...iconProps}><path d="m12 4 8 14H4L12 4Z" /></svg>;
            }
            return <svg {...iconProps}><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;
        case 'path':
            return <svg {...iconProps}><path d="M5 19c5-10 9-10 14-14" /></svg>;
        case 'arrow':
            return <svg {...iconProps}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>;
        case 'line':
            return <svg {...iconProps}><path d="M5 19 19 5" /></svg>;
        case 'group':
            return <svg {...iconProps}><rect x="4" y="7" width="7" height="7" rx="1.5" /><rect x="13" y="10" width="7" height="7" rx="1.5" /></svg>;
        default:
            return <svg {...iconProps}><rect x="4" y="4" width="16" height="16" rx="2" /></svg>;
    }
}

function getElementLabel(element: Element): string {
    if (element.name?.trim()) return element.name.trim();

    const fallback: Record<Element['type'], string> = {
        image: '图片',
        video: '视频',
        text: '文字',
        shape: '形状',
        path: '画笔',
        arrow: '箭头',
        line: '直线',
        group: '组合',
    };

    return `${fallback[element.type]} ${element.id.slice(-4)}`;
}

const BoardMenu: React.FC<{
    onRename: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}> = ({ onRename, onDuplicate, onDelete }) => (
    <div className="isl-pop absolute right-0 top-full z-20 mt-2 w-32 p-1">
        <button type="button" onClick={onRename} className="isl-opt text-sm">
            Rename
        </button>
        <button type="button" onClick={onDuplicate} className="isl-opt text-sm">
            Duplicate
        </button>
        <button type="button" onClick={onDelete} className="isl-opt text-sm" style={{ color: 'var(--isl-coral-deep)' }}>
            Delete
        </button>
    </div>
);

const BoardRow: React.FC<{
    board: Board;
    isActive: boolean;
    thumbnail: string;
    onClick: () => void;
    onRename: (name: string) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}> = ({ board, isActive, thumbnail, onClick, onRename, onDuplicate, onDelete }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(board.name);
    const [menuOpen, setMenuOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setName(board.name);
    }, [board.name]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };

        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const submitRename = () => {
        setIsEditing(false);
        const nextName = name.trim();
        if (!nextName) {
            setName(board.name);
            return;
        }
        if (nextName !== board.name) {
            onRename(nextName);
        }
    };

    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick();
                }
            }}
            className={`isl-row group flex w-full items-center gap-3 px-3 py-2 text-left ${
                isActive ? 'isl-row--active' : ''
            }`}
        >
            <img src={thumbnail} alt={board.name} className="h-12 w-16 rounded-xl border border-white/20 object-cover" />
            <div className="min-w-0 flex-1">
                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onBlur={submitRename}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') submitRename();
                            if (event.key === 'Escape') {
                                setName(board.name);
                                setIsEditing(false);
                            }
                        }}
                        title="重命名画板"
                        aria-label="重命名画板"
                        className="w-full border-none bg-transparent text-sm font-bold outline-none"
                    />
                ) : (
                    <div className="truncate text-sm font-bold">{board.name}</div>
                )}
                <div className={`text-xs ${isActive ? 'text-white/75' : ''}`} style={isActive ? undefined : { color: 'var(--isl-ink-soft)' }}>
                    {board.elements.length} items
                </div>
            </div>
            <div className="relative" ref={menuRef}>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        setMenuOpen(prev => !prev);
                    }}
                    title="画板操作"
                    aria-label="画板操作"
                    className={`isl-icon-btn h-8 w-8 ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                    </svg>
                </button>
                {menuOpen && (
                    <BoardMenu
                        onRename={() => {
                            setMenuOpen(false);
                            setIsEditing(true);
                        }}
                        onDuplicate={() => {
                            setMenuOpen(false);
                            onDuplicate();
                        }}
                        onDelete={() => {
                            setMenuOpen(false);
                            if (window.confirm(`Delete "${board.name}"?`)) {
                                onDelete();
                            }
                        }}
                    />
                )}
            </div>
        </div>
    );
};

const LayerRow: React.FC<{
    element: Element;
    level: number;
    isSelected: boolean;
    hasChildren: boolean;
    isExpanded: boolean;
    onSelect: (event: React.MouseEvent<HTMLDivElement>) => void;
    onToggleExpanded: () => void;
    onToggleVisibility: () => void;
    onToggleLock: () => void;
    onRename: (name: string) => void;
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
}> = ({
    element,
    level,
    isSelected,
    hasChildren,
    isExpanded,
    onSelect,
    onToggleExpanded,
    onToggleVisibility,
    onToggleLock,
    onRename,
    ...dragProps
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(getElementLabel(element));
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setName(getElementLabel(element));
    }, [element]);

    useEffect(() => {
        if (isEditing) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
    }, [isEditing]);

    const commitRename = () => {
        setIsEditing(false);
        const nextName = name.trim();
        if (!nextName) {
            setName(getElementLabel(element));
            return;
        }
        onRename(nextName);
    };

    return (
        <div
            draggable
            {...dragProps}
            onClick={onSelect}
            onDoubleClick={() => setIsEditing(true)}
            className={`isl-layer-row group flex items-center gap-2 rounded-2xl border-[1.5px] border-transparent px-3 py-2 text-left text-sm transition ${
                isSelected ? 'isl-row--active' : ''
            } ${element.isVisible === false ? 'opacity-55' : ''}`}
            style={isSelected ? { paddingLeft: `${12 + level * 18}px` } : { paddingLeft: `${12 + level * 18}px`, color: 'var(--isl-ink)' }}
        >
            <button
                type="button"
                aria-label={isExpanded ? 'Collapse group layer' : 'Expand group layer'}
                title={isExpanded ? 'Collapse group layer' : 'Expand group layer'}
                onClick={(event) => {
                    event.stopPropagation();
                    if (hasChildren) onToggleExpanded();
                }}
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition ${
                    hasChildren ? '' : 'opacity-40'
                }`}
            >
                {hasChildren ? (
                    <svg {...iconProps} width={13} height={13} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                        <path d="m9 6-4 4-4-4" />
                    </svg>
                ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                )}
            </button>
            <span className="isl-avatar flex h-7 w-7 shrink-0 items-center justify-center" style={{ background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--isl-card)', color: isSelected ? '#fff' : 'var(--isl-ink-soft)' }}>
                {getElementIcon(element)}
            </span>
            <div className="min-w-0 flex-1">
                {isEditing ? (
                    <input
                        ref={inputRef}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onBlur={commitRename}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename();
                            if (event.key === 'Escape') {
                                setName(getElementLabel(element));
                                setIsEditing(false);
                            }
                        }}
                        title="重命名图层"
                        aria-label="重命名图层"
                        className="w-full border-none bg-transparent text-sm outline-none"
                    />
                ) : (
                    <div className="truncate font-semibold">{getElementLabel(element)}</div>
                )}
            </div>
            {hasChildren && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--isl-surface-2)', color: isSelected ? '#fff' : 'var(--isl-ink-soft)' }}>
                    {isExpanded ? 'open' : 'group'}
                </span>
            )}
            <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleLock();
                    }}
                    className="isl-icon-btn h-7 w-7"
                >
                    {element.isLocked ? (
                        <svg {...iconProps}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                    ) : (
                        <svg {...iconProps}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.2-2.4" /></svg>
                    )}
                </button>
                <button
                    type="button"
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleVisibility();
                    }}
                    className="isl-icon-btn h-7 w-7"
                >
                    {element.isVisible === false ? (
                        <svg {...iconProps}><path d="M3 3 21 21" /><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" /><path d="M9.4 5.5A11.1 11.1 0 0 1 12 5c7 0 10 7 10 7a17.7 17.7 0 0 1-4 4.9" /><path d="M6.2 6.2A18.7 18.7 0 0 0 2 12s3 7 10 7a10.7 10.7 0 0 0 3.3-.5" /></svg>
                    ) : (
                        <svg {...iconProps}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                    )}
                </button>
            </div>
        </div>
    );
};

export const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
    isOpen,
    onToggle,
    outerGap,
    panelWidth,
    boards,
    activeBoardId,
    onSwitchBoard,
    onAddBoard,
    onRenameBoard,
    onDuplicateBoard,
    onDeleteBoard,
    generateBoardThumbnail,
    elements,
    selectedElementIds,
    onSelectElement,
    onToggleVisibility,
    onToggleLock,
    onRenameElement,
    onReorder,
}) => {
    const [dragOverId, setDragOverId] = useState<string | null>(null);
    const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());

    const orderedElements = useMemo(() => [...elements].reverse(), [elements]);
    const childCountByParent = useMemo(() => {
        const counts = new Map<string, number>();
        elements.forEach((item) => {
            if (item.parentId) counts.set(item.parentId, (counts.get(item.parentId) ?? 0) + 1);
        });
        return counts;
    }, [elements]);

    const handleDragStart = (event: React.DragEvent<HTMLDivElement>, id: string) => {
        event.dataTransfer.setData('text/plain', id);
        event.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        const nextId = event.currentTarget.getAttribute('data-id');
        setDragOverId(nextId);
    };

    const handleDragLeave = () => {
        setDragOverId(null);
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>, targetId: string) => {
        event.preventDefault();
        setDragOverId(null);
        const draggedId = event.dataTransfer.getData('text/plain');
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY - rect.top > rect.height / 2 ? 'after' : 'before';

        if (draggedId && draggedId !== targetId) {
            onReorder(draggedId, targetId, position);
        }
    };

    const renderLayers = (items: Element[], level = 0, parentId?: string): React.ReactNode =>
        items
            .filter(item => item.parentId === parentId)
            .map(item => {
                const hasChildren = (childCountByParent.get(item.id) ?? 0) > 0;
                const isExpanded = expandedGroupIds.has(item.id);
                return (
                    <React.Fragment key={item.id}>
                        <div
                            data-id={item.id}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={(event) => handleDrop(event, item.id)}
                            className={dragOverId === item.id ? 'rounded-2xl' : ''}
                            style={dragOverId === item.id ? { background: 'var(--isl-mint-bg)' } : undefined}
                        >
                            <LayerRow
                                element={item}
                                level={level}
                                isSelected={selectedElementIds.includes(item.id)}
                                hasChildren={hasChildren}
                                isExpanded={isExpanded}
                                onSelect={(event) => onSelectElement(item.id, event.metaKey || event.ctrlKey || event.shiftKey)}
                                onToggleExpanded={() => {
                                    setExpandedGroupIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(item.id)) next.delete(item.id);
                                        else next.add(item.id);
                                        return next;
                                    });
                                }}
                                onToggleVisibility={() => onToggleVisibility(item.id)}
                                onToggleLock={() => onToggleLock(item.id)}
                                onRename={(name) => onRenameElement(item.id, name)}
                                onDragStart={(event) => handleDragStart(event, item.id)}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(event) => handleDrop(event, item.id)}
                            />
                        </div>
                        {(!hasChildren || isExpanded) && renderLayers(items, level + 1, item.id)}
                    </React.Fragment>
                );
            });

    return (
        <div
            className="isl-panel compact-sidebar-panel theme-aware fixed z-[45] overflow-hidden transition-all duration-300"
            style={{
                top: `${outerGap}px`,
                bottom: `${outerGap}px`,
                left: `${outerGap}px`,
                width: `${panelWidth}px`,
                transform: isOpen ? 'translateX(0) scale(1)' : 'translateX(calc(-100% - 12px)) scale(0.97)',
                opacity: isOpen ? 1 : 0,
                pointerEvents: isOpen ? 'auto' : 'none',
            }}
        >
            <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--isl-border)' }}>
                    <div>
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--isl-ink-ghost)' }}>Workspace</div>
                        <div className="text-base font-bold" style={{ color: 'var(--isl-ink)' }}>Boards & Layers</div>
                    </div>
                    <button
                        type="button"
                        onClick={onToggle}
                        className="isl-icon-btn h-9 w-9"
                        title="Toggle sidebar"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                        </svg>
                    </button>
                </div>

                <section className="min-h-[170px] basis-[28%] border-b px-3 py-3" style={{ borderColor: 'var(--isl-border)' }}>
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>Boards</div>
                            <div className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>Scenes and canvases</div>
                        </div>
                        <button
                            type="button"
                            onClick={onAddBoard}
                            className="isl-chip h-auto px-3 py-2 text-sm"
                        >
                            New
                        </button>
                    </div>
                    <div className="flex h-[calc(100%-3.25rem)] flex-col gap-2 overflow-y-auto pr-1">
                        {boards.map(board => (
                            <BoardRow
                                key={board.id}
                                board={board}
                                isActive={board.id === activeBoardId}
                                thumbnail={generateBoardThumbnail(board.elements)}
                                onClick={() => onSwitchBoard(board.id)}
                                onRename={(name) => onRenameBoard(board.id, name)}
                                onDuplicate={() => onDuplicateBoard(board.id)}
                                onDelete={() => onDeleteBoard(board.id)}
                            />
                        ))}
                    </div>
                </section>

                <section className="flex min-h-0 flex-1 flex-col px-3 py-3">
                    <div className="mb-3 flex items-center justify-between">
                        <div>
                            <div className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>Layers</div>
                            <div className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{elements.length} items on canvas</div>
                        </div>
                        {selectedElementIds.length > 0 && (
                            <button
                                type="button"
                                onClick={() => onSelectElement(null)}
                                className="isl-chip h-auto px-3 py-1.5 text-xs"
                            >
                                Clear
                            </button>
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        {elements.length > 0 ? (
                            <div className="space-y-1">{renderLayers(orderedElements)}</div>
                        ) : (
                            <div className="isl-well flex h-full items-center justify-center border-dashed px-4 text-center text-sm" style={{ color: 'var(--isl-ink-ghost)' }}>
                                No layers yet.
                            </div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};
