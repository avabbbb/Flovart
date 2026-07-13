import { AnimatePresence, motion } from 'motion/react';
import { Bot, FileText, Focus, Grid2X2, Hand, Library, Magnet, Map, MousePointer2, Plus, Redo2, Settings2, Type, Undo2, Video, Image, Music2, Workflow, Spline, ZoomIn, ZoomOut } from 'lucide-react';
import { Tooltip } from 'antd';
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowSharedMedia, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import type { WorkflowNodeType } from './types';

export type WorkflowTool = 'select' | 'pan';

const Tip: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Tooltip placement="top" title={title} mouseEnterDelay={0.4} mouseLeaveDelay={0}>{children}</Tooltip>
);

const ADD_OPTIONS: Array<{ type: WorkflowNodeType; title: string; icon: typeof Type }> = [
  { type: 'image', title: '图片', icon: Image },
  { type: 'video', title: '视频', icon: Video },
  { type: 'text', title: '文本', icon: Type },
  { type: 'script', title: '脚本', icon: FileText },
  { type: 'audio', title: '音频', icon: Music2 },
  { type: 'config', title: '配置', icon: Settings2 },
];

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
  minimapOpen,
  onToggleMinimap,
  snapEnabled,
  onToggleSnap,
  edgesVisible,
  onToggleEdges,
  onAutoLayout,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  agentOpen,
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
  agentOpen?: boolean;
  wheelMode?: 'pan' | 'zoom';
  setWheelMode?: (mode: 'pan' | 'zoom') => void;
  minimapOpen?: boolean;
  onToggleMinimap?: () => void;
  snapEnabled?: boolean;
  onToggleSnap?: () => void;
  edgesVisible?: boolean;
  onToggleEdges?: () => void;
  onAutoLayout?: () => void;
  zoomLevel?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}) {
  const sharedMedia = useWorkflowSharedMedia();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryType, setLibraryType] = useState<'all' | 'image' | 'video'>('all');
  const [addOpen, setAddOpen] = useState(false);
  const addWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addOpen) return;
    const handler = (event: MouseEvent) => {
      if (addWrapRef.current && !addWrapRef.current.contains(event.target as Node)) setAddOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [addOpen]);
  const visibleMedia = useMemo(() => sharedMedia.filter(media => {
    if (libraryType !== 'all' && media.type !== libraryType) return false;
    return !libraryQuery.trim() || media.name.toLowerCase().includes(libraryQuery.trim().toLowerCase());
  }), [libraryQuery, libraryType, sharedMedia]);
  const btn = (active = false) => `isl-icon-btn h-9 w-9${active ? ' isl-icon-btn--active' : ''}`;
  const divider = <span className="workflow-toolbar__divider" />;
  return (
    <div className="workflow-toolbar theme-aware" role="toolbar" aria-label="工作流工具栏">
      <Tip title={tool === 'select' ? '当前：选择（点击切换为平移）' : '当前：平移（点击切换为选择）'}>
        <button type="button" className={btn()} aria-label={tool === 'select' ? '切换为平移工具' : '切换为选择工具'} onClick={() => onToolChange(tool === 'select' ? 'pan' : 'select')}>
          <AnimatePresence mode="wait" initial={false}>
            {tool === 'select'
              ? <motion.span key="select" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}><Focus size={18} /></motion.span>
              : <motion.span key="pan" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}><Hand size={18} /></motion.span>}
          </AnimatePresence>
        </button>
      </Tip>
      {divider}
      <div ref={addWrapRef} className="workflow-toolbar__add-wrap">
        <Tip title="添加节点">
          <button type="button" className="isl-icon-btn workflow-toolbar__add-btn" aria-label="添加节点" aria-expanded={addOpen} onClick={() => setAddOpen(open => !open)}>
            <motion.span animate={{ rotate: addOpen ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}><Plus size={20} /></motion.span>
          </button>
        </Tip>
        <AnimatePresence>
          {addOpen && (
            <motion.div
              className="workflow-toolbar__add-menu"
              role="menu"
              aria-label="添加节点"
              initial={{ opacity: 0, scale: 0.9, y: -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -6 }}
              transition={{ type: 'spring', stiffness: 420, damping: 28, mass: 0.7 }}
            >
              {ADD_OPTIONS.map((option) => {
                const Icon = option.icon;
                return (
                  <motion.button
                    key={option.type}
                    type="button"
                    role="menuitem"
                    className="workflow-toolbar__add-item"
                    onClick={() => { onAddNode(option.type); setAddOpen(false); }}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 32, mass: 0.5 }}
                  >
                    <span className="workflow-toolbar__add-item-icon"><Icon size={16} /></span>
                    <span>{option.title}</span>
                  </motion.button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Tip title="共享素材">
        <button type="button" className={btn(libraryOpen)} aria-label="共享素材" onClick={() => setLibraryOpen(open => !open)}><Library size={18} /></button>
      </Tip>
      {divider}
      <Tip title="撤销">
        <button type="button" className={btn()} aria-label="撤销" disabled={!canUndo} onClick={onUndo}><Undo2 size={18} /></button>
      </Tip>
      <Tip title="重做">
        <button type="button" className={btn()} aria-label="重做" disabled={!canRedo} onClick={onRedo}><Redo2 size={18} /></button>
      </Tip>
      <Tip title="适应视图">
        <button type="button" className={btn()} aria-label="适应视图" onClick={onFit}><Focus size={18} /></button>
      </Tip>
      <Tip title="网格">
        <button type="button" className={btn()} aria-label="网格" onClick={onToggleGrid}><Grid2X2 size={18} /></button>
      </Tip>
      {setWheelMode && wheelMode && (
        <Tip title={wheelMode === 'pan' ? '滚轮：平移（点击切换为缩放）' : '滚轮：缩放（点击切换为平移）'}>
          <button type="button" className={btn(wheelMode === 'zoom')} aria-label={wheelMode === 'pan' ? '滚轮：平移（点击切换为缩放）' : '滚轮：缩放（点击切换为平移）'} onClick={() => setWheelMode(wheelMode === 'pan' ? 'zoom' : 'pan')}>{wheelMode === 'pan' ? <MousePointer2 size={18} /> : <ZoomIn size={18} />}</button>
        </Tip>
      )}
      {onToggleMinimap && (
        <Tip title="小地图">
          <button type="button" className={btn(Boolean(minimapOpen))} aria-label="小地图" onClick={onToggleMinimap}><Map size={18} /></button>
        </Tip>
      )}
      {onToggleSnap && (
        <Tip title="对齐磁吸">
          <button type="button" className={btn(Boolean(snapEnabled))} aria-label="对齐磁吸" onClick={onToggleSnap}><Magnet size={18} /></button>
        </Tip>
      )}
      {onToggleEdges && (
        <Tip title={edgesVisible === false ? '显示连线' : '隐藏连线'}>
          <button type="button" className={btn(edgesVisible !== false)} aria-label={edgesVisible === false ? '显示连线' : '隐藏连线'} onClick={onToggleEdges}><Spline size={18} /></button>
        </Tip>
      )}
      {onAutoLayout && (
        <Tip title="一键整理节点">
          <button type="button" className={btn()} aria-label="一键整理节点" onClick={onAutoLayout}><Workflow size={18} /></button>
        </Tip>
      )}
      {onZoomOut && (
        <Tip title="缩小">
          <button type="button" className={btn()} aria-label="缩小" onClick={onZoomOut}><ZoomOut size={18} /></button>
        </Tip>
      )}
      {onZoomReset && (
        <Tip title="重置为 100%">
          <button type="button" className="isl-icon-btn h-9 min-w-[3.25rem] px-1 tabular-nums text-[11px] font-bold" aria-label="重置缩放" onClick={onZoomReset}>{Math.round((zoomLevel ?? 1) * 100)}%</button>
        </Tip>
      )}
      {onZoomIn && (
        <Tip title="放大">
          <button type="button" className={btn()} aria-label="放大" onClick={onZoomIn}><Plus size={18} /></button>
        </Tip>
      )}
      {onOpenAgent && <>{divider}<Tip title={agentOpen ? '收起 Agent' : '打开 Agent'}><button type="button" className={btn(Boolean(agentOpen))} aria-label={agentOpen ? '收起 Agent' : '打开 Agent'} aria-pressed={Boolean(agentOpen)} onClick={onOpenAgent}><Bot size={18} /></button></Tip></>}
      {libraryOpen && <div className="workflow-toolbar__library">
        <input value={libraryQuery} placeholder="搜索素材" aria-label="搜索共享素材" onChange={event => setLibraryQuery(event.target.value)} />
        <div className="workflow-toolbar__library-filters">{(['all', 'image', 'video'] as const).map(type => <button type="button" key={type} className={libraryType === type ? 'is-active' : ''} onClick={() => setLibraryType(type)}>{type === 'all' ? '全部' : type === 'image' ? '图片' : '视频'}</button>)}</div>
        <div className="workflow-toolbar__library-grid">{visibleMedia.length ? visibleMedia.map(media => <button type="button" key={media.id} onClick={() => { onAddSharedMedia(media); setLibraryOpen(false); }}>{media.type === 'video' ? <video src={media.href} muted preload="metadata" /> : <img src={media.href} alt="" />}<span>{media.name}</span></button>) : <p>{sharedMedia.length ? '没有匹配的素材。' : '素材库和生成历史为空。'}</p>}</div>
      </div>}
    </div>
  );
}