import { Bot, Focus, Grid2X2, Hand, Library, MousePointer2, Redo2, Settings2, Type, Undo2, ZoomIn } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useWorkflowSharedMedia, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import type { WorkflowNodeType } from './types';

export type WorkflowTool = 'select' | 'pan';

export function WorkflowToolbar({
  tool,
  canUndo,
  canRedo,
  onToolChange,
  onAddNode,
  onAddSharedMedia,
  onUndo,
  onRedo,
  onFit,
  onToggleGrid,
  onOpenAgent,
  wheelMode,
  setWheelMode,
}: {
  tool: WorkflowTool;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: WorkflowTool) => void;
  onAddNode: (type: WorkflowNodeType) => void;
  onAddSharedMedia: (media: WorkflowSharedMedia) => void;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onToggleGrid: () => void;
  onOpenAgent?: () => void;
  wheelMode?: 'pan' | 'zoom';
  setWheelMode?: (mode: 'pan' | 'zoom') => void;
}) {
  const sharedMedia = useWorkflowSharedMedia();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryType, setLibraryType] = useState<'all' | 'image' | 'video'>('all');
  const visibleMedia = useMemo(() => sharedMedia.filter(media => {
    if (libraryType !== 'all' && media.type !== libraryType) return false;
    return !libraryQuery.trim() || media.name.toLowerCase().includes(libraryQuery.trim().toLowerCase());
  }), [libraryQuery, libraryType, sharedMedia]);
  const btn = (active = false) => `isl-icon-btn h-9 w-9${active ? ' isl-icon-btn--active' : ''}`;
  const divider = <span className="workflow-toolbar__divider" />;
  return (
    <div className="workflow-toolbar theme-aware" role="toolbar" aria-label="工作流工具栏">
      <button type="button" className={btn(tool === 'select')} aria-label="选择工具" onClick={() => onToolChange('select')}><Focus size={18} /></button>
      <button type="button" className={btn(tool === 'pan')} aria-label="平移工具" onClick={() => onToolChange('pan')}><Hand size={18} /></button>
      {divider}
      <button type="button" className={btn()} aria-label="添加文本节点" onClick={() => onAddNode('text')}><Type size={18} /></button>
      <button type="button" className={btn()} aria-label="添加配置节点" onClick={() => onAddNode('config')}><Settings2 size={18} /></button>
      <button type="button" className={btn(libraryOpen)} aria-label="打开共享素材" onClick={() => setLibraryOpen(open => !open)}><Library size={18} /></button>
      {divider}
      <button type="button" className={btn()} aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={18} /></button>
      <button type="button" className={btn()} aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={18} /></button>
      <button type="button" className={btn()} aria-label="适应视图" onClick={onFit}><Focus size={18} /></button>
      <button type="button" className={btn()} aria-label="切换网格" onClick={onToggleGrid}><Grid2X2 size={18} /></button>
      {setWheelMode && wheelMode && <button type="button" className={btn(wheelMode === 'zoom')} aria-label={wheelMode === 'pan' ? '滚轮：平移（点击切换为缩放）' : '滚轮：缩放（点击切换为平移）'} onClick={() => setWheelMode(wheelMode === 'pan' ? 'zoom' : 'pan')}>{wheelMode === 'pan' ? <MousePointer2 size={18} /> : <ZoomIn size={18} />}</button>}
      {onOpenAgent && <>{divider}<button type="button" className={btn()} aria-label="打开 Agent" onClick={onOpenAgent}><Bot size={18} /></button></>}
      {libraryOpen && <div className="workflow-toolbar__library">
        <input value={libraryQuery} placeholder="搜索素材" aria-label="搜索共享素材" onChange={event => setLibraryQuery(event.target.value)} />
        <div className="workflow-toolbar__library-filters">{(['all', 'image', 'video'] as const).map(type => <button type="button" key={type} className={libraryType === type ? 'is-active' : ''} onClick={() => setLibraryType(type)}>{type === 'all' ? '全部' : type === 'image' ? '图片' : '视频'}</button>)}</div>
        <div className="workflow-toolbar__library-grid">{visibleMedia.length ? visibleMedia.map(media => <button type="button" key={media.id} onClick={() => { onAddSharedMedia(media); setLibraryOpen(false); }}>{media.type === 'video' ? <video src={media.href} muted preload="metadata" /> : <img src={media.href} alt="" />}<span>{media.name}</span></button>) : <p>{sharedMedia.length ? '没有匹配的素材。' : '素材库和生成历史为空。'}</p>}</div>
      </div>}
    </div>
  );
}
