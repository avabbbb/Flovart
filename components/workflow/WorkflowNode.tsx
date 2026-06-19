import { Image as ImageIcon, LoaderCircle, Music2, Settings2, Type, Upload, Video, X } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import { buildCssFilter } from '../ImageFilterPanel';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode as WorkflowNodeData } from './types';

const iconByType = {
  image: ImageIcon,
  text: Type,
  video: Video,
  audio: Music2,
  config: Settings2,
};

export function WorkflowNode({
  node,
  selected,
  onPointerDown,
  onConnectStart,
  onResizeStart,
  onChangeText,
  onChangeMetadata,
  onRun,
  onContextMenu,
  onReplaceMedia,
  onRemoveMedia,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onConnectStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onChangeText: (value: string) => void;
  onChangeMetadata: (metadata: WorkflowNodeData['metadata']) => void;
  onRun: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
  onReplaceMedia: (file: File) => void;
  onRemoveMedia: () => void;
}) {
  const Icon = iconByType[node.type];
  const status = node.metadata.status || 'idle';
  const mediaInput = useRef<HTMLInputElement>(null);
  const media = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio';
  const accept = isMedia ? `${node.type}/*` : undefined;
  const mediaError = isMedia ? (media.error || node.metadata.error) : null;
  const mediaDetails = isMedia ? [
    node.metadata.naturalWidth && node.metadata.naturalHeight ? `${node.metadata.naturalWidth}×${node.metadata.naturalHeight}` : '',
    node.metadata.durationMs ? formatDuration(node.metadata.durationMs) : '',
    node.metadata.bytes ? formatBytes(node.metadata.bytes) : '',
  ].filter(Boolean).join(' · ') : '';
  const mediaActions = isMedia && (
    <div className="workflow-node__media-actions" data-workflow-overlay>
      <button type="button" aria-label="重新选择媒体文件" onClick={() => mediaInput.current?.click()}><Upload size={14} />重新选择</button>
      {(node.metadata.storageKey || node.metadata.href) && <button type="button" aria-label="移除媒体文件" onClick={onRemoveMedia}><X size={14} />移除</button>}
      <input ref={mediaInput} hidden type="file" accept={accept} onChange={event => { const file = event.target.files?.[0]; if (file) onReplaceMedia(file); event.currentTarget.value = ''; }} />
    </div>
  );
  return (
    <div
      data-workflow-node-id={node.id}
      className={`workflow-node workflow-node--${node.type}${selected ? ' is-selected' : ''}`}
      style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: node.width, height: node.height }}
      onPointerDown={onPointerDown}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu(event); }}
    >
      <button className="workflow-handle workflow-handle--target" aria-label="连接到此节点" data-workflow-target={node.id} />
      <button className="workflow-handle workflow-handle--source" aria-label="从此节点连接" onPointerDown={onConnectStart} />
      <header className="workflow-node__header">
        <Icon size={14} />
        <span>{node.title}</span>
        {status === 'loading' && <LoaderCircle size={13} className="workflow-spin" />}
        {status === 'error' && <span className="workflow-node__error-dot" title={node.metadata.error}>!</span>}
      </header>
      <div className="workflow-node__body">
        {node.type === 'image' && (media.url
          ? <><img src={media.url} alt={node.title} draggable={false} style={{ filter: buildCssFilter(node.metadata.filters) }} />{mediaActions}</>
          : <div className="workflow-node__empty"><ImageIcon size={26} /><span>{mediaError || '图片节点'}</span>{mediaActions}</div>)}
        {node.type === 'video' && (media.url
          ? <><video src={media.url} poster={node.metadata.poster} controls preload="metadata" playsInline />{mediaActions}</>
          : <div className="workflow-node__empty"><Video size={26} /><span>{mediaError || '视频节点'}</span>{mediaActions}</div>)}
        {node.type === 'audio' && (media.url
          ? <><audio src={media.url} controls preload="metadata" style={{ width: '100%' }} />{mediaActions}</>
          : <div className="workflow-node__empty"><Music2 size={26} /><span>{mediaError || '音频节点'}</span>{mediaActions}</div>)}
        {node.type === 'text' && (
          <textarea
            value={node.metadata.content || ''}
            placeholder="输入文本或提示词"
            onPointerDown={event => event.stopPropagation()}
            onChange={event => onChangeText(event.target.value)}
          />
        )}
        {node.type === 'config' && (
          <WorkflowConfigPanel node={node} onChange={onChangeMetadata} onRun={onRun} />
        )}
        {mediaDetails && <span className="workflow-node__media-details">{mediaDetails}</span>}
      </div>
      <button className="workflow-resize" aria-label="调整节点大小" onPointerDown={onResizeStart} />
    </div>
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
