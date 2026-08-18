import { Camera, Check, ChevronsDown, Clapperboard, FileText, Image as ImageIcon, Music2, Pause, Pencil, Play, Plus, Sparkles, Star, Upload, Video, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { motion } from 'motion/react';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import { getWorkflowOperationCapability } from './operationRegistry';
import { buildCssFilter } from '../ImageFilterPanel';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowNode as WorkflowNodeData } from './types';

export function WorkflowNode({
  node,
  selected,
  mediaActive,
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
  onActivateMedia,
  onDeactivateMedia,
  onExtractFrame,
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
  mediaActive?: boolean;
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
  onActivateMedia?: () => void;
  onDeactivateMedia?: () => void;
  onExtractFrame?: (position: 'first' | 'current' | 'last', currentTimeSec?: number) => void;
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
  const generationLabel = node.type === 'operation' ? `${node.title}中` : generationMode === 'video' ? '视频生成中' : generationMode === 'text' ? '文本生成中' : '图片生成中';
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
  const videoActive = node.type === 'video' && Boolean(mediaActive);
  const resolveSourceMedia = node.type !== 'video' || videoActive;
  const media = useWorkflowMediaUrl(
    resolveSourceMedia ? node.metadata.storageKey : undefined,
    resolveSourceMedia ? node.metadata.href : undefined,
    resolveSourceMedia ? node.metadata.artifactRef : undefined,
  );
  const posterMedia = useWorkflowMediaUrl(
    node.type === 'video' ? node.metadata.posterStorageKey : undefined,
    node.type === 'video' ? node.metadata.poster : undefined,
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoLeaveTimer = useRef<number | undefined>(undefined);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(() => (node.metadata.durationMs || 0) / 1000);
  const [videoVolume, setVideoVolume] = useState(.5);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [frameMenuOpen, setFrameMenuOpen] = useState(false);
  useEffect(() => () => window.clearTimeout(videoLeaveTimer.current), []);
  useEffect(() => {
    if (!videoActive) {
      setVideoPlaying(false);
      setVideoCurrentTime(0);
      setVolumeOpen(false);
      setFrameMenuOpen(false);
    }
  }, [videoActive]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = videoVolume;
  }, [videoActive, videoVolume]);
  const isMedia = node.type === 'image' || node.type === 'video' || node.type === 'audio';
  const hasMediaReference = Boolean(node.metadata.storageKey || node.metadata.href || node.metadata.artifactRef?.taskId);
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
  const titleIcon = node.type === 'image' ? ImageIcon : node.type === 'video' ? Video : node.type === 'audio' ? Music2 : node.type === 'script' ? Clapperboard : node.type === 'operation' ? Sparkles : FileText;
  const TitleIcon = titleIcon;
  const commitTitle = () => {
    const next = titleDraft.trim();
    if (next && next !== node.title && onChangeTitle) onChangeTitle(next);
    setEditingTitle(false);
  };
  const accept = isMedia ? `${node.type}/*` : undefined;
  const mediaError = isMedia ? (media.error || node.metadata.error) : null;
  const mediaDimensions = isMedia && node.metadata.naturalWidth && node.metadata.naturalHeight
    ? `${node.metadata.naturalWidth} × ${node.metadata.naturalHeight}`
    : '';
  const mediaDetails = isMedia ? [
    node.metadata.durationMs && !(node.type === 'video' && videoActive) ? formatDuration(node.metadata.durationMs) : '',
    node.metadata.bytes ? formatBytes(node.metadata.bytes) : '',
  ].filter(Boolean).join(' · ') : '';
  const toggleVideo = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) await video.play().catch(() => undefined);
    else video.pause();
  };
  const updateVolume = (value: number) => {
    const next = Math.max(0, Math.min(1, value));
    setVideoVolume(next);
    if (videoRef.current) videoRef.current.volume = next;
  };
  const keepVideoLoaded = () => {
    window.clearTimeout(videoLeaveTimer.current);
    onActivateMedia?.();
  };
  const releaseVideo = () => {
    window.clearTimeout(videoLeaveTimer.current);
    videoLeaveTimer.current = window.setTimeout(() => onDeactivateMedia?.(), 520);
  };
  const mediaActions = isMedia && (
    <div className="workflow-node__media-actions" data-workflow-overlay>
      <button type="button" aria-label="重新选择媒体文件" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); mediaInput.current?.click(); }}><Upload size={14} />重新选择</button>
      {(node.metadata.storageKey || node.metadata.href || node.metadata.artifactRef?.taskId) && <button type="button" aria-label="移除媒体文件" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onRemoveMedia(); }}><X size={14} />移除</button>}
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
        if (isMedia && !hasMediaReference) { mediaInput.current?.click(); return; }
        onFocusNode?.();
      }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onContextMenu(event); }}
      onMouseOver={node.type === 'video' && hasMediaReference ? keepVideoLoaded : undefined}
      onMouseOut={node.type === 'video' && hasMediaReference ? event => {
        const related = event.relatedTarget as Node | null;
        if (related && event.currentTarget.contains(related)) return;
        releaseVideo();
      } : undefined}
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
      {isEditingTitle && onChangeTitle ? (
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
            if (onChangeTitle) setEditingTitle(true);
          }}
          title={onChangeTitle ? '双击重命名' : undefined}
        >
          <TitleIcon size={12} />
          <span className="workflow-node__title-text">{node.title}</span>
          <Pencil className="workflow-node__title-edit-icon" size={11} />
          {mediaDimensions && <span className="workflow-node__title-meta">{mediaDimensions}</span>}
        </div>
      )}
      <div className="workflow-node__body">
        {isMedia && (media.url || hasMediaReference) && <div className="workflow-node__drag-handle" data-workflow-drag-handle />}
        {node.type === 'image' && (media.url
          ? <><img src={media.url} alt={node.title} draggable={false} style={{ filter: buildCssFilter(node.metadata.filters) }} />{mediaActions}</>
          : <div className="workflow-node__empty"><ImageIcon size={26} /><span>{mediaError || '图片节点'}</span>{mediaActions}</div>)}
        {node.type === 'video' && (hasMediaReference
          ? videoActive
            ? media.url
              ? <>
                <video
                  ref={videoRef}
                  className="workflow-node__video"
                  src={media.url}
                  poster={posterMedia.url || undefined}
                  preload="metadata"
                  playsInline
                  crossOrigin="anonymous"
                  onLoadedMetadata={event => {
                    event.currentTarget.volume = videoVolume;
                    setVideoDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
                  }}
                  onDurationChange={event => setVideoDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
                  onTimeUpdate={event => setVideoCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setVideoPlaying(true)}
                  onPause={() => setVideoPlaying(false)}
                  onEnded={() => setVideoPlaying(false)}
                  onClick={event => { event.stopPropagation(); void toggleVideo(); }}
                />
                <div className="workflow-node__video-controls" data-workflow-overlay onPointerDown={event => event.stopPropagation()}>
                  <button type="button" aria-label={videoPlaying ? '暂停视频' : '播放视频'} onClick={() => void toggleVideo()}>
                    {videoPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                  </button>
                  <time>{formatVideoTime(videoCurrentTime)}</time>
                  <input
                    type="range"
                    aria-label="视频进度"
                    min={0}
                    max={Math.max(videoDuration, 0.01)}
                    step="0.01"
                    value={Math.min(videoCurrentTime, Math.max(videoDuration, 0.01))}
                    style={{ '--workflow-video-progress': `${videoDuration > 0 ? (videoCurrentTime / videoDuration) * 100 : 0}%` } as CSSProperties}
                    onChange={event => {
                      const next = Number(event.target.value);
                      if (videoRef.current) videoRef.current.currentTime = next;
                      setVideoCurrentTime(next);
                    }}
                  />
                  <time>{formatVideoTime(videoDuration)}</time>
                  <div className="workflow-node__video-volume">
                    <button type="button" aria-label={videoVolume > 0 ? '静音视频' : '取消静音'} aria-expanded={volumeOpen} onClick={() => setVolumeOpen(open => !open)}>
                      {videoVolume > 0 ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                    {volumeOpen && <div className="workflow-node__video-volume-popover">
                      <input type="range" className="workflow-node__video-volume-slider" aria-label="视频音量" min={0} max={1} step={.01} value={videoVolume} onChange={event => updateVolume(Number(event.target.value))} />
                      <span>{Math.round(videoVolume * 100)}</span>
                    </div>}
                  </div>
                  {onExtractFrame && <div className="workflow-node__video-frame">
                    <button type="button" aria-label="视频截帧" aria-expanded={frameMenuOpen} onClick={() => setFrameMenuOpen(open => !open)}><Camera size={14} /></button>
                    {frameMenuOpen && <div className="workflow-node__video-frame-menu" role="menu" aria-label="视频截帧">
                      {([['first', '截取首帧'], ['last', '截取尾帧'], ['current', '截取当前帧']] as const).map(([position, label]) => <button key={position} type="button" role="menuitem" onClick={() => { onExtractFrame(position, position === 'current' ? videoCurrentTime : undefined); setFrameMenuOpen(false); }}>{label}</button>)}
                    </div>}
                  </div>}
                </div>
                {mediaActions}
              </>
              : <div className="workflow-node__empty"><Video size={26} /><span>{mediaError || '正在加载视频'}</span>{mediaActions}</div>
            : <>{posterMedia.url
              ? <img src={posterMedia.url} alt={`${node.title} 视频封面`} draggable={false} loading="lazy" data-workflow-media-preview />
              : <div className="workflow-node__empty workflow-video-placeholder" role="img" aria-label={`${node.title} 视频预览`} data-testid="workflow-video-placeholder" data-workflow-media-preview><Video size={26} /><span>视频预览</span></div>}
              {onActivateMedia && <button type="button" className="workflow-node__video-activate" aria-label="加载视频播放器" title="加载视频播放器" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onClick={onActivateMedia}><Play size={18} fill="currentColor" /></button>}
              {mediaActions}</>
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
        {node.type === 'operation' && <OperationNodeCard node={node} onRun={onRun} />}
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

function OperationNodeCard({ node, onRun }: { node: WorkflowNodeData; onRun: () => void }) {
  const operation = node.metadata.operation;
  if (!operation) return <div className="workflow-operation-card"><span>Operation 配方缺失</span></div>;
  const latestTake = operation.takes.at(-1);
  const parameterLabel = getWorkflowOperationCapability(operation.capabilityId).summarizeParameters(operation.recipe.parameters);
  const statusLabel = latestTake?.status === 'outdated_recipe' ? '旧配方结果'
    : latestTake?.status === 'canceled' ? '已停止'
    : latestTake?.status === 'error' ? '执行失败'
      : latestTake?.status === 'success' ? '已完成'
        : latestTake?.status === 'running' ? '执行中' : '待执行';
  // 单张生成：结果媒体原位写在 operation 节点 metadata 上（storageKey/href），显示结果图
  const resultMedia = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  if (resultMedia.url) {
    return (
      <div className="workflow-operation-card workflow-operation-card--result" data-testid="workflow-operation-card">
        {node.metadata.mimeType?.startsWith('video/')
          ? <video src={resultMedia.url} muted playsInline loop style={{ width: '100%', maxHeight: 260, objectFit: 'contain' }} data-workflow-media-preview />
          : <img src={resultMedia.url} alt={`${node.title} 生成结果`} draggable={false} loading="lazy" data-workflow-media-preview style={{ width: '100%', maxHeight: 260, objectFit: 'contain' }} />}
        <div className="workflow-operation-card__row"><strong>{parameterLabel}</strong><span>{statusLabel}</span></div>
        <div className="workflow-operation-card__footer">
          <span>{operation.recipe.inputBindings.length} 输入 · {operation.takes.length} Take</span>
          <button type="button" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onRun(); }} disabled={node.metadata.status === 'loading'}>
            <Play size={11} fill="currentColor" />{latestTake?.status === 'error' ? '重试' : '运行'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="workflow-operation-card" data-testid="workflow-operation-card">
      <div className="workflow-operation-card__row"><strong>{parameterLabel}</strong><span>{statusLabel}</span></div>
      <p title={operation.recipe.promptDocument.text}>{operation.recipe.promptDocument.text || '无文本 Prompt · 参数型操作'}</p>
      <div className="workflow-operation-card__footer">
        <span>{operation.recipe.inputBindings.length} 输入 · {operation.takes.length} Take</span>
        <button type="button" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onRun(); }} disabled={node.metadata.status === 'loading'}>
          <Play size={11} fill="currentColor" />{latestTake?.status === 'error' ? '重试' : '运行'}
        </button>
      </div>
    </div>
  );
}

function formatDuration(durationMs: number) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function formatVideoTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
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
