import {
  MousePointer2, Hand, Square, Circle, Triangle, ArrowRight,
  Minus, Pencil, Type, ImagePlus, Eraser, Undo2, Redo2, Trash2,
  ZoomIn, ZoomOut, Maximize,
} from 'lucide-react';
import { useCallback } from 'react';

type Tool = 'selection' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'draw' | 'text' | 'image' | 'eraser' | 'hand';

interface FlovartToolbarProps {
  activeTool: Tool;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
}

const tools: Array<{ id: Tool; label: string; icon: typeof Square }> = [
  { id: 'selection', label: '选择', icon: MousePointer2 },
  { id: 'hand', label: '平移', icon: Hand },
  { id: 'rectangle', label: '矩形', icon: Square },
  { id: 'ellipse', label: '椭圆', icon: Circle },
  { id: 'diamond', label: '菱形', icon: Triangle },
  { id: 'arrow', label: '箭头', icon: ArrowRight },
  { id: 'line', label: '线条', icon: Minus },
  { id: 'draw', label: '画笔', icon: Pencil },
  { id: 'text', label: '文本', icon: Type },
  { id: 'image', label: '图片', icon: ImagePlus },
  { id: 'eraser', label: '橡皮', icon: Eraser },
];

export function FlovartToolbar({
  activeTool, onToolChange, onUndo, onRedo, onDelete,
  onZoomIn, onZoomOut, onZoomReset, canUndo, canRedo, hasSelection,
}: FlovartToolbarProps) {
  const btn = (active = false, disabled = false) =>
    `isl-icon-btn h-9 w-9${active ? ' isl-icon-btn--active' : ''}${disabled ? ' opacity-40 cursor-default' : ''}`;
  const divider = <span className="excalidraw-flovart-toolbar__divider" />;

  return (
    <div className="excalidraw-flovart-toolbar theme-aware" role="toolbar" aria-label="画布工具栏">
      {tools.map(t => {
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            className={btn(activeTool === t.id)}
            aria-label={t.label}
            title={t.label}
            onClick={() => onToolChange(t.id)}
          >
            <Icon size={18} />
          </button>
        );
      })}
      {divider}
      <button type="button" className={btn(false, !canUndo)} aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={18} /></button>
      <button type="button" className={btn(false, !canRedo)} aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={18} /></button>
      <button type="button" className={btn(false, !hasSelection)} aria-label="删除" disabled={!hasSelection} onClick={onDelete}><Trash2 size={18} /></button>
      {divider}
      <button type="button" className={btn()} aria-label="放大" onClick={onZoomIn}><ZoomIn size={18} /></button>
      <button type="button" className={btn()} aria-label="缩小" onClick={onZoomOut}><ZoomOut size={18} /></button>
      <button type="button" className={btn()} aria-label="适应视图" onClick={onZoomReset}><Maximize size={18} /></button>
    </div>
  );
}
