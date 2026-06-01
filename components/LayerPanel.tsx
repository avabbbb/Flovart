


import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { Element } from '../types';

interface LayerPanelProps {
    isOpen: boolean;
    onClose: () => void;
    elements: Element[];
    selectedElementIds: string[];
    onSelectElement: (id: string | null) => void;
    onToggleVisibility: (id: string) => void;
    onToggleLock: (id: string) => void;
    onRenameElement: (id: string, name: string) => void;
    onReorder: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
}

const getElementIcon = (element: Element): React.ReactNode => {
    const commonProps = {
        width: "16",
        height: "16",
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
    };

    switch (element.type) {
        case 'image': 
            return <svg {...commonProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>;
        case 'video': 
            return <svg {...commonProps}><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>;
        case 'text': 
            return <svg {...commonProps}><polyline points="4 7 4 4 20 4 20 7"></polyline><line x1="9" y1="20" x2="15" y2="20"></line><line x1="12" y1="4" x2="12" y2="20"></line></svg>;
        case 'shape':
            switch (element.shapeType) {
                case 'rectangle': return <svg {...commonProps}><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /></svg>;
                case 'circle': return <svg {...commonProps}><circle cx="12" cy="12" r="10" /></svg>;
                case 'triangle': return <svg {...commonProps}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>;
            }
            break;
        case 'group': 
            return <svg {...commonProps}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>;
        case 'path': 
            return <svg {...commonProps}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>;
        case 'arrow': 
            return <svg {...commonProps}><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>;
        case 'line': 
            return <svg {...commonProps}><line x1="5" y1="19" x2="19" y2="5"></line></svg>;
        default: 
            return <svg {...commonProps}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>;
    }
    return <svg {...commonProps}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path></svg>;
};

const LayerItem: React.FC<{
    element: Element;
    level: number;
    isSelected: boolean;
    onSelect: () => void;
    onToggleVisibility: () => void;
    onToggleLock: () => void;
    onRename: (name: string) => void;
    onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
    onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
}> = ({ element, level, isSelected, onSelect, onToggleVisibility, onToggleLock, onRename, ...dragProps }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [name, setName] = useState(element.name || element.type);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setName(element.name || element.type);
    }, [element.name, element.type]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);
    
    const handleBlur = () => {
        setIsEditing(false);
        if (name.trim() === '') {
            setName(element.name || element.type);
        } else {
            onRename(name);
        }
    };
    
    const iconProps = {
        width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", 
        stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round" as const, strokeLinejoin: "round" as const
    };

    return (
        <div
            draggable
            {...dragProps}
            onClick={onSelect}
            onDoubleClick={() => setIsEditing(true)}
            className={`isl-layer-row group flex items-center space-x-2 rounded-2xl border-[1.5px] border-transparent p-1.5 text-sm ${
                isSelected ? 'isl-row--active' : ''
            } ${element.isVisible === false ? 'opacity-50' : ''}`}
            style={isSelected ? { paddingLeft: `${10 + level * 20}px` } : { paddingLeft: `${10 + level * 20}px`, color: 'var(--isl-ink)' }}
        >
            <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center" style={{ color: isSelected ? '#fff' : 'var(--isl-ink-ghost)' }}>{getElementIcon(element)}</span>
            {isEditing ? (
                <input
                    ref={inputRef}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
                    className="flex-grow bg-transparent border-b border-current/40 outline-none"
                    onClick={e => e.stopPropagation()}
                    title="重命名图层"
                    aria-label="重命名图层"
                />
            ) : (
                <span className="flex-grow truncate font-semibold">{name}</span>
            )}
            <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
                    className="isl-icon-btn h-6 w-6"
                    title={element.isLocked ? "Unlock" : "Lock"}
                >
                    {element.isLocked ?
                        <svg {...iconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg> :
                        <svg {...iconProps}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>
                    }
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleVisibility(); }}
                    className="isl-icon-btn h-6 w-6"
                    title={element.isVisible === false ? "Show" : "Hide"}
                >
                    {element.isVisible === false ? 
                        <svg {...iconProps}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg> : 
                        <svg {...iconProps}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                    }
                </button>
            </div>
        </div>
    );
};

export const LayerPanel: React.FC<LayerPanelProps> = ({ isOpen, onClose, elements, selectedElementIds, onSelectElement, onToggleVisibility, onToggleLock, onRenameElement, onReorder }) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        const target = e.currentTarget;
        const id = target.getAttribute('data-id');
        setDragOverId(id);
        target.style.background = 'var(--isl-mint-bg)';
    };
    
    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.currentTarget.style.background = '';
        setDragOverId(null);
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetId: string) => {
        e.preventDefault();
        e.currentTarget.style.background = '';
        setDragOverId(null);
        const draggedId = e.dataTransfer.getData('text/plain');

        const rect = e.currentTarget.getBoundingClientRect();
        const position = e.clientY - rect.top > rect.height / 2 ? 'after' : 'before';

        if (draggedId && targetId && draggedId !== targetId) {
            onReorder(draggedId, targetId, position);
        }
    };
    
    const elementMap = useMemo(() => new Map(elements.map(el => [el.id, el])), [elements]);
    const rootElements = useMemo(() => elements.filter(el => !el.parentId), [elements]);

    const renderLayers = (elementIds: string[], level: number) => {
        return elementIds.map(id => {
            const element = elementMap.get(id);
            if (!element) return null;

            const childrenIds = elements.filter(el => el.parentId === id).map(el => el.id);

            return (
                <React.Fragment key={id}>
                    <div data-id={id} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, id)}>
                        <LayerItem
                            element={element}
                            level={level}
                            isSelected={selectedElementIds.includes(id)}
                            onSelect={() => onSelectElement(id)}
                            onToggleLock={() => onToggleLock(id)}
                            onToggleVisibility={() => onToggleVisibility(id)}
                            onRename={name => onRenameElement(id, name)}
                            onDragStart={e => handleDragStart(e, id)}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, id)}
                        />
                    </div>
                    {childrenIds.length > 0 && renderLayers(childrenIds, level + 1)}
                </React.Fragment>
            );
        });
    };

    // Render elements in their actual array order for Z-index representation
    const renderOrderedLayers = (elements: Element[], level: number = 0, parentId?: string) => {
        return elements
            .filter(el => el.parentId === parentId)
            .map(element => (
                <React.Fragment key={element.id}>
                     <div data-id={element.id} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={(e) => handleDrop(e, element.id)}>
                        <LayerItem
                            element={element}
                            level={level}
                            isSelected={selectedElementIds.includes(element.id)}
                            onSelect={() => onSelectElement(element.id)}
                            onToggleLock={() => onToggleLock(element.id)}
                            onToggleVisibility={() => onToggleVisibility(element.id)}
                            onRename={name => onRenameElement(element.id, name)}
                            onDragStart={e => handleDragStart(e, element.id)}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, element.id)}
                        />
                     </div>
                    {renderOrderedLayers(elements, level + 1, element.id)}
                </React.Fragment>
            ));
    };


    if (!isOpen) return null;

    return (
        <div
            ref={panelRef}
            className="isl-panel theme-aware absolute top-4 left-20 z-[30] flex flex-col w-64 h-[calc(100vh-2rem)] overflow-hidden transition-all duration-300 ease-out"
        >
            <div className="flex-shrink-0 flex justify-between items-center p-3 border-b cursor-move" style={{ borderColor: 'var(--isl-border)' }}>
                <h3 className="text-base font-bold" style={{ color: 'var(--isl-ink)' }}>Layers</h3>
                <button onClick={onClose} className="isl-icon-btn h-8 w-8" title="关闭" aria-label="关闭">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
            <div className="flex-grow p-2 overflow-y-auto space-y-1">
                 {renderOrderedLayers([...elements].reverse())}
            </div>
            <div className="flex-shrink-0 p-2 border-t" style={{ borderColor: 'var(--isl-border)' }}>
                <button onClick={onClose} className="isl-chip h-auto w-full justify-center py-1.5 text-sm" title="收起图层">收起</button>
            </div>
        </div>
    );
};
