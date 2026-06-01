
import React, { useState, useRef, useEffect } from 'react';
import type { Board } from '../types';

interface BoardPanelProps {
    isOpen: boolean;
    onClose: () => void;
    boards: Board[];
    activeBoardId: string;
    onSwitchBoard: (id: string) => void;
    onAddBoard: () => void;
    onRenameBoard: (id: string, name: string) => void;
    onDuplicateBoard: (id: string) => void;
    onDeleteBoard: (id: string) => void;
    generateBoardThumbnail: (elements: Board['elements']) => string;
}

const BoardItem: React.FC<{
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
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);
    
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleBlur = () => {
        setIsEditing(false);
        if (name.trim() === '') {
            setName(board.name);
        } else if (name.trim() !== board.name) {
            onRename(name.trim());
        }
    };
    
    const handleMenuAction = (action: 'rename' | 'duplicate' | 'delete') => {
        setMenuOpen(false);
        switch (action) {
            case 'rename':
                setIsEditing(true);
                break;
            case 'duplicate':
                onDuplicate();
                break;
            case 'delete':
                if (window.confirm(`Are you sure you want to delete "${board.name}"?`)) {
                    onDelete();
                }
                break;
        }
    };

    return (
        <div
            onClick={onClick}
            className={`isl-row group relative cursor-pointer p-2 ${isActive ? 'isl-row--active' : ''}`}
        >
            <div className={`aspect-[3/2] w-full rounded-md mb-2 overflow-hidden border-2 ${isActive ? 'border-white/40' : ''}`} style={isActive ? undefined : { borderColor: 'var(--isl-border)' }}>
                <img src={thumbnail} alt={`${board.name} thumbnail`} className="w-full h-full object-cover" />
            </div>
            <div className="flex items-center justify-between">
                {isEditing ? (
                     <input
                        ref={inputRef}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={handleBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleBlur()}
                        className="w-full bg-transparent border-b border-current/40 outline-none text-sm font-bold"
                        onClick={e => e.stopPropagation()}
                        title="重命名画板"
                        aria-label="重命名画板"
                    />
                ) : (
                    <span className="text-sm font-bold truncate" onDoubleClick={() => setIsEditing(true)}>{board.name}</span>
                )}

                <div className="relative" ref={menuRef}>
                    <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(p => !p); }}
                        className={`isl-icon-btn h-7 w-7 opacity-0 group-hover:opacity-100`}
                        title="画板操作"
                        aria-label="画板操作"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="19" r="2"/></svg>
                    </button>
                    {menuOpen && (
                        <div className="isl-pop absolute right-0 bottom-full mb-1 z-10 w-32 p-1 text-sm">
                            <button onClick={() => handleMenuAction('rename')} className="isl-opt text-sm">Rename</button>
                            <button onClick={() => handleMenuAction('duplicate')} className="isl-opt text-sm">Duplicate</button>
                            <button onClick={() => handleMenuAction('delete')} className="isl-opt text-sm" style={{ color: 'var(--isl-coral-deep)' }}>Delete</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};


export const BoardPanel: React.FC<BoardPanelProps> = ({
    isOpen, onClose, boards, activeBoardId, onSwitchBoard, onAddBoard,
    onRenameBoard, onDuplicateBoard, onDeleteBoard, generateBoardThumbnail
}) => {
    if (!isOpen) return null;

    return (
         <div
            className="isl-panel theme-aware absolute top-4 left-4 z-20 flex flex-col w-64 h-[calc(100vh-2rem)] overflow-hidden"
        >
            <div className="flex-shrink-0 flex justify-between items-center p-3 border-b" style={{ borderColor: 'var(--isl-border)' }}>
                <h3 className="text-base font-bold" style={{ color: 'var(--isl-ink)' }}>Boards</h3>
                <div className="flex items-center gap-1">
                    <button onClick={onAddBoard} className="isl-icon-btn h-8 w-8" title="New Board">
                         <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                    <button onClick={onClose} className="isl-icon-btn h-8 w-8" title="关闭" aria-label="关闭">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
            <div className="flex-grow p-2 overflow-y-auto grid grid-cols-2 gap-2 content-start">
                 {boards.map(board => (
                     <BoardItem 
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
        </div>
    );
};
