import { AlertTriangle, Check, FolderOpen, Loader2, Plug, RefreshCw, Search, Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWorkflowImageThumbnail, createWorkflowVideoPoster } from './media';
import { STUDIO_MEDIA_DRAG_TYPE } from '../studio/StudioMediaBrowser';
import {
  LocalFolderError,
  adoptLocalFolderHandle,
  createThumbnailLimiter,
  forgetLocalFolderSource,
  getLocalFolderPermission,
  isLocalFolderSupported,
  listLocalFolderSources,
  localFolderHref,
  pickLocalFolder,
  readLocalFolderFile,
  readLocalFolderThumbnail,
  requestLocalFolderPermission,
  scanLocalFolder,
  writeLocalFolderThumbnail,
  type LocalFolderEntry,
  type LocalFolderMediaKind,
  type LocalFolderPermission,
  type LocalFolderSource,
} from '../../services/localFolderSource';
import { displayError } from '../../services/displayError';

const runThumbnailTask = createThumbnailLimiter(3);

export interface LocalFolderBrowserProps {
  language: 'en' | 'zho';
  onInsert: (entries: LocalFolderEntry[]) => void | Promise<void>;
}

type KindFilter = 'all' | LocalFolderMediaKind;

const KIND_LABEL: Record<KindFilter, { zho: string; en: string }> = {
  all: { zho: '全部', en: 'All' },
  image: { zho: '图片', en: 'Images' },
  video: { zho: '视频', en: 'Videos' },
  audio: { zho: '音频', en: 'Audio' },
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 单个条目的缩略图：进入视口才生成，生成结果写进本地缓存。
 * 原文件只被读取用于生成缩略图，不会复制进项目存储。
 */
function LocalFolderThumb({ entry }: { entry: LocalFolderEntry }) {
  const holderRef = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing'>('idle');

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      if (cancelled) return;
      // 音频没有可用封面，直接用占位符号。
      if (entry.kind === 'audio') {
        setState('idle');
        return;
      }
      setState('loading');
      try {
        const cached = await readLocalFolderThumbnail(entry);
        if (cancelled) return;
        if (cached) {
          objectUrl = URL.createObjectURL(cached);
          setUrl(objectUrl);
          setState('idle');
          return;
        }
        const file = await readLocalFolderFile(entry.folderId, entry.relativePath);
        const generated = entry.kind === 'video'
          ? await createWorkflowVideoPoster(file, 320)
          : (await createWorkflowImageThumbnail(file))?.blob ?? null;
        if (cancelled) return;
        if (!generated) {
          setState('missing');
          return;
        }
        await writeLocalFolderThumbnail(entry, generated).catch(() => undefined);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(generated);
        setUrl(objectUrl);
        setState('idle');
      } catch {
        if (!cancelled) setState('missing');
      }
    };

    const schedule = () => { void runThumbnailTask(load); };
    if (typeof IntersectionObserver === 'undefined') {
      schedule();
      return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(item => item.isIntersecting)) return;
      observer.disconnect();
      schedule();
    }, { rootMargin: '120px' });
    observer.observe(holder);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry]);

  return (
    <span ref={holderRef} className="local-folder-card__thumb" data-testid={`local-folder-thumb-${entry.relativePath}`}>
      {url
        ? <img src={url} alt={entry.name} draggable={false} loading="lazy" />
        : <span className="local-folder-card__thumb-fallback" aria-hidden>
          {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : entry.kind === 'audio' ? '♪' : '·'}
        </span>}
    </span>
  );
}

export const LocalFolderBrowser: React.FC<LocalFolderBrowserProps> = ({ language, onInsert }) => {
  const zho = language === 'zho';
  const supported = isLocalFolderSupported();
  const [sources, setSources] = useState<LocalFolderSource[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [permission, setPermission] = useState<LocalFolderPermission>('missing');
  const [entries, setEntries] = useState<LocalFolderEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dropping, setDropping] = useState(false);
  const [inserting, setInserting] = useState(false);

  const refreshSources = useCallback(async () => {
    const list = await listLocalFolderSources();
    setSources(list);
    setActiveId(current => current && list.some(item => item.id === current) ? current : list[0]?.id ?? null);
    return list;
  }, []);

  useEffect(() => { void refreshSources(); }, [refreshSources]);

  const scan = useCallback(async (folderId: string, isCurrent?: () => boolean) => {
    const stale = () => (isCurrent ? !isCurrent() : false);
    setScanning(true);
    setNotice(null);
    try {
      const result = await scanLocalFolder(folderId);
      // 快速切换文件夹时只让最新一次扫描的结果落地，避免旧结果覆盖新目录。
      if (stale()) return;
      setEntries(result);
    } catch (error) {
      if (stale()) return;
      setEntries([]);
      setNotice(error instanceof LocalFolderError ? error.message : (zho ? '读取文件夹失败。' : 'Failed to read the folder.'));
    } finally {
      // 过期扫描不再触碰状态，scanning 由最新一次扫描或切换目录的分支负责复位。
      if (!stale()) setScanning(false);
    }
  }, [zho]);

  useEffect(() => {
    if (!activeId) {
      setPermission('missing');
      setEntries([]);
      setScanning(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const state = await getLocalFolderPermission(activeId);
      if (cancelled) return;
      setPermission(state);
      if (state === 'granted') await scan(activeId, () => !cancelled);
      else setEntries([]);
    })();
    return () => { cancelled = true; };
  }, [activeId, scan]);

  useEffect(() => { setSelected(new Set()); }, [activeId]);

  const pick = useCallback(async () => {
    setNotice(null);
    try {
      const source = await pickLocalFolder();
      await refreshSources();
      setActiveId(source.id);
    } catch (error) {
      // 用户取消/浏览器拒绝都不再静默：取消给一条轻提示，权限拒绝与安全
      // 拦截给可操作文案；真实错误维持原有 LocalFolderError 文案路径。
      if (error instanceof DOMException && error.name === 'AbortError') {
        setNotice(zho ? '已取消选择文件夹。' : 'Folder selection cancelled.');
        return;
      }
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        setNotice(zho ? '浏览器拒绝了文件夹访问 — 请在页面中直接点击重试，或检查站点权限。' : 'The browser blocked folder access — click to retry inside the page, or check site permissions.');
        return;
      }
      setNotice(error instanceof LocalFolderError ? error.message : (zho ? '无法选择文件夹。' : 'Could not select the folder.'));
    }
  }, [refreshSources, zho]);

  const reconnect = useCallback(async () => {
    if (!activeId) return;
    const granted = await requestLocalFolderPermission(activeId);
    setPermission(granted ? 'granted' : 'denied');
    if (granted) await scan(activeId);
    else setNotice(zho ? '未获得文件夹读取权限。' : 'Folder read permission was not granted.');
  }, [activeId, scan, zho]);

  const forget = useCallback(async (folderId: string) => {
    await forgetLocalFolderSource(folderId);
    setEntries([]);
    setSelected(new Set());
    await refreshSources();
  }, [refreshSources]);

  const handleDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    // 必须在同步段最开头阻止默认行为：任何分支提前返回都不能让浏览器打开拖入的文件。
    event.preventDefault();
    const items = Array.from(event.dataTransfer?.items || []) as Array<DataTransferItem & { getAsFileSystemHandle?: () => Promise<unknown> }>;
    // DataTransferItem 在事件回调返回后失效，必须同步取到 promise 再 await。
    const pending: Promise<unknown>[] = [];
    for (const item of items) {
      const getter = item.getAsFileSystemHandle;
      if (typeof getter !== 'function') continue;
      try {
        pending.push(getter.call(item));
      } catch {
        // 单项无法转成句柄时继续尝试其余项。
      }
    }
    if (!pending.length) {
      setNotice(zho ? '当前浏览器不支持从拖放中保留文件夹引用，请改用“选择文件夹”。' : 'This browser cannot keep a folder reference from a drop. Use "Choose folder" instead.');
      return;
    }
    setDropping(false);
    setNotice(null);
    for (const promise of pending) {
      let handle: unknown;
      try {
        handle = await promise;
      } catch {
        continue;
      }
      try {
        const source = await adoptLocalFolderHandle(handle);
        await refreshSources();
        setActiveId(source.id);
        return;
      } catch (error) {
        setNotice(error instanceof LocalFolderError ? error.message : (zho ? '无法使用拖入的文件夹。' : 'Could not use the dropped folder.'));
        return;
      }
    }
    setNotice(zho ? '拖入的内容里没有可用的文件夹。' : 'No usable folder was found in the drop.');
  }, [refreshSources, zho]);

  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return entries.filter(entry => {
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false;
      if (keyword && !entry.relativePath.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [entries, kindFilter, query]);

  const activeSource = useMemo(() => sources.find(source => source.id === activeId) || null, [activeId, sources]);

  const counts = useMemo(() => entries.reduce((result, entry) => {
    result[entry.kind] = (result[entry.kind] || 0) + 1;
    return result;
  }, {} as Partial<Record<LocalFolderMediaKind, number>>), [entries]);

  const toggle = (relativePath: string) => {
    setSelected(current => {
      const next = new Set(current);
      if (next.has(relativePath)) next.delete(relativePath);
      else next.add(relativePath);
      return next;
    });
  };

  const insertSelected = async () => {
    const picked = entries.filter(entry => selected.has(entry.relativePath));
    if (!picked.length) {
      setNotice(zho ? '先选择要放进画布的素材。' : 'Select the assets to add to the canvas first.');
      return;
    }
    setInserting(true);
    setNotice(null);
    try {
      await onInsert(picked);
      setSelected(new Set());
      setNotice(zho ? `已把 ${picked.length} 个素材放入画布。` : `Added ${picked.length} assets to the canvas.`);
    } catch (error) {
      setNotice(displayError(error, (zho ? '放入画布失败。' : 'Failed to add to the canvas.')));
    } finally {
      setInserting(false);
    }
  };

  // Insert a single entry — used by double-click and Enter so the canvas gets
  // exactly one node regardless of the current multi-selection.
  const insertOne = async (entry: LocalFolderEntry) => {
    setInserting(true);
    setNotice(null);
    try {
      await onInsert([entry]);
      setSelected(new Set());
      setNotice(zho ? `已把 ${entry.name} 放入画布。` : `Added ${entry.name} to the canvas.`);
    } catch (error) {
      setNotice(displayError(error, (zho ? '放入画布失败。' : 'Failed to add to the canvas.')));
    } finally {
      setInserting(false);
    }
  };

  // Drag a local-folder entry to the canvas. We emit the shared studio-media
  // drag type with a `local-folder:` href — the canvas drop handler resolves it
  // through readLocalFolderFile, so the original file is referenced, not copied.
  // Dragging a selected card carries the whole selection; an unselected card
  // drags just itself.
  const startEntryDrag = (event: React.DragEvent, entry: LocalFolderEntry) => {
    const picked = selected.has(entry.relativePath) && selected.size > 1
      ? entries.filter(item => selected.has(item.relativePath))
      : [entry];
    const items = picked.map(item => ({
      id: localFolderHref(item.folderId, item.relativePath),
      source: 'asset' as const,
      name: item.name,
      href: localFolderHref(item.folderId, item.relativePath),
      mimeType: item.mimeType,
      // StudioMediaItem types this image|video; the workflow drop parser accepts
      // audio too and resolves the real kind from the loaded File's MIME, so the
      // kind stays honest for local-folder audio entries.
      type: item.kind as 'image' | 'video' | 'audio',
    }));
    event.dataTransfer.effectAllowed = 'copy';
    // The canvas drop path expects a single WorkflowSharedMedia for the primary
    // payload; extra selected entries ride along in a parallel key.
    event.dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, JSON.stringify(items[0]));
    if (items.length > 1) {
      event.dataTransfer.setData('application/x-flovart-local-folder-batch', JSON.stringify(items));
    }
    event.dataTransfer.setData('text/plain', JSON.stringify(items[0]));
  };

  if (!supported) {
    return (
      <div className="local-folder-empty" data-testid="local-folder-unsupported">
        <AlertTriangle size={18} />
        <p>{zho ? '当前环境不支持直接读取本地文件夹。' : 'This environment cannot read a local folder directly.'}</p>
        <p className="local-folder-empty__hint">
          {zho
            ? '文件夹直读依赖浏览器目录授权。宿主 iframe 中可能被浏览器禁用，请改用素材导入或桌面端入口。'
            : 'Folder reading relies on browser directory grants and may be disabled inside a host iframe. Use asset import or the desktop entry instead.'}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`local-folder-browser${dropping ? ' is-dropping' : ''}`}
      data-testid="local-folder-browser"
      onDragOver={event => { event.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={event => { void handleDrop(event); }}
    >
      <div className="local-folder-toolbar">
        <button type="button" className="local-folder-btn" onClick={() => void pick()} data-testid="local-folder-pick">
          <FolderOpen size={13} />
          <span>{zho ? '选择文件夹' : 'Choose folder'}</span>
        </button>
      </div>

      {activeSource && (
        <div className="local-folder-connected" data-testid="local-folder-connected">
          <FolderOpen size={12} aria-hidden />
          <span className="local-folder-connected__name" title={activeSource.name}>{activeSource.name}</span>
          <span className="local-folder-connected__count">
            {zho ? `${entries.length} 项` : `${entries.length} items`}
          </span>
          <span className={`local-folder-connected__state is-${permission}`}>
            {permission === 'granted'
              ? (zho ? '已连接' : 'Connected')
              : (zho ? '需要授权' : 'Needs access')}
          </span>
          <button type="button" className="local-folder-btn" onClick={() => void scan(activeSource.id)} disabled={scanning} title={zho ? '重新扫描' : 'Rescan'}>
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button type="button" className="local-folder-btn" onClick={() => void forget(activeSource.id)} title={zho ? '忘记该文件夹' : 'Forget folder'}>
            <Trash2 size={12} />
          </button>
        </div>
      )}

      {sources.length > 1 && (
        <div className="local-folder-sources">
          {sources.map(source => (
            <button
              key={source.id}
              type="button"
              className={`local-folder-source${source.id === activeId ? ' is-active' : ''}`}
              onClick={() => setActiveId(source.id)}
              title={source.name}
            >
              {source.name}
            </button>
          ))}
        </div>
      )}

      {!activeId && <p className="local-folder-hint">{zho ? '选择一个文件夹开始浏览，或把文件夹拖到这里。' : 'Choose a folder to start, or drop one here.'}</p>}

      {activeId && permission !== 'granted' && (
        <div className="local-folder-notice" role="status">
          <span>
            {permission === 'missing'
              ? (zho ? '本地文件夹授权已失效，请重新选择。' : 'The folder grant is gone. Choose it again.')
              : (zho ? '浏览器需要你再次确认该文件夹的读取权限。' : 'The browser needs you to confirm folder access again.')}
          </span>
          {permission !== 'missing' && (
            <button type="button" className="local-folder-btn" onClick={() => void reconnect()}>
              <Plug size={13} />
              <span>{zho ? '重新连接' : 'Reconnect'}</span>
            </button>
          )}
        </div>
      )}

      {activeId && permission === 'granted' && (
        <>
          <div className="local-folder-search">
            <Search size={12} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder={zho ? '筛选文件名' : 'Filter file names'}
              aria-label={zho ? '筛选文件名' : 'Filter file names'}
            />
          </div>
          <div className="local-folder-filters">
            {(Object.keys(KIND_LABEL) as KindFilter[]).map(key => (
              <button
                key={key}
                type="button"
                className={`local-folder-chip${kindFilter === key ? ' is-active' : ''}`}
                onClick={() => setKindFilter(key)}
                data-testid={`local-folder-filter-${key}`}
              >
                {zho ? KIND_LABEL[key].zho : KIND_LABEL[key].en}
                {key !== 'all' && counts[key] ? <span>{counts[key]}</span> : null}
              </button>
            ))}
          </div>

          <div
            className="local-folder-grid"
            data-testid="local-folder-grid"
            onClick={event => { if (event.target === event.currentTarget) setSelected(new Set()); }}
          >
            {visibleEntries.map(entry => {
              const active = selected.has(entry.relativePath);
              return (
                <button
                  key={entry.relativePath}
                  type="button"
                  title={`${entry.relativePath} · ${formatBytes(entry.bytes)}`}
                  className={`local-folder-card${active ? ' is-selected' : ''}`}
                  onClick={() => toggle(entry.relativePath)}
                  onDoubleClick={() => void insertOne(entry)}
                  onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void insertOne(entry); } }}
                  draggable
                  onDragStart={event => startEntryDrag(event, entry)}
                  aria-pressed={active}
                  data-testid={`local-folder-card-${entry.relativePath}`}
                >
                  <LocalFolderThumb entry={entry} />
                  {active && <span className="local-folder-card__check"><Check size={11} /></span>}
                  <span className="local-folder-card__name">{entry.name}</span>
                </button>
              );
            })}
            {!scanning && !visibleEntries.length && (
              <p className="local-folder-hint">{zho ? '这个范围内没有匹配的图片、视频或音频。' : 'No matching image, video or audio in this folder.'}</p>
            )}
            {scanning && <p className="local-folder-hint">{zho ? '正在扫描…' : 'Scanning…'}</p>}
          </div>

          <div className="local-folder-footer">
            <span>{zho ? `已选 ${selected.size} / ${entries.length}` : `${selected.size} / ${entries.length} selected`}</span>
            <button type="button" className="local-folder-btn is-primary" onClick={() => void insertSelected()} disabled={inserting || !selected.size} data-testid="local-folder-insert">
              {inserting ? <Loader2 size={13} className="animate-spin" /> : null}
              <span>{zho ? '放入画布' : 'Add to canvas'}</span>
            </button>
          </div>
        </>
      )}

      {notice && <p className="local-folder-notice" role="status">{notice}</p>}
      {activeSource?.persisted === false && (
        <p className="local-folder-hint">
          {zho
            ? '该文件夹授权只能在本会话内保留，刷新后需要重新选择。'
            : 'This folder grant only lasts for this session; choose it again after a reload.'}
        </p>
      )}
      <p className="local-folder-hint">
        {zho
          ? '只引用原文件，不复制副本；仅缩略图会被缓存在本机。使用云端模型时，被引用的素材会随本次生成发送给对应供应商。'
          : 'Original files are referenced, not copied; only thumbnails are cached locally. With cloud models, referenced assets are sent to that provider for the generation.'}
      </p>
    </div>
  );
};
