import { Check, ChevronsDown, Clapperboard, FileText, Image as ImageIcon, Music2, Pencil, Plus, Star, Upload, Video, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
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
  onConnectStartTarget,
  onResizeStart,
  onChangeText,
  onChangeMetadata,
  onRun,
  onContextMenu,
  onReplaceMedia,
  onRemoveMedia,
  onCollapseBatch,
  batchCount,
  isBatchPrimary,
  onSetBatchPrimary,
  onDoubleClick,
  onPreviewMedia,
  onChangeTitle,
  onFocusNode,
  renameSignal,
}: {
  node: WorkflowNodeData;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onConnectStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onConnectStartTarget?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onChangeText: (value: string) => void;
  onChangeMetadata: (metadata: WorkflowNodeData['metadata']) => void;
  onRun: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onReplaceMedia: (file: File) => void;
  onRemoveMedia: () => void;
  onCollapseBatch?: () => void;
  batchCount?: number;
  isBatchPrimary?: boolean;
  onSetBatchPrimary?: () => void;
  onDoubleClick?: () => void;
  onPreviewMedia?: (node: WorkflowNodeData) => void;
  onChangeTitle?: (title: string) => void;
  onFocusNode?: () => void;
  renameSignal?: number;
}) {
  const status = node.metadata.status || 'idle';
  const progress = Math.max(0, Math.min(100, Math.round(node.metadata.progress || 0)));
  const generationMode = node.metadata.config?.mode || node.type;
  const generationLabel = generationMode === 'video' ? '视频生成中' : generationMode === 'text' ? '文本生成中' : '图片生成中';
  const generationMessage = node.metadata.generationMessage;
  const generationStartedAt = node.metadata.generationStartedAt;
  const [elapsedSec, setElapsedSec] = useState(0);
  useEffect(() => {
    if (status !== 'loading' || !generationStartedAt) { setElapsedSec(0); return; }
    const tick = () => setElapsedSec(Math.floor((Date.now() - generationStartedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [status, generationStartedAt]);
  const elapsedLabel = elapsedSec > 0 ? `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}` : '';
  const staleHint = status === 'loading' && elapsedSec >= 180 ? '已等待较久，如长时间无响应可点击停止' : '';
  const mediaInput = useRef<HTMLInputElement>(null);
  const media = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio';
  const uploading = Boolean(node.metadata.uploading);
  const uploadBytes = node.metadata.uploadBytes || 0;
  const isLoading = status === 'loading' || uploading;
  const [isDropTarget, setDropTarget] = useState(false);
  const [isEditingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(node.title);
  useEffect(() => {
    if (isEditingTitle) setTitleDraft(node.title);
  }, [isEditingTitle, node.title]);
  const lastRenameSignalRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (renameSignal === undefined || renameSignal === lastRenameSignalRef.current) return;
    lastRenameSignalRef.current = renameSignal;
    if (!isEditingTitle) setEditingTitle(true);
  }, [renameSignal, isEditingTitle]);
  const titleIcon = node.type === 'image' ? ImageIcon : node.type === 'video' ? Video : node.type === 'audio' ? Music2 : node.type === 'script' ? Clapperboard : FileText;
  const TitleIcon = titleIcon;
  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== node.title && onChangeTitle) onChangeTitle(next);
    setEditingTitle(false);
  };
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
      className={`workflow-node workflow-node--${node.type}${selected ? ' is-selected' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
      style={{ x: node.position.x, y: node.position.y, width: node.width, height: node.height }}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: isLoading ? [1, 1.015, 1] : 1, opacity: 1 }}
      exit={{ scale: 0.85, opacity: 0 }}
      whileHover={isLoading ? undefined : { scale: 1.02 }}
      transition={{
        scale: isLoading
          ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 420, damping: 20, mass: 0.7 },
        opacity: { duration: 0.2 },
        default: { type: 'spring', stiffness: 400, damping: 22 },
      }}
      onPointerDown={onPointerDown}
      onDoubleClick={event => {
        if (node.type === 'script') { event.stopPropagation(); onDoubleClick?.(); return; }
        event.stopPropagation();
        if (isMedia && !media.url) { mediaInput.current?.click(); return; }
        onFocusNode?.();
      }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu(event); }}
      onDragOver={event => { if (isMedia && event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget(true); } }}
      onDragLeave={event => { if (!isMedia) return; const related = event.relatedTarget as Node | null; if (related && (event.currentTarget as HTMLElement).contains(related)) return; setDropTarget(false); }}
      onDrop={event => { if (!isMedia) return; event.preventDefault(); event.stopPropagation(); setDropTarget(false); const file = event.dataTransfer.files?.[0]; if (file) onReplaceMedia(file); }}
    >
      <button className="workflow-handle workflow-handle--target" aria-label="连接到此节点" data-workflow-target={node.id} onPointerDown={onConnectStartTarget}>
        <span className="workflow-handle__plus" aria-hidden="true"><Plus size={12} strokeWidth={2.5} /></span>
      </button>
      <button className="workflow-handle workflow-handle--source" aria-label="从此节点连接" onPointerDown={onConnectStart}>
        <span className="workflow-handle__plus" aria-hidden="true"><Plus size={12} strokeWidth={2.5} /></span>
      </button>
      {status === 'error' && <span className="workflow-node__error-badge" title={node.metadata.error}>!</span>}
      {batchCount && batchCount > 1 && (
        <div className="workflow-node__batch-actions" data-workflow-overlay>
          {onCollapseBatch && <button type="button" title="收起结果" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onCollapseBatch(); }}><ChevronsDown size={13} />{batchCount}张</button>}
          {isBatchPrimary ? <span><Check size={12} />主图</span> : onSetBatchPrimary && <button type="button" title="设为主图" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSetBatchPrimary(); }}><Star size={12} />设为主图</button>}
        </div>
      )}
      {onChangeTitle && (isEditingTitle ? (
        <div className="workflow-node__title is-editing" data-workflow-overlay>
          <TitleIcon size={12} />
          <input
            value={titleDraft}
            autoFocus
            data-workflow-overlay
            onChange={event => setTitleDraft(event.target.value)}
            onPointerDown={event => event.stopPropagation()}
            onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') { event.preventDefault(); commitTitle(); }
              else if (event.key === 'Escape') { event.preventDefault(); setEditingTitle(false); }
            }}
            onBlur={commitTitle}
            onClick={event => event.stopPropagation()}
          />
        </div>
      ) : (
        <div
          className="workflow-node__title"
          onPointerDown={event => event.stopPropagation()}
          onDoubleClick={event => {
            event.stopPropagation();
            setEditingTitle(true);
          }}
          title="双击重命名"
        >
          <TitleIcon size={12} />
          <span className="workflow-node__title-text">{node.title}</span>
          <Pencil className="workflow-node__title-edit-icon" size={11} />
        </div>
      ))}
      <div className="workflow-node__body">
        {isMedia && media.url && <div className="workflow-node__drag-handle" data-workflow-drag-handle />}
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
            {(generationMessage || elapsedLabel) && (
              <div className="workflow-node__generation-meta" data-workflow-overlay>
                {generationMessage && <span className="workflow-node__generation-message">{generationMessage}</span>}
                {elapsedLabel && <span className="workflow-node__generation-elapsed">{elapsedLabel}</span>}
              </div>
            )}
            {staleHint && <div className="workflow-node__generation-stale" data-workflow-overlay>{staleHint}</div>}
          </motion.div>
        )}
        {uploading && (
          <motion.div
            className="flv-generation-glass workflow-node__generation-glass"
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
            <span className="flv-generation-glass__status">上传中<b>{formatBytes(uploadBytes)}</b></span>
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
          <span className="workflow-node__script-shot-desc">{shot.dialogue || shot.action || shot.imagePromptOverride || shot.videoPromptOverride || '未描述'}</span>
        </div>
      ))}
      {shotCount > 4 && <div className="workflow-node__script-more">+{shotCount - 4} 更多分镜</div>}
    </div>
  );
}
