import { Eye, EyeOff, Lock, Unlock, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { SelectedElementInfo } from './ExcalidrawInner';

interface ExcalidrawLayerPanelProps {
  elements: Array<{ id: string; type: string; name?: string; isDeleted?: boolean; locked?: boolean; customData?: Record<string, unknown> }>;
  selectedIds: string[];
  onSelect: (id: string, additive?: boolean) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
}

const typeIcon: Record<string, string> = {
  image: '🖼', rectangle: '▭', ellipse: '◯', diamond: '◇', text: 'T',
  arrow: '→', line: '─', freedraw: '✎', embeddable: '🎬', frame: '▣',
};

export function ExcalidrawLayerPanel({
  elements, selectedIds, onSelect, onToggleVisible, onToggleLock, onDelete, onRename, onReorder,
}: ExcalidrawLayerPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverPos, setDragOverPos] = useState<'before' | 'after' | null>(null);

  const visibleElements = useMemo(() => elements.filter(e => !e.isDeleted), [elements]);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
    setDragOverId(id);
    setDragOverPos(pos);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== targetId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const pos = e.clientY - rect.top > rect.height / 2 ? 'after' : 'before';
      onReorder(draggedId, targetId, pos);
    }
    setDragOverId(null);
    setDragOverPos(null);
  }, [onReorder]);

  return (
    <aside
      className="excalidraw-layer-panel theme-aware"
      onWheel={e => e.stopPropagation()}
    >
      <div className="excalidraw-layer-panel__header">
        <strong>图层</strong>
        <span className="excalidraw-layer-panel__count">{visibleElements.length}</span>
      </div>
      <div className="excalidraw-layer-panel__list">
        {visibleElements.length === 0 && (
          <p className="excalidraw-layer-panel__empty">画布上暂无元素</p>
        )}
        {[...visibleElements].reverse().map(el => {
          const isSelected = selectedIds.includes(el.id);
          const icon = typeIcon[el.type] || '◆';
          const name = el.name || `${el.type} ${el.id.slice(-4)}`;
          return (
            <div
              key={el.id}
              className={`excalidraw-layer-panel__item${isSelected ? ' is-selected' : ''}${dragOverId === el.id && dragOverPos === 'before' ? ' is-drop-before' : ''}${dragOverId === el.id && dragOverPos === 'after' ? ' is-drop-after' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, el.id)}
              onDragOver={e => handleDragOver(e, el.id)}
              onDragLeave={() => { setDragOverId(null); setDragOverPos(null); }}
              onDrop={e => handleDrop(e, el.id)}
              onClick={e => onSelect(el.id, e.metaKey || e.ctrlKey)}
              onDoubleClick={() => { setEditingId(el.id); setEditName(name); }}
            >
              <span className="excalidraw-layer-panel__icon">{icon}</span>
              {editingId === el.id ? (
                <input
                  className="excalidraw-layer-panel__input"
                  value={editName}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => { onRename(el.id, editName); setEditingId(null); }}
                  onKeyDown={e => { if (e.key === 'Enter') { onRename(el.id, editName); setEditingId(null); } }}
                />
              ) : (
                <span className="excalidraw-layer-panel__name">{name}</span>
              )}
              <div className="excalidraw-layer-panel__actions">
                <button type="button" className="isl-icon-btn h-6 w-6" aria-label={el.customData?.flovartHidden ? '显示' : '隐藏'} onClick={e => { e.stopPropagation(); onToggleVisible(el.id); }}>
                  {el.customData?.flovartHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button type="button" className="isl-icon-btn h-6 w-6" aria-label={el.locked ? '解锁' : '锁定'} onClick={e => { e.stopPropagation(); onToggleLock(el.id); }}>
                  {el.locked ? <Lock size={13} /> : <Unlock size={13} />}
                </button>
                <button type="button" className="isl-icon-btn h-6 w-6" aria-label="删除" onClick={e => { e.stopPropagation(); onDelete(el.id); }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
