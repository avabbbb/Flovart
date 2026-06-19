import { AlignCenter, AlignLeft, AlignRight, ArrowDownToLine, ArrowUpToLine, Copy, Crop, Download, Eraser, Expand, FilePenLine, Layers3, Library, MessageSquareText, Play, RefreshCw, ScanLine, SlidersHorizontal, Square, Trash2, ZoomIn } from 'lucide-react';
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
}

export function WorkflowNodeToolbar({ nodes, onCopy, onDelete, onRun, onStop, onPromptFocus, onSaveMedia, onReplaceMedia, onToggleFreeResize, onAlign, imageTools }: {
  nodes: WorkflowNode[];
  onCopy: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onRun?: (id: string) => void;
  onStop?: (id: string) => void;
  onPromptFocus?: (id: string) => void;
  onSaveMedia?: (id: string) => void;
  onReplaceMedia?: (id: string, file: File) => void;
  onToggleFreeResize?: (id: string) => void;
  onAlign?: (alignment: Alignment) => void;
  imageTools?: WorkflowImageToolHandlers;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!nodes.length) return null;
  const ids = nodes.map(node => node.id);
  const node = nodes.length === 1 ? nodes[0] : null;
  const media = node && (node.type === 'image' || node.type === 'video' || node.type === 'audio') ? node : null;
  const mediaUrl = useWorkflowMediaUrl(media?.metadata.storageKey, media?.metadata.href).url;
  const actions: Array<ElementToolbarAction | null | false | undefined> = [
    { key: 'copy', label: '复制节点', icon: <Copy size={18} />, onClick: () => onCopy(ids) },
    node && onPromptFocus && node.type !== 'audio' && { key: 'prompt', label: '编辑提示词', icon: <MessageSquareText size={18} />, onClick: () => onPromptFocus(node.id) },
    media && mediaUrl && { key: 'download', label: '下载媒体', icon: <Download size={18} />, href: mediaUrl, download: media.metadata.name || media.id },
    media?.type === 'image' && onSaveMedia && { key: 'save', label: '保存到素材库', icon: <Library size={18} />, onClick: () => onSaveMedia(media.id) },
    media && onReplaceMedia && { key: 'replace', label: '替换媒体', icon: <FilePenLine size={18} />, onClick: () => inputRef.current?.click() },
    node?.type === 'image' && imageTools?.crop && { key: 'crop', label: '裁剪图片', icon: <Crop size={18} />, onClick: () => imageTools.crop?.(node.id) },
    node?.type === 'image' && imageTools?.filter && { key: 'filter', label: '图片滤镜', icon: <SlidersHorizontal size={18} />, onClick: () => imageTools.filter?.(node.id) },
    node?.type === 'image' && imageTools?.upscale && { key: 'upscale', label: '高清放大', icon: <ZoomIn size={18} />, onClick: () => imageTools.upscale?.(node.id) },
    node?.type === 'image' && imageTools?.removeBackground && { key: 'remove-background', label: '移除背景', icon: <Eraser size={18} />, onClick: () => imageTools.removeBackground?.(node.id) },
    node?.type === 'image' && imageTools?.outpaint && { key: 'outpaint', label: '扩展画面', icon: <Expand size={18} />, onClick: () => imageTools.outpaint?.(node.id) },
    node?.type === 'image' && imageTools?.mask && { key: 'mask', label: '编辑蒙版', icon: <ScanLine size={18} />, onClick: () => imageTools.mask?.(node.id) },
    node?.type === 'image' && imageTools?.splitLayers && { key: 'split', label: '拆分图层', icon: <Layers3 size={18} />, onClick: () => imageTools.splitLayers?.(node.id) },
    node && (node.type === 'image' || node.type === 'video') && onToggleFreeResize && { key: 'resize', label: '切换自由缩放', icon: <Expand size={18} />, active: Boolean(node.freeResize), onClick: () => onToggleFreeResize(node.id) },
    node && node.type !== 'audio' && node.metadata.status === 'loading' && onStop
      ? { key: 'stop', label: '停止节点', icon: <Square size={17} />, onClick: () => onStop(node.id) }
      : node && node.type !== 'audio' && onRun && { key: 'run', label: node.metadata.status === 'error' ? '重试节点' : '运行节点', icon: node.metadata.status === 'error' ? <RefreshCw size={18} /> : <Play size={18} />, onClick: () => onRun(node.id) },
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
