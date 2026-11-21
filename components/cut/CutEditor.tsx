// Cut 视频编辑器（懒加载 chunk）。剪映 / CapCut 式布局，面板拆分参照 OpenCut classic 的编辑器
// （素材 / 文字 / 字幕面板 · 预览 · 属性 · 多轨时间线）；状态全部在 cutStore（Agent 工具共用）。
// 卸载时释放：播放器、解码流、AudioContext；引擎按引用计数在最后一个持有者释放时 dispose。
import { Captions, Download, Film, FolderOpen, Image as ImageIcon, Keyboard, Magnet, Music, Pause, Play, Plus, Redo2, Scissors, SendToBack, Trash2, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowProject } from '../workflow/types';
import type { CutMediaEngine } from '../../services/cut/mediaEngine';
import { CutPlayer } from '../../services/cut/player';
import { CutExportCancelled, textBox, type CutExportProgress } from '../../services/cut/render';
import { cutStore, getCutProject } from '../../services/cut/cutStore';
import { runCutAction } from '../../services/cut/actions';
import { actionForEvent } from '../../services/cut/shortcuts';
import { acquireCutEngine, ensureSourceLoaded, exportCutMp4, importCanvasNode, importCutMedia, releaseCutEngine, updateCanvasClip } from '../../services/cut/runtime';
import { setCutProxy } from '../../services/cut/proxyActions';
import { loadProjectFonts } from '../../services/cut/fonts';
import { canvasSourceId, listCanvasMedia, mediaKindOfFile, staleCanvasClips, type CutCanvasMedia } from '../../services/cut/canvasMedia';
import {
  addClip, addTrack, clipEnd, clipsAt, cutId, effectiveTextStyle, findClip, moveClip, projectDuration, removeTrack, setSubtitleStyle,
  setTrackMuted, trimClip, updateClip, type CutClip, type CutTrackKind,
} from '../../services/cut/timeline';
import { CutTimeline } from './CutTimeline';
import { CutInspector } from './CutInspector';
import { CutSubtitlePanel } from './CutSubtitlePanel';
import { CutShortcutSheet } from './CutShortcutSheet';
import { useCut, useCutMediaRevision } from './useCut';

type Lang = 'zho' | 'en';
type LeftTab = 'media' | 'text' | 'subtitles';

export interface CutEditorProps {
  language: Lang;
  project: WorkflowProject | null;
  onNotify?: (message: string, level?: 'info' | 'success' | 'warning' | 'error') => void;
  /** 把导出的 MP4 放回画布（新建视频节点）。 */
  onSendToCanvas?: (file: File) => Promise<{ ok: boolean; error?: string }>;
  /** 联动片段"在画布中定位"。 */
  onFocusNode?: (nodeId: string) => void;
}

const RESOLUTIONS = [
  { id: '1920x1080', width: 1920, height: 1080, label: '1080p 16:9' },
  { id: '1280x720', width: 1280, height: 720, label: '720p 16:9' },
  { id: '1080x1920', width: 1080, height: 1920, label: '1080×1920 9:16' },
  { id: '1080x1080', width: 1080, height: 1080, label: '1080×1080 1:1' },
];

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = Math.floor(safe % 60);
  const cs = Math.floor((safe % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function previewSize(width: number, height: number) {
  const scale = Math.min(640 / width, 360 / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function CanvasMediaItem({ item, language, busy, onAdd }: { item: CutCanvasMedia; language: Lang; busy: boolean; onAdd: () => void }) {
  const zh = language === 'zho';
  const { url } = useWorkflowMediaUrl(item.kind === 'image' ? item.storageKey : item.posterStorageKey, item.kind === 'image' ? item.href : item.poster, item.kind === 'image' ? item.artifactRef : undefined);
  return (
    <button type="button" className="cut-bin__item" onClick={onAdd} disabled={busy} title={zh ? `加入时间线：${item.title}` : `Add to timeline: ${item.title}`} data-testid="cut-canvas-media">
      <span className="cut-bin__thumb">
        {url && item.kind !== 'audio' ? <img src={url} alt="" loading="lazy" draggable={false} /> : item.kind === 'audio' ? <Music size={16} /> : item.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}
      </span>
      <span className="cut-bin__name">{item.title}</span>
      <Plus size={13} className="cut-bin__add" />
    </button>
  );
}

/** 预览上的文字 / 字幕拖动框：拖动改位置（字幕改的是全部字幕的统一位置）。 */
function TextDragBox({ clip, scale, measure }: { clip: CutClip; scale: { width: number; height: number }; measure: OffscreenCanvasRenderingContext2D | null }) {
  const project = useCut(state => state.doc.present);
  if (!measure || !(clip.text || '').trim()) return null;
  const style = effectiveTextStyle(project, clip);
  const box = textBox(measure, clip.text!.trim(), style, scale.width, scale.height);
  const pad = box.size * 0.3;
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const before = getCutProject();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = { x: style.x ?? 0.5, y: style.y };
    const rect = (event.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.min(1, origin.x + (ev.clientX - startX) / rect.width));
      const y = Math.max(0, Math.min(1, origin.y + (ev.clientY - startY) / rect.height));
      const patch = { x: Math.abs(x - 0.5) < 0.015 ? 0.5 : x, y };
      const next = clip.kind === 'subtitle' ? setSubtitleStyle(getCutProject(), patch).project : updateClip(getCutProject(), clip.id, { textStyle: patch }).project;
      cutStore.getState().replace(next);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      cutStore.getState().commitFrom(before, clip.kind === 'subtitle' ? 'move subtitles' : 'move text');
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  return (
    <div
      className={`cut-dragbox${clip.kind === 'subtitle' ? ' is-subtitle' : ''}`}
      style={{ left: `${((box.cx - box.blockWidth / 2 - pad) / scale.width) * 100}%`, top: `${((box.cy - box.blockHeight / 2 - pad) / scale.height) * 100}%`, width: `${((box.blockWidth + pad * 2) / scale.width) * 100}%`, height: `${((box.blockHeight + pad * 2) / scale.height) * 100}%` }}
      onPointerDown={onPointerDown}
      title={clip.kind === 'subtitle' ? 'Drag to move all subtitles' : 'Drag to move'}
      data-testid="cut-dragbox"
    />
  );
}

export default function CutEditor({ language, project: workflowProject, onNotify, onSendToCanvas, onFocusNode }: CutEditorProps) {
  const zh = language === 'zho';
  const projectId = workflowProject?.id ?? null;
  const project = useCut(state => state.doc.present);
  const playhead = useCut(state => state.playhead);
  const selection = useCut(state => state.selection);
  const snapping = useCut(state => state.snapping);
  const canUndo = useCut(state => state.doc.past.length > 0);
  const canRedo = useCut(state => state.doc.future.length > 0);
  const mediaRevision = useCutMediaRevision();

  const [engine, setEngine] = useState<CutMediaEngine | null>(null);
  const playerRef = useRef<CutPlayer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pxPerSecond, setPxPerSecond] = useState(40);
  const [leftTab, setLeftTab] = useState<LeftTab>('media');
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [exporting, setExporting] = useState<CutExportProgress | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [exported, setExported] = useState<{ blob: Blob; url: string; info: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [sheet, setSheet] = useState(false);
  const notify = useCallback((message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => onNotify?.(message, level), [onNotify]);

  const duration = projectDuration(project);
  const preview = previewSize(project.width, project.height);
  const selected = selection.length === 1 ? findClip(project, selection[0]) : undefined;
  const canvasMedia = useMemo(() => listCanvasMedia(workflowProject), [workflowProject]);
  const staleClips = useMemo(() => new Set(staleCanvasClips(project, workflowProject?.nodes ?? []).map(item => item.clipId)), [project, workflowProject]);
  const offline = useMemo(() => new Set(project.sources.filter(source => !engine?.has(source.id)).map(source => source.id)),
    // mediaRevision：素材加载 / 释放后重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.sources, engine, mediaRevision]);
  const measure = useMemo(() => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4).getContext('2d') : null), []);

  // 绑定画布项目的时间线。
  useEffect(() => { cutStore.getState().open(projectId); }, [projectId]);

  // 引擎：挂载时持有，卸载时释放（最后一个持有者释放即 dispose）。
  useEffect(() => {
    let alive = true;
    void acquireCutEngine().then(created => { if (alive) setEngine(created); else releaseCutEngine(); });
    return () => {
      alive = false;
      exportAbort.current?.abort();
      playerRef.current?.dispose();
      playerRef.current = null;
      setEngine(current => { if (current) releaseCutEngine(); return null; });
    };
  }, []);

  // 恢复时间线里引用到的画布素材 + 字体。
  useEffect(() => {
    if (!engine) return;
    for (const source of project.sources) if (!engine.has(source.id)) void ensureSourceLoaded(engine, source);
    void loadProjectFonts(project).then(() => playerRef.current?.render());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, project.sources, project.subtitleStyle.fontFamily]);

  // 播放器：画布尺寸变了就重建。播放时间写回 store 的播放头。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    const player = new CutPlayer({
      backend: engine,
      canvas,
      getProject: getCutProject,
      onTime: t => cutStore.getState().setPlayhead(t),
      onPlayingChange: value => { setPlaying(value); if (cutStore.getState().playing !== value) cutStore.getState().setPlaying(value); },
    });
    playerRef.current = player;
    player.seek(cutStore.getState().playhead);
    return () => { player.dispose(); if (playerRef.current === player) playerRef.current = null; };
  }, [engine, preview.width, preview.height]);

  // 时间线 / 素材变了：丢掉旧解码流并重画。
  useEffect(() => { playerRef.current?.invalidate(); }, [project, mediaRevision]);

  // 外部（Agent、字幕列表）改播放头 / 播放状态时同步到播放器。
  useEffect(() => cutStore.subscribe((state, prev) => {
    const player = playerRef.current;
    if (!player) return;
    if (state.playing !== prev.playing) { if (state.playing) player.play(); else player.pause(); }
    if (state.playhead !== prev.playhead && !player.isPlaying && Math.abs(state.playhead - player.currentTime) > 1e-3) player.seek(state.playhead);
  }), []);

  const seek = useCallback((t: number) => {
    if (playerRef.current) playerRef.current.seek(t);
    else cutStore.getState().setPlayhead(t);
  }, []);

  const addFromCanvas = async (item: CutCanvasMedia) => {
    if (!engine) return;
    const sourceId = canvasSourceId(item.nodeId, item.version);
    setLoading(current => new Set(current).add(sourceId));
    try {
      await importCanvasNode(engine, item.nodeId);
    } catch (error) {
      notify(zh ? `无法导入「${item.title}」：${error instanceof Error ? error.message : String(error)}` : `Couldn't import "${item.title}": ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setLoading(current => { const next = new Set(current); next.delete(sourceId); return next; });
    }
  };

  const updateLinkedClip = async (clipId: string) => {
    if (!engine) return;
    try {
      await updateCanvasClip(engine, clipId);
      playerRef.current?.invalidate();
      notify(zh ? '已替换为画布节点的新版本' : 'Replaced with the new canvas version', 'success');
    } catch (error) {
      notify(zh ? `替换失败：${error instanceof Error ? error.message : String(error)}` : `Couldn't update: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!engine) return;
    for (const file of files) {
      const kind = mediaKindOfFile(file);
      if (!kind) { notify(zh ? `不支持的文件：${file.name}` : `Unsupported file: ${file.name}`, 'warning'); continue; }
      // 同名文件重新导入时复用原素材 id，让"素材离线"的片段恢复。
      const existing = getCutProject().sources.find(source => source.origin.type === 'file' && source.origin.fileName === file.name && !engine.has(source.id));
      try {
        if (existing) { engine.setBlob(existing.id, file); await engine.restoreProxy(existing).catch(() => undefined); playerRef.current?.invalidate(); continue; }
        await importCutMedia(engine, { sourceId: cutId('src'), kind, name: file.name, blob: file, origin: { type: 'file', fileName: file.name } });
      } catch (error) {
        notify(zh ? `无法读取 ${file.name}：${error instanceof Error ? error.message : String(error)}` : `Couldn't read ${file.name}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      }
    }
  };

  const commit = (result: ReturnType<typeof addClip>, label: string) => {
    const done = cutStore.getState().commit(result, label);
    if (!done.ok && done.error) notify(zh ? `操作未完成：${done.error}` : `Couldn't do that: ${done.error}`, 'warning');
    return done.ok;
  };
  const addText = () => commit(addClip(getCutProject(), { kind: 'text', start: cutStore.getState().playhead, text: zh ? '标题文字' : 'Title' }), 'add text');
  const newTrack = (kind: CutTrackKind) => commit(addTrack(getCutProject(), kind), 'add track');
  const zoom = useCallback((direction: 1 | -1) => setPxPerSecond(value => direction > 0 ? Math.min(400, value * 1.4) : Math.max(4, value / 1.4)), []);

  // 快捷键（剪映 / CapCut 默认）。输入框里不拦截。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (target && target !== document.body && !target.closest('[data-cut-editor]')) return;
      const action = actionForEvent(event);
      if (!action) return;
      event.preventDefault();
      runCutAction(action, { seek, togglePlay: () => playerRef.current?.toggle(), zoom, showShortcuts: () => setSheet(value => !value), notify: message => notify(message, 'warning') });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [seek, zoom, notify]);

  const startExport = async () => {
    if (duration <= 0 || exporting) return;
    playerRef.current?.pause();
    const abort = new AbortController();
    exportAbort.current = abort;
    setExporting({ progress: 0, frame: 0, frames: Math.round(duration * project.fps), phase: 'video' });
    if (exported) { URL.revokeObjectURL(exported.url); setExported(null); }
    try {
      let last = 0;
      const result = await exportCutMp4({
        signal: abort.signal,
        onProgress: progress => {
          const now = performance.now();
          if (now - last > 120 || progress.phase !== 'video') { last = now; setExporting(progress); }
        },
      });
      setExported({ blob: result.blob, url: URL.createObjectURL(result.blob), info: result.info });
      notify(zh ? '导出完成' : 'Export finished', 'success');
    } catch (error) {
      if (error instanceof CutExportCancelled) notify(zh ? '已取消导出' : 'Export cancelled', 'info');
      else notify(zh ? `导出失败：${error instanceof Error ? error.message : String(error)}` : `Export failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      exportAbort.current = null;
      setExporting(null);
    }
  };

  useEffect(() => () => { if (exported) URL.revokeObjectURL(exported.url); }, [exported]);

  const fileName = `${(workflowProject?.title || 'iris-cut').replace(/[\\/:*?"<>|]+/g, '-')}.mp4`;
  const sendToCanvas = async () => {
    if (!exported || !onSendToCanvas) return;
    setSending(true);
    const result = await onSendToCanvas(new File([exported.blob], fileName, { type: 'video/mp4' }));
    setSending(false);
    if (result.ok) notify(zh ? '已放到画布上（视频节点）' : 'Added to the canvas as a video node', 'success');
    else notify(result.error || (zh ? '放回画布失败' : 'Could not add to the canvas'), 'error');
  };

  // 预览拖动框：选中的文字片段，或播放头下的字幕。
  const overlayClip = selected && (selected.kind === 'text' || selected.kind === 'subtitle') && playhead >= selected.start && playhead < clipEnd(selected)
    ? selected : clipsAt(project, playhead).find(clip => clip.kind === 'subtitle');
  const videoSources = project.sources.filter(source => source.kind === 'video');

  const tabs: Array<{ id: LeftTab; label: string; icon: ReactNode }> = [
    { id: 'media', label: zh ? '媒体' : 'Media', icon: <Film size={12} /> },
    { id: 'text', label: zh ? '文字' : 'Text', icon: <Type size={12} /> },
    { id: 'subtitles', label: zh ? '字幕' : 'Subtitles', icon: <Captions size={12} /> },
  ];

  return (
    <div className="cut-editor" data-cut-editor data-testid="cut-editor" tabIndex={-1}>
      <section className="iris-panel cut-bin" aria-label={zh ? '素材' : 'Assets'}>
        <div className="iris-segments cut-bin__tabs" role="tablist">
          {tabs.map(tab => (
            <button key={tab.id} type="button" role="tab" aria-selected={leftTab === tab.id} className={`iris-segments__item${leftTab === tab.id ? ' is-active' : ''}`} onClick={() => setLeftTab(tab.id)} data-testid={`cut-left-${tab.id}`}>
              {leftTab === tab.id && <span className="iris-segments__pill" aria-hidden />}
              <span className="iris-segments__text cut-page__tab">{tab.icon}{tab.label}</span>
            </button>
          ))}
        </div>
        {leftTab === 'media' && (
          <>
            <div className="cut-subs__actions">
              <button type="button" className="iris-ghost-pill cut-pill" onClick={() => fileRef.current?.click()} data-testid="cut-import-files"><FolderOpen size={13} />{zh ? '本地文件' : 'Local files'}</button>
              {videoSources.length > 0 && <button type="button" className="iris-ghost-pill cut-pill" title={zh ? '为全部视频生成 540p 代理（只影响预览）' : 'Make 540p proxies for every video (preview only)'} onClick={() => { for (const source of videoSources) if (engine?.proxyInfo(source.id).status === 'none') void setCutProxy(source.id, 540); }} data-testid="cut-proxy-all">{zh ? '全部代理' : 'Proxy all'}</button>}
            </div>
            <input ref={fileRef} type="file" multiple accept="video/*,image/*,audio/*" hidden onChange={onFiles} data-testid="cut-file-input" />
            <div className="cut-bin__list">
              <div className="cut-bin__group">{zh ? '画布' : 'Canvas'}</div>
              {canvasMedia.length === 0 && <p className="cut-bin__empty">{workflowProject ? (zh ? '画布上还没有图片 / 视频 / 音频节点。' : 'No image, video or audio nodes on the canvas yet.') : (zh ? '还没有画布。' : 'No canvas yet.')}</p>}
              {canvasMedia.map(item => (
                <CanvasMediaItem key={item.nodeId} item={item} language={language} busy={!engine || loading.has(canvasSourceId(item.nodeId, item.version))} onAdd={() => void addFromCanvas(item)} />
              ))}
              {project.sources.some(source => source.origin.type === 'file') && <div className="cut-bin__group">{zh ? '本地文件' : 'Local files'}</div>}
              {project.sources.filter(source => source.origin.type === 'file').map(source => {
                const proxy = source.kind === 'video' && engine ? engine.proxyInfo(source.id) : null;
                return (
                  <button key={source.id} type="button" className={`cut-bin__item${offline.has(source.id) ? ' is-offline' : ''}`} onClick={() => offline.has(source.id) ? fileRef.current?.click() : commit(addClip(getCutProject(), { kind: source.kind, sourceId: source.id }), 'add clip')} title={offline.has(source.id) ? (zh ? '未加载，点此重新导入' : 'Offline, click to re-import') : source.name}>
                    <span className="cut-bin__thumb">{source.kind === 'audio' ? <Music size={16} /> : source.kind === 'video' ? <Film size={16} /> : <ImageIcon size={16} />}</span>
                    <span className="cut-bin__name">{source.name}</span>
                    {proxy && proxy.status !== 'none' && <span className="cut-badge">{proxy.status === 'ready' ? `${proxy.height}p` : `${Math.round((proxy.progress ?? 0) * 100)}%`}</span>}
                    <Plus size={13} className="cut-bin__add" />
                  </button>
                );
              })}
            </div>
          </>
        )}
        {leftTab === 'text' && (
          <div className="cut-bin__list">
            <button type="button" className="cut-preset" onClick={addText} data-testid="cut-add-text-preset"><Type size={14} />{zh ? '默认文字' : 'Default text'}</button>
            <button type="button" className="cut-preset" onClick={() => setLeftTab('subtitles')}><Captions size={14} />{zh ? '字幕（列表编辑、SRT / VTT）' : 'Subtitles (list, SRT / VTT)'}</button>
            <p className="cut-bin__empty">{zh ? '文字会加在播放头处；在属性面板里换字体、颜色、描边，在预览里拖动位置。' : 'Text is added at the playhead; change font, colour and stroke in the inspector and drag it in the preview.'}</p>
          </div>
        )}
        {leftTab === 'subtitles' && <CutSubtitlePanel language={language} onSeek={seek} notify={notify} />}
      </section>

      <section className="iris-panel cut-stage" aria-label={zh ? '预览' : 'Preview'}>
        <header className="cut-panel__head">
          <h2 className="cut-panel__title">{zh ? '播放器' : 'Player'}</h2>
          <select className="cut-select" value={`${project.width}x${project.height}`} aria-label={zh ? '画面尺寸' : 'Frame size'} onChange={event => {
            const preset = RESOLUTIONS.find(item => item.id === event.target.value);
            if (preset) cutStore.getState().apply({ ...getCutProject(), width: preset.width, height: preset.height }, 'resize');
          }}>
            {RESOLUTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <span className="cut-panel__spacer" />
          <button type="button" className="iris-ghost-pill cut-pill is-primary" onClick={() => void startExport()} disabled={duration <= 0 || !!exporting} data-testid="cut-export"><Download size={13} />{zh ? '导出 MP4' : 'Export MP4'}</button>
        </header>
        <div className="cut-stage__screen">
          <div className="cut-stage__frame" style={{ ['--cut-ar' as string]: String(project.width / project.height) }}>
            <canvas ref={canvasRef} width={preview.width} height={preview.height} className="cut-stage__canvas" data-testid="cut-preview" />
            {overlayClip && !playing && <TextDragBox clip={overlayClip} scale={preview} measure={measure} />}
          </div>
          {duration <= 0 && (
            <div className="cut-stage__empty">
              <Film size={22} />
              <p>{zh ? '从左侧画布素材或本地文件开始，把片段加到时间线上。' : 'Add clips from the canvas or local files to start cutting.'}</p>
            </div>
          )}
          {exporting && (
            <div className="cut-export" role="status" data-testid="cut-export-progress">
              <div className="cut-export__label">{exporting.phase === 'finalizing' ? (zh ? '正在封装…' : 'Finalizing…') : `${zh ? '导出中' : 'Exporting'} ${Math.round(exporting.progress * 100)}%`}<span>{exporting.frame}/{exporting.frames}</span></div>
              <div className="cut-export__bar"><span style={{ width: `${Math.round(exporting.progress * 100)}%` }} /></div>
              <button type="button" className="iris-ghost-pill cut-pill" onClick={() => exportAbort.current?.abort()} data-testid="cut-export-cancel"><X size={13} />{zh ? '取消' : 'Cancel'}</button>
            </div>
          )}
          {exported && !exporting && (
            <div className="cut-export is-done" data-testid="cut-export-done">
              <div className="cut-export__label">{zh ? '导出完成' : 'Export ready'}<span>{exported.info}</span></div>
              <div className="cut-export__actions">
                <a className="iris-ghost-pill cut-pill" href={exported.url} download={fileName}><Download size={13} />{zh ? '下载' : 'Download'}</a>
                {onSendToCanvas && workflowProject && <button type="button" className="iris-ghost-pill cut-pill is-primary" disabled={sending} onClick={() => void sendToCanvas()} data-testid="cut-send-canvas"><SendToBack size={13} />{zh ? '放回画布' : 'Add to canvas'}</button>}
                <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '关闭' : 'Dismiss'} onClick={() => { URL.revokeObjectURL(exported.url); setExported(null); }}><X size={12} /></button>
              </div>
            </div>
          )}
        </div>
        <div className="cut-transport">
          <button type="button" className="iris-icon-btn" aria-label={playing ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play')} onClick={() => playerRef.current?.toggle()} disabled={duration <= 0} data-testid="cut-play">{playing ? <Pause size={15} /> : <Play size={15} />}</button>
          <span className="cut-transport__time">{formatTime(playhead)} / {formatTime(duration)}</span>
          <input className="cut-scrub" type="range" min={0} max={Math.max(duration, 0.01)} step={1 / project.fps} value={Math.min(playhead, duration)} onChange={event => seek(Number(event.target.value))} aria-label={zh ? '拖动定位' : 'Scrub'} disabled={duration <= 0} data-testid="cut-scrub" />
        </div>
      </section>

      <section className="iris-panel cut-inspector" aria-label={zh ? '属性' : 'Inspector'}>
        <header className="cut-panel__head"><h2 className="cut-panel__title">{zh ? '属性' : 'Inspector'}</h2>{selection.length > 1 && <span className="cut-badge">{selection.length} {zh ? '个片段' : 'clips'}</span>}</header>
        <CutInspector language={language} project={project} clip={selected} playhead={playhead} engine={engine} notify={notify} stale={!!selected && staleClips.has(selected.id)} onLocate={onFocusNode} onUpdate={id => void updateLinkedClip(id)} />
      </section>

      <section className="iris-panel cut-timeline-panel" aria-label={zh ? '时间线' : 'Timeline'}>
        <header className="cut-panel__head cut-toolbar">
          <button type="button" className="iris-icon-btn is-small" title={zh ? '撤销 (⌘Z)' : 'Undo (Ctrl+Z)'} disabled={!canUndo} onClick={() => cutStore.getState().undo()}><Undo2 size={13} /></button>
          <button type="button" className="iris-icon-btn is-small" title={zh ? '重做 (⇧⌘Z)' : 'Redo (Ctrl+Shift+Z)'} disabled={!canRedo} onClick={() => cutStore.getState().redo()}><Redo2 size={13} /></button>
          <span className="cut-toolbar__sep" />
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => runCutAction('split', { notify: message => notify(message, 'warning') })} disabled={duration <= 0} data-testid="cut-split" title="Ctrl/⌘ + B"><Scissors size={13} />{zh ? '分割' : 'Split'}</button>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => runCutAction('delete-left', { notify: message => notify(message, 'warning') })} disabled={duration <= 0} title="Q">{zh ? '删左 Q' : 'Del left Q'}</button>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => runCutAction('delete-right', { notify: message => notify(message, 'warning') })} disabled={duration <= 0} title="W">{zh ? '删右 W' : 'Del right W'}</button>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => runCutAction('delete-selected')} disabled={!selection.length} data-testid="cut-delete"><Trash2 size={13} />{zh ? '删除' : 'Delete'}</button>
          <span className="cut-toolbar__sep" />
          <button type="button" className="iris-ghost-pill cut-pill" onClick={addText} data-testid="cut-add-text"><Type size={13} />{zh ? '文字' : 'Text'}</button>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => newTrack('video')}><Plus size={12} />{zh ? '视频轨' : 'Video'}</button>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => newTrack('audio')}><Plus size={12} />{zh ? '音频轨' : 'Audio'}</button>
          <button type="button" className="iris-ghost-pill cut-pill" onClick={() => newTrack('subtitle')}><Plus size={12} />{zh ? '字幕轨' : 'Subtitle'}</button>
          <span className="cut-panel__spacer" />
          <button type="button" className={`iris-icon-btn is-small${snapping ? ' is-on' : ''}`} aria-pressed={snapping} title={zh ? `吸附 ${snapping ? '开' : '关'}（N）` : `Snapping ${snapping ? 'on' : 'off'} (N)`} onClick={() => cutStore.getState().toggleSnapping()} data-testid="cut-snapping"><Magnet size={13} /></button>
          <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '快捷键' : 'Shortcuts'} title={zh ? '快捷键（?）' : 'Shortcuts (?)'} onClick={() => setSheet(true)} data-testid="cut-shortcuts-open"><Keyboard size={13} /></button>
          <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '缩小' : 'Zoom out'} onClick={() => zoom(-1)}><ZoomOut size={13} /></button>
          <button type="button" className="iris-icon-btn is-small" aria-label={zh ? '放大' : 'Zoom in'} onClick={() => zoom(1)}><ZoomIn size={13} /></button>
        </header>
        <CutTimeline
          language={language}
          project={project}
          engine={engine}
          time={playhead}
          selection={selection}
          snapping={snapping}
          pxPerSecond={pxPerSecond}
          offline={offline}
          mediaRevision={mediaRevision}
          onSelect={ids => cutStore.getState().select(ids)}
          onSeek={seek}
          onMove={(clipId, trackId, start) => commit(moveClip(getCutProject(), clipId, trackId, start), 'move')}
          onTrim={(clipId, edge, at) => commit(trimClip(getCutProject(), clipId, edge, at), 'trim')}
          onToggleMute={trackId => cutStore.getState().apply(setTrackMuted(getCutProject(), trackId, !getCutProject().tracks.find(track => track.id === trackId)?.muted), 'mute')}
          onRemoveTrack={trackId => commit(removeTrack(getCutProject(), trackId), 'remove track')}
          stale={staleClips}
          onUpdateClip={id => void updateLinkedClip(id)}
        />
      </section>
      {sheet && <CutShortcutSheet language={language} onClose={() => setSheet(false)} />}
    </div>
  );
}
