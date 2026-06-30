import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, ChevronsDown, ChevronsUp, Copy, Crop, Download, Eraser, Expand, FilePenLine, Frame, Grid2x2, Group, Layers3, Library, Lightbulb, MessageSquareText, Play, RefreshCw, RotateCw, ScanLine, ScanText, Scissors, SlidersHorizontal, Square, Trash2, Ungroup, ZoomIn, Gauge } from 'lucide-react';
import { useRef } from 'react';
import { ElementToolbarActions, ElementToolbarShell, type ElementToolbarAction } from '../ElementToolbar';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode } from './types';

type Alignment = 'left' | 'horizontal-center' | 'right' | 'top' | 'vertical-center' | 'bottom';

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
  storyboard?: (ids: string[]) => void;
}

export interface WorkflowVideoToolHandlers {
  trim?: (id: string) => void;
  avSplit?: (id: string) => void;
  merge?: (ids: string[]) => void;
}

export interface WorkflowAudioToolHandlers {
  trim?: (id: string) => void;
  speed?: (id: string) => void;
}

export function WorkflowNodeToolbar({ nodes, onCopy, onDelete, onExport, onRun, onStop, onPromptFocus, onSaveMedia, onReversePrompt, onReplaceMedia, onToggleFreeResize, onAlign, onLayer, onGroup, onUngroup, onExecuteGroup, imageTools, imageToolBusy = false, videoTools, videoToolBusy = false, audioTools, audioToolBusy = false }: {
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
  onLayer?: (position: 'front' | 'back') => void;
  onGroup?: (ids: string[]) => void;
  onUngroup?: (ids: string[]) => void;
  onExecuteGroup?: (ids: string[]) => void;
  imageTools?: WorkflowImageToolHandlers;
  imageToolBusy?: boolean;
  videoTools?: WorkflowVideoToolHandlers;
  videoToolBusy?: boolean;
  audioTools?: WorkflowAudioToolHandlers;
  audioToolBusy?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!nodes.length) return null;
  const ids = nodes.map(node => node.id);
  const node = nodes.length === 1 ? nodes[0] : null;
  const media = node && (node.type === 'image' || node.type === 'video' || node.type === 'audio') ? node : null;
  const selectedMedia = nodes.filter(item => item.type === 'image' || item.type === 'video' || item.type === 'audio');
  const mediaUrl = useWorkflowMediaUrl(media?.metadata.storageKey, media?.metadata.href).url;
  const advancedToolBusy = imageToolBusy || node?.metadata.status === 'loading';
  const actions: Array<ElementToolbarAction | null | false | undefined> = [
    { key: 'copy', label: '复制节点', icon: <Copy size={18} />, onClick: () => onCopy(ids) },
    nodes.length > 1 && onGroup && { key: 'group', label: '打组 (Ctrl+G)', icon: <Group size={18} />, onClick: () => onGroup(ids) },
    nodes.length > 1 && onExecuteGroup && { key: 'execute-group', label: '整组执行', icon: <Play size={18} />, onClick: () => onExecuteGroup(ids) },
    nodes.length > 1 && onUngroup && nodes.some(n => n.batchId) && { key: 'ungroup', label: '取消打组', icon: <Ungroup size={18} />, onClick: () => onUngroup(ids) },
    nodes.length > 1 && selectedMedia.length > 0 && onExport && { key: 'export-selection', label: '批量导出所选媒体', icon: <Download size={18} />, onClick: () => onExport(nodes) },
    onLayer && { key: 'front', label: '移到最前', icon: <ChevronsUp size={18} />, onClick: () => onLayer('front') },
    onLayer && { key: 'back', label: '移到最后', icon: <ChevronsDown size={18} />, onClick: () => onLayer('back') },
    node && onPromptFocus && node.type !== 'audio' && node.type !== 'script' && { key: 'prompt', label: '编辑提示词', icon: <MessageSquareText size={18} />, onClick: () => onPromptFocus(node.id) },
    media && mediaUrl && { key: 'download', label: '下载媒体', icon: <Download size={18} />, href: mediaUrl, download: media.metadata.name || media.id },
    media?.type === 'image' && onSaveMedia && { key: 'save', label: '保存到素材库', icon: <Library size={18} />, onClick: () => onSaveMedia(media.id) },
    media?.type === 'image' && mediaUrl && onReversePrompt && { key: 'reverse-prompt', label: '反推 Prompt', icon: <ScanText size={18} />, disabled: advancedToolBusy, onClick: () => onReversePrompt(media.id, mediaUrl) },
    media && onReplaceMedia && { key: 'replace', label: '替换媒体', icon: <FilePenLine size={18} />, onClick: () => inputRef.current?.click() },
    node?.type === 'image' && mediaUrl && imageTools?.crop && { key: 'crop', label: '裁剪图片', icon: <Crop size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.crop?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.filter && { key: 'filter', label: '图片滤镜', icon: <SlidersHorizontal size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.filter?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.upscale && { key: 'upscale', label: '高清放大', icon: <ZoomIn size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.upscale?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.removeBackground && { key: 'remove-background', label: '移除背景', icon: <Eraser size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.removeBackground?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.outpaint && { key: 'outpaint', label: '扩展画面', icon: <Expand size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.outpaint?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.mask && { key: 'mask', label: '编辑蒙版', icon: <ScanLine size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.mask?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.splitLayers && { key: 'split', label: '拆分图层', icon: <Layers3 size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.splitLayers?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.rotate && { key: 'rotate', label: '旋转镜像', icon: <RotateCw size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.rotate?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.splitGrid && { key: 'splitGrid', label: '宫格切分', icon: <Grid2x2 size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.splitGrid?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.annotate && { key: 'annotate', label: '标注涂鸦', icon: <ScanLine size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.annotate?.(node.id) },
    node?.type === 'image' && mediaUrl && imageTools?.relight && { key: 'relight', label: '打光面板', icon: <Lightbulb size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.relight?.(node.id) },
    selectedMedia.length > 1 && selectedMedia.every(n => n.type === 'image') && imageTools?.storyboard && { key: 'storyboard', label: '分镜组拼接', icon: <Frame size={18} />, disabled: advancedToolBusy, onClick: () => imageTools.storyboard?.(ids) },
    node?.type === 'video' && mediaUrl && videoTools?.trim && { key: 'video-trim', label: '视频剪辑', icon: <Scissors size={18} />, disabled: videoToolBusy, onClick: () => videoTools.trim?.(node.id) },
    node?.type === 'video' && mediaUrl && videoTools?.avSplit && { key: 'video-av-split', label: '音视频分离', icon: <ScanLine size={18} />, disabled: videoToolBusy, onClick: () => videoTools.avSplit?.(node.id) },
    selectedMedia.length > 1 && selectedMedia.every(n => n.type === 'video') && videoTools?.merge && { key: 'video-merge', label: '视频拼接', icon: <Frame size={18} />, disabled: videoToolBusy, onClick: () => videoTools.merge?.(ids) },
    node?.type === 'audio' && mediaUrl && audioTools?.trim && { key: 'audio-trim', label: '音频截取', icon: <Scissors size={18} />, disabled: audioToolBusy, onClick: () => audioTools.trim?.(node.id) },
    node?.type === 'audio' && mediaUrl && audioTools?.speed && { key: 'audio-speed', label: '音频变速', icon: <Gauge size={18} />, disabled: audioToolBusy, onClick: () => audioTools.speed?.(node.id) },
    node && (node.type === 'image' || node.type === 'video') && onToggleFreeResize && { key: 'resize', label: '切换自由缩放', icon: <Expand size={18} />, active: Boolean(node.freeResize), onClick: () => onToggleFreeResize(node.id) },
    node && node.type !== 'audio' && node.type !== 'script' && node.metadata.status === 'loading' && onStop
      ? { key: 'stop', label: '停止节点', icon: <Square size={17} />, onClick: () => onStop(node.id) }
      : node && node.type !== 'audio' && node.type !== 'script' && onRun && { key: 'run', label: node.metadata.status === 'error' ? '重试节点' : '运行节点', icon: node.metadata.status === 'error' ? <RefreshCw size={18} /> : <Play size={18} />, onClick: () => onRun(node.id) },
    { key: 'delete', label: '删除节点', icon: <Trash2 size={18} />, danger: true, onClick: () => onDelete(ids) },
  ];
  return (
    <ElementToolbarShell testId="workflow-node-toolbar">
      {nodes.length > 1 && onAlign && <>
        <ElementToolbarActions actions={[
          { key: 'left', label: '左对齐节点', icon: <AlignLeft size={18} />, onClick: () => onAlign('left') },
          { key: 'horizontal-center', label: '水平居中节点', icon: <AlignCenter size={18} />, onClick: () => onAlign('horizontal-center') },
          { key: 'right', label: '右对齐节点', icon: <AlignRight size={18} />, onClick: () => onAlign('right') },
          { key: 'top', label: '顶部对齐节点', icon: <ArrowUpToLine size={18} />, onClick: () => onAlign('top') },
          { key: 'vertical-center', label: '垂直居中节点', icon: <AlignCenter size={18} />, onClick: () => onAlign('vertical-center') },
          { key: 'bottom', label: '底部对齐节点', icon: <ArrowDownToLine size={18} />, onClick: () => onAlign('bottom') },
        ]} />
      </>}
      {media && onReplaceMedia && <>
        <input ref={inputRef} hidden type="file" accept={`${media.type}/*`} onChange={event => { const file = event.target.files?.[0]; if (file) onReplaceMedia(media.id, file); event.target.value = ''; }} />
      </>}
      <ElementToolbarActions actions={actions} />
    </ElementToolbarShell>
  );
}
