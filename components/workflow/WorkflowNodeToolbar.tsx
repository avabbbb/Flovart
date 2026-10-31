import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, AudioLines, ChevronsDown, ChevronsUp, Copy, Crop, Download, Eraser, Expand, FilePenLine, Frame, Grid2x2, Group, Layers, Layers3, Library, Lightbulb, Maximize2, MessageSquareText, Play, RefreshCw, RotateCw, ScanLine, ScanText, Scissors, SlidersHorizontal, Square, Trash2, Ungroup, ZoomIn, Gauge, Palette, PenTool, Move } from 'lucide-react';
import { AlignHorizontalSpaceAround, AlignVerticalSpaceAround, Bot, Camera, Focus, LayoutGrid, Mic, Music, StretchHorizontal, StretchVertical, Space } from 'lucide-react';
import { sequencedFileNames, type WorkflowAlignment, type WorkflowArrangeLayout, type WorkflowDistributeAxis } from './arrange';
import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { saveMediaUrl } from '../../services/desktopNetwork';
import { WorkflowToolbarActions, WorkflowToolbarMenu, WorkflowToolbarShell, type WorkflowToolbarAction } from './WorkflowToolbarPrimitives';
import { useWorkflowMediaUrl } from './media';
import { WORKFLOW_NODE_TOOL_LABELS } from './nodeToolCatalog';
import type { WorkflowNode } from './types';
import { DESIGN_BOOLEAN_LABELS, type DesignBooleanOperation } from '../../services/design/booleanOps';

const DESIGN_BOOLEAN_ORDER: readonly DesignBooleanOperation[] = ['union', 'subtract', 'intersect', 'exclude'];
const DESIGN_BOOLEAN_KINDS = new Set(['rect', 'ellipse', 'path']);

type Alignment = WorkflowAlignment;

export interface WorkflowImageToolHandlers {
  crop?: (id: string) => void;
  filter?: (id: string) => void;
  upscale?: (id: string) => void;
  removeBackground?: (id: string) => void;
  outpaint?: (id: string) => void;
  mask?: (id: string) => void;
  splitLayers?: (id: string) => void;
  rotate?: (id: string) => void;
  splitGrid?: (id: string) => void;
  annotate?: (id: string) => void;
  relight?: (id: string) => void;
  vectorize?: (id: string) => void;
  moveObject?: (id: string) => void;
  restyle?: (id: string) => void;
  layer?: (id: string) => void;
  storyboard?: (ids: string[]) => void;
}

export type WorkflowAvSplitAudio = 'full' | 'vocals' | 'background';

export interface WorkflowVideoToolHandlers {
  trim?: (id: string) => void;
  avSplit?: (id: string, audio?: WorkflowAvSplitAudio) => void;
  merge?: (ids: string[]) => void;
  extractFrame?: (id: string, position: 'first' | 'current' | 'last', currentTimeSec?: number) => void;
  extractFrameAt?: (id: string) => void;
}

export interface WorkflowAudioToolHandlers {
  trim?: (id: string) => void;
  speed?: (id: string) => void;
  stemSplit?: (id: string) => void;
}

// LibTV 式：常用媒体工具直接带文字露出，其余收进「更多」。
const PRIMARY_KEYS = new Set(['stop', 'run', 'copy', 'group', 'execute-group', 'ungroup', 'add-to-agent', 'export-selection', 'delete', 'upscale', 'remove-background', 'splitGrid', 'split', 'reverse-prompt', 'video-trim', 'video-merge']);
const ARRANGE_GAPS = [0, 16, 24, 48, 96] as const;
// LibTV 式：下载 / 放大预览放在工具条最右侧，只显示图标。
const ICON_KEYS = new Set(['download', 'preview']);

export function WorkflowNodeToolbar({ nodes, onCopy, onDelete, onExport, onRun, onStop, onPromptFocus, onSaveMedia, onReversePrompt, onReplaceMedia, onToggleFreeResize, onAlign, onDistribute, onLayer, onGroup, onUngroup, onExecuteGroup, onArrange, onSequencedExport, onAddToAgent, onPreviewMedia, onFrameSelection, onDesignBoolean, onApplyFrameLayout, imageTools, imageToolBusy = false, videoTools, videoToolBusy = false, audioTools, audioToolBusy = false }: {
  nodes: WorkflowNode[];
  onCopy: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onExport?: (nodes: WorkflowNode[]) => void;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  onPromptFocus?: (id: string) => void;
  onSaveMedia?: (id: string) => void;
  onReversePrompt?: (id: string, mediaUrl: string) => void;
  onReplaceMedia?: (id: string, file: File) => void;
  onToggleFreeResize?: (id: string) => void;
  onAlign?: (alignment: Alignment) => void;
  onDistribute?: (direction: WorkflowDistributeAxis) => void;
  onLayer?: (position: 'front' | 'back') => void;
  onGroup?: (ids: string[]) => void;
  onUngroup?: (ids: string[]) => void;
  onExecuteGroup?: (ids: string[]) => void;
  /** 打组排列：网格 / 一行 / 一列，按阅读顺序，锁定节点不动。 */
  onArrange?: (ids: string[], layout: WorkflowArrangeLayout, gap: number) => void;
  /** 按排列顺序批量下载，文件名 prefix_01、prefix_02… */
  onSequencedExport?: (ids: string[], prefix: string) => void;
  onAddToAgent?: (ids: string[]) => void;
  onPreviewMedia?: (id: string) => void;
  /** 聚焦选中节点（Frame Selection，快捷键 F）。 */
  onFrameSelection?: () => void;
  // 设计元素：多选形状做布尔运算；画板按自动布局排列内部节点。
  onDesignBoolean?: (operation: DesignBooleanOperation, ids: string[]) => void;
  onApplyFrameLayout?: (id: string) => void;
  imageTools?: WorkflowImageToolHandlers;
  imageToolBusy?: boolean;
  videoTools?: WorkflowVideoToolHandlers;
  videoToolBusy?: boolean;
  audioTools?: WorkflowAudioToolHandlers;
  audioToolBusy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrangeGap, setArrangeGap] = useState<number>(24);
  const [namingOpen, setNamingOpen] = useState(false);
  const [namePrefix, setNamePrefix] = useState('');
  // Hook 必须在任何提前 return 之前无条件调用；nodes 为空时入参为 undefined。
  const node = nodes.length === 1 ? nodes[0] : null;
  const media = node && (node.type === 'image' || node.type === 'video' || node.type === 'audio') ? node : null;
  const mediaUrl = useWorkflowMediaUrl(media?.metadata.storageKey, media?.metadata.href, media?.metadata.artifactRef).url;
  // 有媒体来源就显示媒体工具；mediaUrl 仍在解析（大文件/远端）时置灰，避免工具栏只剩「复制节点」。
  const hasMediaSource = Boolean(media && (media.metadata.storageKey || media.metadata.href || media.metadata.artifactRef?.taskId));
  const mediaPending = hasMediaSource && !mediaUrl;
  if (!nodes.length) return null;
  const ids = nodes.map(node => node.id);
  const selectedMedia = nodes.filter(item => item.type === 'image' || item.type === 'video' || item.type === 'audio');
  const advancedToolBusy = imageToolBusy || node?.metadata.status === 'loading';
  const actions: Array<WorkflowToolbarAction | null | false | undefined> = [
    onFrameSelection && { key: 'frame-selection', label: '聚焦选中 (F)', icon: <Focus size={18} />, onClick: () => onFrameSelection() },
    { key: 'copy', label: '复制节点', icon: <Copy size={18} />, onClick: () => onCopy(ids) },
    nodes.length > 1 && onGroup && { key: 'group', label: '打组 (Ctrl+G)', icon: <Group size={18} />, onClick: () => onGroup(ids) },
    nodes.length > 1 && onExecuteGroup && { key: 'execute-group', label: '整组执行', icon: <Play size={18} />, onClick: () => onExecuteGroup(ids) },
    nodes.length > 1 && onUngroup && nodes.some(n => n.batchId) && { key: 'ungroup', label: '取消打组', icon: <Ungroup size={18} />, onClick: () => onUngroup(ids) },
    nodes.length > 1 && selectedMedia.length > 0 && onExport && { key: 'export-selection', label: '批量导出所选媒体', icon: <Download size={18} />, onClick: () => onExport(nodes) },
    nodes.length > 1 && onAddToAgent && { key: 'add-to-agent', label: '添加到 Agent', icon: <Bot size={18} />, onClick: () => onAddToAgent(ids) },
    nodes.length > 1 && onArrange && { key: 'arrange-grid', label: '网格排列', icon: <LayoutGrid size={18} />, onClick: () => onArrange(ids, 'grid', arrangeGap) },
    nodes.length > 1 && onArrange && { key: 'arrange-row', label: '横向排成一行', icon: <StretchVertical size={18} />, onClick: () => onArrange(ids, 'row', arrangeGap) },
    nodes.length > 1 && onArrange && { key: 'arrange-column', label: '纵向排成一列', icon: <StretchHorizontal size={18} />, onClick: () => onArrange(ids, 'column', arrangeGap) },
    nodes.length > 1 && onArrange && { key: 'arrange-gap', label: `排列间距 ${arrangeGap}px`, icon: <Space size={18} />, onClick: () => setArrangeGap(gap => ARRANGE_GAPS[(ARRANGE_GAPS.indexOf(gap as typeof ARRANGE_GAPS[number]) + 1) % ARRANGE_GAPS.length]) },
    nodes.length > 1 && selectedMedia.length > 0 && onSequencedExport && { key: 'sequenced-export', label: '按顺序批量下载…', icon: <Download size={18} />, active: namingOpen, onClick: () => setNamingOpen(open => !open) },
    ...(nodes.length > 1 && onDesignBoolean && nodes.every(item => item.type === 'design' && DESIGN_BOOLEAN_KINDS.has(item.metadata.design?.kind ?? ''))
      ? DESIGN_BOOLEAN_ORDER.map(operation => ({ key: 'design-boolean-' + operation, label: DESIGN_BOOLEAN_LABELS[operation], icon: <Layers3 size={18} />, onClick: () => onDesignBoolean(operation, ids) }))
      : []),
    node?.type === 'design' && node.metadata.design?.frame?.autoLayout && onApplyFrameLayout && { key: 'apply-frame-layout', label: '应用自动布局', icon: <Grid2x2 size={18} />, onClick: () => onApplyFrameLayout(node.id) },
    onLayer && { key: 'front', label: '移到最前', icon: <ChevronsUp size={18} />, onClick: () => onLayer('front') },
    onLayer && { key: 'back', label: '移到最后', icon: <ChevronsDown size={18} />, onClick: () => onLayer('back') },
    node && onPromptFocus && node.type !== 'audio' && node.type !== 'script' && { key: 'prompt', label: '编辑提示词', icon: <MessageSquareText size={18} />, onClick: () => onPromptFocus(node.id) },
    media && hasMediaSource && { key: 'download', label: '下载媒体', icon: <Download size={18} />, disabled: !mediaUrl, onClick: () => { if (mediaUrl) void saveMediaUrl(mediaUrl, media.metadata.name || media.id).catch(error => console.warn('[Workflow] Media download failed.', error)); } },
    media?.type === 'image' && onSaveMedia && { key: 'save', label: '保存到素材库', icon: <Library size={18} />, onClick: () => onSaveMedia(media.id) },
    media && hasMediaSource && onPreviewMedia && { key: 'preview', label: '放大预览', icon: <Maximize2 size={18} />, disabled: !mediaUrl, onClick: () => onPreviewMedia(media.id) },
    media?.type === 'image' && mediaUrl && onReversePrompt && { key: 'reverse-prompt', label: '反推 Prompt', icon: <ScanText size={18} />, disabled: advancedToolBusy, onClick: () => onReversePrompt(media.id, mediaUrl) },
    media && onReplaceMedia && { key: 'replace', label: '替换媒体', icon: <FilePenLine size={18} />, onClick: () => inputRef.current?.click() },
    node?.type === 'image' && mediaUrl && imageTools?.crop && { key: 'crop', label: WORKFLOW_NODE_TOOL_LABELS.crop, icon: <Crop size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.crop?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.filter && { key: 'filter', label: '图片滤镜', icon: <SlidersHorizontal size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.filter?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.upscale && { key: 'upscale', label: WORKFLOW_NODE_TOOL_LABELS.upscale, icon: <ZoomIn size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.upscale?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.removeBackground && { key: 'remove-background', label: WORKFLOW_NODE_TOOL_LABELS['remove-background'], icon: <Eraser size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.removeBackground?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.outpaint && { key: 'outpaint', label: '扩展画面', icon: <Expand size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.outpaint?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.mask && { key: 'mask', label: '编辑蒙版', icon: <ScanLine size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.mask?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.splitLayers && { key: 'split', label: WORKFLOW_NODE_TOOL_LABELS['split-layers'], icon: <Layers3 size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.splitLayers?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.rotate && { key: 'rotate', label: WORKFLOW_NODE_TOOL_LABELS.rotate, icon: <RotateCw size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.rotate?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.vectorize && { key: 'vectorize', label: '矢量化', icon: <PenTool size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.vectorize?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.moveObject && { key: 'move-object', label: '移动物体', icon: <Move size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.moveObject?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.splitGrid && { key: 'splitGrid', label: WORKFLOW_NODE_TOOL_LABELS['split-grid'], icon: <Grid2x2 size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.splitGrid?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.annotate && { key: 'annotate', label: '标注涂鸦', icon: <ScanLine size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.annotate?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.relight && { key: 'relight', label: '打光面板', icon: <Lightbulb size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.relight?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.restyle && { key: 'restyle', label: '视角与风格', icon: <Palette size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.restyle?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.layer && { key: 'layer', label: '叠加层', icon: <Layers size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.layer?.(node.id) },
    selectedMedia.length > 1 && selectedMedia.every(n => n.type === 'image') && imageTools?.storyboard && { key: 'storyboard', label: '分镜组拼接', icon: <Frame size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.storyboard?.(ids) },
    node?.type === 'video' && videoTools?.trim && { key: 'video-trim', label: hasMediaSource ? WORKFLOW_NODE_TOOL_LABELS['video-trim'] : WORKFLOW_NODE_TOOL_LABELS['video-trim'] + '（请先上传视频）', icon: <Scissors size={18} />, disabled: videoToolBusy || mediaPending || !hasMediaSource, onClick: () => videoTools.trim?.(node.id) },
    selectedMedia.length > 1 && selectedMedia.every(n => n.type === 'video') && videoTools?.merge && { key: 'video-merge', label: WORKFLOW_NODE_TOOL_LABELS['video-merge'], icon: <Frame size={18} />, disabled: videoToolBusy, onClick: () => videoTools.merge?.(ids) },
    node?.type === 'audio' && mediaUrl && audioTools?.trim && { key: 'audio-trim', label: WORKFLOW_NODE_TOOL_LABELS['audio-trim'], icon: <Scissors size={18} />, disabled: audioToolBusy, onClick: () => audioTools.trim?.(node.id) },
    node?.type === 'audio' && mediaUrl && audioTools?.speed && { key: 'audio-speed', label: WORKFLOW_NODE_TOOL_LABELS['audio-speed'], icon: <Gauge size={18} />, disabled: audioToolBusy, onClick: () => audioTools.speed?.(node.id) },
    node?.type === 'audio' && mediaUrl && audioTools?.stemSplit && { key: 'audio-stem-split', label: WORKFLOW_NODE_TOOL_LABELS['audio-stem-split'], icon: <AudioLines size={18} />, disabled: audioToolBusy, onClick: () => audioTools.stemSplit?.(node.id) },
    node && (node.type === 'image' || node.type === 'video') && onToggleFreeResize && { key: 'resize', label: '切换自由缩放', icon: <Expand size={18} />, active: Boolean(node.freeResize), onClick: () => onToggleFreeResize(node.id) },
    // Generate lives in the prompt bar. The toolbar only carries the state
    // change you need right now: Stop while running, Retry after a failure.
    node && node.type !== 'audio' && node.type !== 'script' && node.metadata.status === 'loading' && onStop
      ? { key: 'stop', label: '停止节点', icon: <Square size={17} />, onClick: () => onStop(node.id) }
      : node && node.type !== 'audio' && node.type !== 'script' && node.metadata.status === 'error' && onRun && { key: 'run', label: '重试节点', icon: <RefreshCw size={18} />, onClick: () => onRun(node.id) },
    { key: 'delete', label: '删除节点', icon: <Trash2 size={18} />, danger: true, onClick: () => onDelete(ids) },
  ];
  // LibTV 式：分离音视频与截帧各自收成一个下拉。空视频节点或媒体还在加载时置灰，而不是整组消失。
  const videoNode = node?.type === 'video' ? node : null;
  const videoBusy = videoToolBusy || mediaPending || !hasMediaSource || videoNode?.metadata.status === 'loading';
  const avSplitActions: WorkflowToolbarAction[] = videoNode && videoTools?.avSplit ? [
    { key: 'video-av-split', label: '分离音视频', icon: <AudioLines size={16} />, disabled: videoBusy, onClick: () => videoTools.avSplit?.(videoNode.id, 'full') },
    { key: 'video-vocals', label: '人声提取', icon: <Mic size={16} />, disabled: videoBusy, onClick: () => videoTools.avSplit?.(videoNode.id, 'vocals') },
    { key: 'video-background', label: '背景音提取', icon: <Music size={16} />, disabled: videoBusy, onClick: () => videoTools.avSplit?.(videoNode.id, 'background') },
  ] : [];
  const frameActions: WorkflowToolbarAction[] = (videoNode ? [
    videoTools?.extractFrame && { key: 'video-frame-first', label: '截取首帧', icon: <ArrowUpToLine size={16} />, disabled: videoBusy, onClick: () => videoTools.extractFrame?.(videoNode.id, 'first') },
    videoTools?.extractFrame && { key: 'video-frame-last', label: '截取尾帧', icon: <ArrowDownToLine size={16} />, disabled: videoBusy, onClick: () => videoTools.extractFrame?.(videoNode.id, 'last') },
    videoTools?.extractFrameAt && { key: 'video-frame-at', label: '截取指定帧…', icon: <Frame size={16} />, disabled: videoBusy, onClick: () => videoTools.extractFrameAt?.(videoNode.id) },
  ] as Array<WorkflowToolbarAction | false | undefined> : []).filter((action): action is WorkflowToolbarAction => Boolean(action));
  const alignActions: WorkflowToolbarAction[] = nodes.length > 1 && onAlign ? [
    { key: 'left', label: '左对齐节点', icon: <AlignLeft size={16} />, onClick: () => onAlign('left') },
    { key: 'horizontal-center', label: '水平居中节点', icon: <AlignCenter size={16} />, onClick: () => onAlign('horizontal-center') },
    { key: 'right', label: '右对齐节点', icon: <AlignRight size={16} />, onClick: () => onAlign('right') },
    { key: 'top', label: '顶部对齐节点', icon: <ArrowUpToLine size={16} />, onClick: () => onAlign('top') },
    { key: 'vertical-center', label: '垂直居中节点', icon: <AlignCenter size={16} />, onClick: () => onAlign('vertical-center') },
    { key: 'bottom', label: '底部对齐节点', icon: <ArrowDownToLine size={16} />, onClick: () => onAlign('bottom') },
    ...(nodes.length > 2 && onDistribute ? [
      { key: 'distribute-horizontal', label: '水平等距分布', icon: <AlignHorizontalSpaceAround size={16} />, onClick: () => onDistribute('horizontal') },
      { key: 'distribute-vertical', label: '垂直等距分布', icon: <AlignVerticalSpaceAround size={16} />, onClick: () => onDistribute('vertical') },
    ] : []),
  ] : [];
  // A handful of always-visible actions; everything else sits, labelled, behind "更多".
  const present = actions.filter((action): action is WorkflowToolbarAction => Boolean(action));
  const primary = present.filter(action => PRIMARY_KEYS.has(action.key));
  const iconOnly = present.filter(action => ICON_KEYS.has(action.key));
  const overflow = [...present.filter(action => !PRIMARY_KEYS.has(action.key) && !ICON_KEYS.has(action.key)), ...alignActions];
  return (
    <WorkflowToolbarShell testId="workflow-node-toolbar">
      {media && onReplaceMedia && <>
        <input ref={inputRef} hidden type="file" accept={`${media.type}/*`} onChange={event => { const file = event.target.files?.[0]; if (file) onReplaceMedia(media.id, file); event.target.value = ''; }} />
      </>}
      <WorkflowToolbarActions showLabels actions={primary.filter(action => action.key !== 'delete')} />
      {avSplitActions.length > 0 && <WorkflowToolbarMenu variant="labelled" label="分离音视频" icon={<AudioLines size={16} />} actions={avSplitActions} disabled={videoBusy} />}
      {overflow.length > 0 && <WorkflowToolbarMenu label="更多" icon={<MoreHorizontal size={18} />} actions={overflow} />}
      {frameActions.length > 0 && <WorkflowToolbarMenu variant="icon-chevron" label="视频截帧" icon={<Camera size={16} />} actions={frameActions} />}
      <WorkflowToolbarActions actions={[...iconOnly, ...primary.filter(action => action.key === 'delete')]} />
      {namingOpen && onSequencedExport && selectedMedia.length > 0 && (
        <form
          className="workflow-group-naming"
          aria-label="批量下载命名"
          style={{ position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 12, background: 'var(--workflow-toolbar-bg, #1f1f23)', boxShadow: '0 8px 24px rgba(0,0,0,.35)', whiteSpace: 'nowrap', zIndex: 2 }}
          onSubmit={event => { event.preventDefault(); onSequencedExport(ids, namePrefix); setNamingOpen(false); }}
        >
          <input aria-label="文件名前缀" autoFocus value={namePrefix} placeholder="flovart" onChange={event => setNamePrefix(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setNamingOpen(false); event.stopPropagation(); }} style={{ width: 140 }} />
          <small>{sequencedFileNames(namePrefix, selectedMedia.length)[0]} … 共 {selectedMedia.length} 个</small>
          <button type="submit">下载</button>
        </form>
      )}
    </WorkflowToolbarShell>
  );
}
