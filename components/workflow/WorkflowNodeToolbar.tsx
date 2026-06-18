import { AlignCenter, AlignLeft, AlignRight, Copy, Download, Expand, FilePenLine, Play, RefreshCw, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { ElementToolbarShell } from '../ElementToolbar';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode } from './types';

type Alignment = 'left' | 'center' | 'right';

export function WorkflowNodeToolbar({ nodes, onCopy, onDelete, onRun, onReplaceMedia, onToggleFreeResize, onAlign }: {
  nodes: WorkflowNode[];
  onCopy: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onRun?: (id: string) => void;
  onReplaceMedia?: (id: string, file: File) => void;
  onToggleFreeResize?: (id: string) => void;
  onAlign?: (alignment: Alignment) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  if (!nodes.length) return null;
  const ids = nodes.map(node => node.id);
  const node = nodes.length === 1 ? nodes[0] : null;
  const media = node && (node.type === 'image' || node.type === 'video' || node.type === 'audio') ? node : null;
  const mediaUrl = useWorkflowMediaUrl(media?.metadata.storageKey, media?.metadata.href).url;
  const icon = 'isl-icon-btn h-9 w-9';
  return (
    <ElementToolbarShell testId="workflow-node-toolbar">
      <button type="button" className={icon} aria-label="复制节点" title="复制" onClick={() => onCopy(ids)}><Copy size={18} /></button>
      {nodes.length > 1 && onAlign && <>
        <button type="button" className={icon} aria-label="左对齐节点" onClick={() => onAlign('left')}><AlignLeft size={18} /></button>
        <button type="button" className={icon} aria-label="居中对齐节点" onClick={() => onAlign('center')}><AlignCenter size={18} /></button>
        <button type="button" className={icon} aria-label="右对齐节点" onClick={() => onAlign('right')}><AlignRight size={18} /></button>
      </>}
      {media && mediaUrl && <a className={icon} aria-label="下载媒体" title="下载" href={mediaUrl} download={media.metadata.name || media.id}><Download size={18} /></a>}
      {media && onReplaceMedia && <>
        <button type="button" className={icon} aria-label="替换媒体" title="替换媒体" onClick={() => inputRef.current?.click()}><FilePenLine size={18} /></button>
        <input ref={inputRef} hidden type="file" accept={`${media.type}/*`} onChange={event => { const file = event.target.files?.[0]; if (file) onReplaceMedia(media.id, file); event.target.value = ''; }} />
      </>}
      {node && (node.type === 'image' || node.type === 'video') && onToggleFreeResize && (
        <button type="button" className={`${icon} ${node.freeResize ? 'isl-icon-btn--active' : ''}`} aria-label="切换自由缩放" title="自由缩放" onClick={() => onToggleFreeResize(node.id)}><Expand size={18} /></button>
      )}
      {node && node.type !== 'audio' && onRun && (
        <button type="button" className={icon} aria-label={node.metadata.status === 'error' ? '重试节点' : '运行节点'} title={node.metadata.status === 'error' ? '重试' : '运行'} onClick={() => onRun(node.id)}>{node.metadata.status === 'error' ? <RefreshCw size={18} /> : <Play size={18} />}</button>
      )}
      <button type="button" className={icon} style={{ color: 'var(--isl-coral-deep)' }} aria-label="删除节点" title="删除" onClick={() => onDelete(ids)}><Trash2 size={18} /></button>
    </ElementToolbarShell>
  );
}
