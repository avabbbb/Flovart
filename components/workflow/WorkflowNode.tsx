import { ChevronsDown, Clapperboard, FileText, Image as ImageIcon, Music2, Upload, Video, X } from 'lucide-react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'motion/react';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import { buildCssFilter } from '../ImageFilterPanel';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode as WorkflowNodeData } from './types';

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
  onCollapseBatch,
  onDoubleClick,
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
  onCollapseBatch?: () => void;
  onDoubleClick?: () => void;
}) {
  const status = node.metadata.status || 'idle';
  const progress = Math.max(0, Math.min(100, Math.round(node.metadata.progress || 0)));
  const generationMode = node.metadata.config?.mode || node.type;
  const generationLabel = generationMode === 'video' ? '视频生成中' : generationMode === 'text' ? '文本生成中' : '图片生成中';
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
    <motion.div
      data-workflow-node-id={node.id}
      className={`workflow-node workflow-node--${node.type}${selected ? ' is-selected' : ''}`}
      style={{ x: node.position.x, y: node.position.y, width: node.width, height: node.height }}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: status === 'loading' ? [1, 1.015, 1] : 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0 }}
      whileHover={status === 'loading' ? undefined : { scale: 1.02 }}
      transition={{
        scale: status === 'loading'
          ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 420, damping: 20, mass: 0.7 },
        opacity: { duration: 0.2 },
        default: { type: 'spring', stiffness: 400, damping: 22 },
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={event => { if (node.type === 'script') { event.stopPropagation(); onDoubleClick?.(); } }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu(event); }}
    >
      <button className="workflow-handle workflow-handle--target" aria-label="连接到此节点" data-workflow-target={node.id} />
      <button className="workflow-handle workflow-handle--source" aria-label="从此节点连接" onPointerDown={onConnectStart} />
      {status === 'error' && <span className="workflow-node__error-badge" title={node.metadata.error}>!</span>}
      {onCollapseBatch && (
        <button
          type="button"
          className="workflow-node__batch-collapse"
          title="折叠批次"
          onPointerDown={event => { event.stopPropagation(); }}
          onClick={event => { event.stopPropagation(); onCollapseBatch(); }}
        ><ChevronsDown size={14} /></button>
      )}
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
        {node.type === 'script' && <ScriptNodeCard node={node} />}
        {mediaDetails && <span className="workflow-node__media-details">{mediaDetails}</span>}
        {status === 'loading' && (
          <motion.div
            className="flv-generation-glass workflow-node__generation-glass"
            data-testid="workflow-generation-glass"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0.82, 1, 0.82] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <motion.div
              className="workflow-node__shimmer"
              initial={{ x: '-120%' }}
              animate={{ x: '120%' }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.5 }}
            />
            <span className="flv-generation-glass__status">{generationLabel}<b>{progress}%</b></span>
          </motion.div>
        )}
        {status === 'error' && node.metadata.error && <div className="workflow-node__generation-error" title={node.metadata.error}>{node.metadata.error}</div>}
      </div>
      <button className="workflow-resize" aria-label="调整节点大小" onPointerDown={onResizeStart} />
    </motion.div>
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

function ScriptNodeCard({ node }: { node: WorkflowNodeData }) {
  const breakdown = node.metadata.scriptBreakdown;
  const shotCount = breakdown?.shots?.length || 0;
  const assetCount = breakdown?.assets?.length || 0;
  const completedShots = breakdown?.shots?.filter(shot => shot.status === 'success').length || 0;
  return (
    <div className="workflow-node__script-card">
      <div className="workflow-node__script-header">
        <Clapperboard size={20} />
        <span>{breakdown?.sourceText ? '剧本分镜' : '空脚本'}</span>
      </div>
      {shotCount > 0 ? (
        <div className="workflow-node__script-stats">
          <span>{assetCount} 资产</span>
          <span>{shotCount} 分镜</span>
          <span>{completedShots}/{shotCount} 完成</span>
        </div>
      ) : (
        <div className="workflow-node__script-empty">
          <FileText size={22} />
          <span>双击打开编辑器拆解剧本</span>
        </div>
      )}
      {breakdown?.shots?.slice(0, 4).map(shot => (
        <div key={shot.id} className="workflow-node__script-shot-row">
          <span className="workflow-node__script-shot-index">#{shot.index + 1}</span>
          <span className="workflow-node__script-shot-desc">{shot.dialogue || shot.action || shot.promptOverride || '未描述'}</span>
        </div>
      ))}
      {shotCount > 4 && <div className="workflow-node__script-more">+{shotCount - 4} 更多分镜</div>}
    </div>
  );
}
