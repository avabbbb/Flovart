import { AnimatePresence, motion } from 'motion/react';
import { Bot, FileText, Focus, Grid2X2, Hand, History, Keyboard, Library, Magnet, Map, MousePointer2, Plus, Redo2, RotateCcw, Send, Settings2, SlidersHorizontal, Type, Undo2, Video, Image, Music2, Workflow, Spline, ZoomIn, ZoomOut } from 'lucide-react';
import { Tooltip } from 'antd';
import type React from 'react';
import { useMemo, useRef, useState } from 'react';
import { ResponsivePopover } from '../ResponsivePopover';
import { useWorkflowSharedMedia, type WorkflowSharedMedia } from './WorkflowConfigPanel';
import type { WorkflowNodeType } from './types';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';

export type WorkflowTool = 'select' | 'pan';
type ToolbarPopover = 'add' | 'library' | 'history' | 'tools' | 'shortcuts' | 'zoom';

const Tip: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <Tooltip placement="top" title={title} mouseEnterDelay={0.4} mouseLeaveDelay={0}>{children}</Tooltip>
);

const ADD_OPTIONS: Array<{ type: WorkflowNodeType; icon: typeof Type }> = [
  { type: 'image', icon: Image },
  { type: 'video', icon: Video },
  { type: 'text', icon: Type },
  { type: 'script', icon: FileText },
  { type: 'audio', icon: Music2 },
  { type: 'config', icon: Settings2 },
];

const TOOLBAR_COPY = {
  en: {
    canvasControls: 'Canvas controls', assetManagement: 'Asset management', autoArrange: 'Arrange nodes', minimap: 'Minimap',
    showEdges: 'Show connections', hideEdges: 'Hide connections', snap: 'Snap to grid', zoomReset: 'Reset zoom',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit view', resetZoom: 'Reset zoom to 100%',
    workflowToolbar: 'Workflow toolbar', addNode: 'Add node', tools: 'Tools', toolbox: 'Canvas tools',
    sharedMedia: 'Shared media', undo: 'Undo', redo: 'Redo', history: 'History', historyActions: 'History actions',
    shortcuts: 'Keyboard shortcuts', shortcutsTitle: 'Canvas shortcuts', addNodes: 'Add nodes', pan: 'Pan canvas', duplicate: 'Duplicate',
    delete: 'Delete node', arrange: 'Arrange canvas', selectTool: 'Switch to pan tool', panTool: 'Switch to select tool',
    agentOpen: 'Open Agent', agentClose: 'Close Agent', searchMedia: 'Search shared media', all: 'All', image: 'Image', video: 'Video',
    noMatches: 'No matching media.', emptyLibrary: 'The media library and generation history are empty.', wheelPan: 'Wheel: pan', wheelZoom: 'Wheel: zoom',
    addOption: (type: WorkflowNodeType) => ({ image: 'Image', video: 'Video', text: 'Text', script: 'Script', audio: 'Audio', config: 'Generation settings' }[type] || type),
    zoomPercent: (value: number) => `${value}%`,
    revision: (value: number) => `rev ${value}`, revisionHint: 'Draft revision. Every saved change by you or an Agent advances it.',
    rerunStale: (count: number) => `Rerun ${count} stale`, rerunStaleHint: 'Runs only out-of-date nodes, upstream first. Up-to-date results are reused.',
    sendToHost: (host: string) => `Send to ${host}`, sendHint: 'Adds a send request. Confirm it in the host panel to add the result to the Media Pool. Your timeline is not changed.',
    sendStatus: { requested: 'Waiting for host panel', imported: 'In Media Pool', rejected: 'Host rejected', unknown: 'Check the Media Pool' } as Record<string, string>,
  },
  zho: {
    canvasControls: '画布控制', assetManagement: '资产管理', autoArrange: '一键整理节点', minimap: '小地图',
    showEdges: '显示连线', hideEdges: '隐藏连线', snap: '对齐磁吸', zoomReset: '重置缩放',
    zoomIn: '放大', zoomOut: '缩小', fit: '适应视图', resetZoom: '重置缩放',
    workflowToolbar: '工作流工具栏', addNode: '添加节点', tools: '工具箱', toolbox: '画布工具箱',
    sharedMedia: '共享素材', undo: '撤销', redo: '重做', history: '历史', historyActions: '历史操作',
    shortcuts: '快捷键', shortcutsTitle: '画布快捷键', addNodes: '添加节点', pan: '平移画布', duplicate: '创建副本',
    delete: '删除节点', arrange: '整理画布', selectTool: '切换为平移工具', panTool: '切换为选择工具',
    agentOpen: '打开 Agent', agentClose: '收起 Agent', searchMedia: '搜索共享素材', all: '全部', image: '图片', video: '视频',
    noMatches: '没有匹配的素材。', emptyLibrary: '素材库和生成历史为空。', wheelPan: '滚轮：平移', wheelZoom: '滚轮：缩放',
    addOption: (type: WorkflowNodeType) => ({ image: '图片', video: '视频', text: '文本', script: '脚本', audio: '音频', config: '配置' }[type] || type),
    zoomPercent: (value: number) => `${value}%`,
    revision: (value: number) => `rev ${value}`, revisionHint: '草稿修订号。你或 Agent 每次保存修改都会推进它。',
    rerunStale: (count: number) => `重跑 ${count} 个过期节点`, rerunStaleHint: '只运行过期的节点，上游先跑；未过期的结果直接复用。',
    sendToHost: (host: string) => `发送到 ${host}`, sendHint: '登记一个发送请求，在宿主面板确认后加入 Media Pool；不会改动你的时间线。',
    sendStatus: { requested: '等待宿主面板确认', imported: '已在 Media Pool', rejected: '宿主拒绝了导入', unknown: '请检查 Media Pool' } as Record<string, string>,
  },
} as const;

export function WorkflowToolbar({
  tool,
  canUndo,
  canRedo,
  onToolChange,
  onAddNode,
  onAddSharedMedia,
  onOpenAssets,
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
  revision,
  staleCount = 0,
  onRerunStale,
  hostSend,
  agentOpen,
}: {
  tool: WorkflowTool;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: WorkflowTool) => void;
  onAddNode: (type: WorkflowNodeType) => void;
  onAddSharedMedia: (media: WorkflowSharedMedia) => void;
  onOpenAssets?: () => void;
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
  /** 当前草稿 revision（draftVersion）；人和 Agent 的每次成功 mutation 都会推进它。 */
  revision?: number;
  /** 当前需要重跑的节点数（派生）；大于 0 时显示“只重跑过期节点”。 */
  staleCount?: number;
  onRerunStale?: () => void;
  /** 选中结果可发送回宿主时出现；已登记过时显示状态而不是按钮。 */
  hostSend?: { host: string; onSend: () => void; status?: 'requested' | 'imported' | 'rejected' | 'unknown' };
}) {
  const sharedMedia = useWorkflowSharedMedia();
  const language = useWorkspaceStore(state => state.language);
  const copy = TOOLBAR_COPY[language];
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryType, setLibraryType] = useState<'all' | 'image' | 'video'>('all');
  const [openPopover, setOpenPopover] = useState<ToolbarPopover | null>(null);
  const popoverTriggerRef = useRef<HTMLElement | null>(null);
  const popoverAnchorRef = useRef<HTMLElement | null>(null);
  const addOpen = openPopover === 'add';
  const libraryOpen = openPopover === 'library';
  const historyOpen = openPopover === 'history';
  const toolsOpen = openPopover === 'tools';
  const shortcutsOpen = openPopover === 'shortcuts';
  const zoomOpen = openPopover === 'zoom';
  const togglePopover = (name: ToolbarPopover, trigger: HTMLElement) => {
    if (openPopover === name) { setOpenPopover(null); return; }
    popoverTriggerRef.current = trigger;
    popoverAnchorRef.current = trigger;
    setOpenPopover(name);
  };
  const closePopover = (restoreFocus = false) => {
    setOpenPopover(null);
    if (restoreFocus) requestAnimationFrame(() => popoverTriggerRef.current?.focus());
  };
  const visibleMedia = useMemo(() => sharedMedia.filter(media => {
    if (libraryType !== 'all' && media.type !== libraryType) return false;
    return !libraryQuery.trim() || media.name.toLowerCase().includes(libraryQuery.trim().toLowerCase());
  }), [libraryQuery, libraryType, sharedMedia]);
  const btn = (active = false) => `isl-icon-btn workflow-toolbar__button${active ? ' isl-icon-btn--active' : ''}`;
  const activePopover = openPopover === 'add' ? (
    <ResponsivePopover anchorRef={popoverAnchorRef} preferredSide="up" width={174} role="menu" ariaLabel={copy.addNodes} className="workflow-toolbar__add-menu-content" onRequestClose={() => setOpenPopover(null)}>
      {ADD_OPTIONS.map(option => { const Icon = option.icon; return <motion.button key={option.type} type="button" role="menuitem" className="workflow-toolbar__add-item" onClick={() => { onAddNode(option.type); closePopover(true); }} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}><span className="workflow-toolbar__add-item-icon"><Icon size={16} /></span><span>{copy.addOption(option.type)}</span></motion.button>; })}
    </ResponsivePopover>
  ) : openPopover === 'tools' ? (
    <ResponsivePopover anchorRef={popoverAnchorRef} preferredSide="up" width={174} role="menu" ariaLabel={copy.toolbox} className="workflow-toolbar__compact-menu" onRequestClose={() => setOpenPopover(null)}>
      <button type="button" role="menuitem" onClick={() => { onFit(); closePopover(true); }}><Focus size={15} />{copy.fit}</button>
      <button type="button" role="menuitem" onClick={() => { onToggleGrid(); closePopover(true); }}><Grid2X2 size={15} />{language === 'en' ? 'Toggle grid' : '切换网格'}</button>
      {setWheelMode && wheelMode && <button type="button" role="menuitem" onClick={() => { setWheelMode(wheelMode === 'pan' ? 'zoom' : 'pan'); closePopover(true); }}>{wheelMode === 'pan' ? <MousePointer2 size={15} /> : <ZoomIn size={15} />}{wheelMode === 'pan' ? copy.wheelPan : copy.wheelZoom}</button>}
    </ResponsivePopover>
  ) : openPopover === 'zoom' ? (
    <ResponsivePopover anchorRef={popoverAnchorRef} preferredSide="up" width={174} role="menu" ariaLabel={copy.canvasControls} className="workflow-toolbar__compact-menu" onRequestClose={() => setOpenPopover(null)}>
      <button type="button" role="menuitem" onClick={() => { onZoomIn?.(); closePopover(true); }}><ZoomIn size={15} />{copy.zoomIn}</button>
      <button type="button" role="menuitem" onClick={() => { onZoomOut?.(); closePopover(true); }}><ZoomOut size={15} />{copy.zoomOut}</button>
      <button type="button" role="menuitem" onClick={() => { onFit(); closePopover(true); }}><Focus size={15} />{copy.fit}</button>
      <button type="button" role="menuitem" onClick={() => { onZoomReset?.(); closePopover(true); }}><span>100%</span>{copy.resetZoom}</button>
    </ResponsivePopover>
  ) : openPopover === 'history' ? (
    <ResponsivePopover anchorRef={popoverAnchorRef} preferredSide="up" width={174} role="menu" ariaLabel={copy.historyActions} className="workflow-toolbar__compact-menu" onRequestClose={() => setOpenPopover(null)}>
      <button type="button" role="menuitem" disabled={!canUndo} onClick={() => { onUndo(); closePopover(true); }}><Undo2 size={15} />{copy.undo}</button>
      <button type="button" role="menuitem" disabled={!canRedo} onClick={() => { onRedo(); closePopover(true); }}><Redo2 size={15} />{copy.redo}</button>
    </ResponsivePopover>
  ) : openPopover === 'shortcuts' ? (
    <ResponsivePopover anchorRef={popoverAnchorRef} preferredSide="up" width={240} role="dialog" ariaLabel={copy.shortcutsTitle} className="workflow-toolbar__shortcut-card" onRequestClose={() => setOpenPopover(null)}>
      <strong>{copy.shortcutsTitle}</strong><span><kbd>Double click</kbd> {copy.addNodes.toLowerCase()}</span><span><kbd>Space</kbd> {copy.pan.toLowerCase()}</span><span><kbd>Ctrl D</kbd> {copy.duplicate}</span><span><kbd>Ctrl Z</kbd> {copy.undo}</span><span><kbd>Delete</kbd> {copy.delete}</span><span><kbd>Alt Shift F</kbd> {copy.arrange}</span>
    </ResponsivePopover>
  ) : openPopover === 'library' ? (
    <ResponsivePopover anchorRef={popoverAnchorRef} preferredSide="up" width={280} role="dialog" ariaLabel={copy.sharedMedia} className="workflow-toolbar__library" dataTestId="workflow-toolbar-library" onRequestClose={() => setOpenPopover(null)}>
      <input value={libraryQuery} placeholder={copy.searchMedia} aria-label={copy.searchMedia} onChange={event => setLibraryQuery(event.target.value)} />
      <div className="workflow-toolbar__library-filters">{(['all', 'image', 'video'] as const).map(type => <button type="button" key={type} className={libraryType === type ? 'is-active' : ''} onClick={() => setLibraryType(type)}>{copy[type]}</button>)}</div>
      <div className="workflow-toolbar__library-grid">{visibleMedia.length ? visibleMedia.map(media => <button type="button" key={media.id} title={media.name} onClick={() => { onAddSharedMedia(media); closePopover(true); }}>{media.type === 'video' ? <video src={media.href} muted preload="metadata" /> : <img src={media.href} alt="" />}<span>{media.name}</span></button>) : <p>{sharedMedia.length ? copy.noMatches : copy.emptyLibrary}</p>}</div>
    </ResponsivePopover>
  ) : null;
  return (
    <div className="workflow-toolbar-layer">
    <div className="workflow-canvas-controls theme-aware" role="toolbar" aria-label={copy.canvasControls}>
      <Tip title={copy.assetManagement}><button type="button" className="workflow-canvas-controls__assets" aria-label={copy.assetManagement} onClick={onOpenAssets || (event => togglePopover('library', event.currentTarget))}><Library size={17} /><span>{copy.assetManagement}</span></button></Tip>
      {onAutoLayout && <Tip title={`${copy.autoArrange} Alt+Shift+F`}><button type="button" className={btn()} aria-label={copy.autoArrange} onClick={onAutoLayout}><Workflow size={17} /></button></Tip>}
      {onToggleMinimap && <Tip title={copy.minimap}><button type="button" className={btn(Boolean(minimapOpen))} aria-label={copy.minimap} onClick={onToggleMinimap}><Map size={17} /></button></Tip>}
      {onToggleEdges && <Tip title={edgesVisible === false ? copy.showEdges : copy.hideEdges}><button type="button" className={btn(edgesVisible !== false)} aria-label={edgesVisible === false ? copy.showEdges : copy.hideEdges} onClick={onToggleEdges}><Spline size={17} /></button></Tip>}
      {onToggleSnap && <Tip title={copy.snap}><button type="button" className={btn(Boolean(snapEnabled))} aria-label={copy.snap} onClick={onToggleSnap}><Magnet size={17} /></button></Tip>}
      {typeof revision === 'number' && revision > 0 && (
        <Tip title={copy.revisionHint}><span className="workflow-canvas-controls__revision" data-testid="workflow-revision" aria-label={`${copy.revision(revision)}. ${copy.revisionHint}`} aria-live="polite">{copy.revision(revision)}</span></Tip>
      )}
      {staleCount > 0 && onRerunStale && (
        <Tip title={copy.rerunStaleHint}><button type="button" className="workflow-canvas-controls__action" data-testid="workflow-rerun-stale" onClick={onRerunStale}><RotateCcw size={14} aria-hidden="true" />{copy.rerunStale(staleCount)}</button></Tip>
      )}
      {hostSend && (
        hostSend.status
          ? <span className="workflow-canvas-controls__send-status" role="status" data-testid="workflow-host-send-status">{copy.sendStatus[hostSend.status]}</span>
          : <Tip title={copy.sendHint}><button type="button" className="workflow-canvas-controls__action workflow-canvas-controls__action--primary" data-testid="workflow-host-send" onClick={hostSend.onSend}><Send size={14} aria-hidden="true" />{copy.sendToHost(hostSend.host)}</button></Tip>
      )}
      <div className="workflow-toolbar__zoom-wrap">
        <button type="button" className="workflow-canvas-controls__zoom" aria-label={copy.zoomReset} aria-expanded={zoomOpen} onClick={event => togglePopover('zoom', event.currentTarget)}>{copy.zoomPercent(Math.round((zoomLevel ?? 1) * 100))}</button>
      </div>
    </div>
    <div className="workflow-toolbar theme-aware" role="toolbar" aria-label={copy.workflowToolbar}>
      <div className="workflow-toolbar__add-wrap">
        <Tip title={copy.addNode}><button type="button" className="isl-icon-btn workflow-toolbar__add-btn" aria-label={copy.addNode} aria-expanded={addOpen} onClick={event => togglePopover('add', event.currentTarget)}><motion.span animate={{ rotate: addOpen ? 45 : 0 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}><Plus size={20} /></motion.span></button></Tip>
      </div>
      <Tip title={tool === 'select' ? copy.selectTool : copy.panTool}>
        <button type="button" className={btn()} aria-label={tool === 'select' ? copy.selectTool : copy.panTool} onClick={() => onToolChange(tool === 'select' ? 'pan' : 'select')}>
          <AnimatePresence mode="wait" initial={false}>
            {tool === 'select'
              ? <motion.span key="select" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}><Focus size={18} /></motion.span>
              : <motion.span key="pan" initial={{ opacity: 0, rotate: -90 }} animate={{ opacity: 1, rotate: 0 }} exit={{ opacity: 0, rotate: 90 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}><Hand size={18} /></motion.span>}
          </AnimatePresence>
        </button>
      </Tip>
      <div className="workflow-toolbar__popover-wrap">
        <Tip title={copy.tools}><button type="button" className={btn(toolsOpen)} aria-label={copy.tools} aria-expanded={toolsOpen} onClick={event => togglePopover('tools', event.currentTarget)}><SlidersHorizontal size={18} /></button></Tip>
      </div>
      <Tip title={copy.sharedMedia}><button type="button" className={btn(libraryOpen)} aria-label={copy.sharedMedia} aria-expanded={libraryOpen} onClick={event => togglePopover('library', event.currentTarget)}><Library size={18} /></button></Tip>
      <Tip title={copy.undo}><button type="button" className={`${btn()} workflow-toolbar__history-direct`} aria-label={copy.undo} disabled={!canUndo} onClick={onUndo}><Undo2 size={17} /></button></Tip>
      <Tip title={copy.redo}><button type="button" className={`${btn()} workflow-toolbar__history-direct`} aria-label={copy.redo} disabled={!canRedo} onClick={onRedo}><Redo2 size={17} /></button></Tip>
      <div className="workflow-toolbar__popover-wrap"><Tip title={copy.history}><button type="button" className={btn(historyOpen)} aria-label={copy.history} aria-expanded={historyOpen} onClick={event => togglePopover('history', event.currentTarget)}><History size={18} /></button></Tip></div>
      <div className="workflow-toolbar__popover-wrap"><Tip title={copy.shortcuts}><button type="button" className={btn(shortcutsOpen)} aria-label={copy.shortcuts} aria-expanded={shortcutsOpen} onClick={event => togglePopover('shortcuts', event.currentTarget)}><Keyboard size={18} /></button></Tip></div>
      {onOpenAgent && <Tip title={agentOpen ? copy.agentClose : copy.agentOpen}><button type="button" className={btn(Boolean(agentOpen))} aria-label={agentOpen ? copy.agentClose : copy.agentOpen} aria-pressed={Boolean(agentOpen)} onClick={() => { closePopover(); onOpenAgent(); }}><Bot size={18} /></button></Tip>}
    </div>
    {activePopover}
    </div>
  );
}
