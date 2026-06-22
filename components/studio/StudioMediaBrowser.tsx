import { Download, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useMemo, useState, type DragEvent } from 'react';

export const STUDIO_MEDIA_DRAG_TYPE = 'application/x-flovart-studio-media';

export interface StudioMediaItem {
  id: string;
  source?: 'history' | 'asset';
  sourceId?: string;
  name: string;
  href: string;
  mimeType: string;
  type: 'image' | 'video';
  category?: 'character' | 'scene' | 'prop';
  width?: number;
  height?: number;
  createdAt?: number;
  prompt?: string;
}

interface StudioMediaBrowserProps {
  mode: 'history' | 'assets';
  items: StudioMediaItem[];
  language: 'en' | 'zho';
  onInsert: (item: StudioMediaItem) => void;
  onRename?: (item: StudioMediaItem, name: string) => void;
  onRemove?: (item: StudioMediaItem) => void;
  onReversePrompt?: (item: StudioMediaItem) => Promise<string>;
}

type MediaFilter = 'all' | 'image' | 'video';
type CategoryFilter = 'all' | 'character' | 'scene' | 'prop';

const categoryLabels: Record<CategoryFilter, string> = {
  all: '全部',
  character: '角色',
  scene: '场景',
  prop: '道具',
};

export function StudioMediaBrowser({ mode, items, language, onInsert, onRename, onRemove, onReversePrompt }: StudioMediaBrowserProps) {
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [notice, setNotice] = useState('');
  const isChinese = language === 'zho';
  const title = mode === 'history' ? (isChinese ? '历史生成' : 'Generation History') : (isChinese ? '我的素材' : 'My Assets');
  const searchLabel = mode === 'history' ? (isChinese ? '搜索生成历史' : 'Search History') : (isChinese ? '搜索素材库' : 'Search Assets');

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items.filter(item => {
      if (mediaFilter !== 'all' && item.type !== mediaFilter) return false;
      if (mode === 'assets' && category !== 'all' && item.category !== category) return false;
      return !keyword || `${item.name} ${item.prompt || ''}`.toLocaleLowerCase().includes(keyword);
    });
  }, [category, items, mediaFilter, mode, query]);

  const startDrag = (event: DragEvent<HTMLElement>, item: StudioMediaItem) => {
    const payload = JSON.stringify(item);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, payload);
    event.dataTransfer.setData('text/plain', payload);
  };

  const saveName = (item: StudioMediaItem) => {
    const nextName = editingName.trim();
    if (nextName && nextName !== item.name) onRename?.(item, nextName);
    setEditingId(null);
    setEditingName('');
  };

  const reversePrompt = async (item: StudioMediaItem) => {
    if (!onReversePrompt) return;
    setNotice(isChinese ? '正在反推 Prompt…' : 'Analyzing Prompt…');
    try {
      const prompt = await onReversePrompt(item);
      await navigator.clipboard?.writeText(prompt);
      setNotice(isChinese ? 'Prompt 已复制' : 'Prompt Copied');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : (isChinese ? '反推失败' : 'Analysis Failed'));
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={title}>
      <div className="shrink-0 border-b px-3 pb-3 pt-2.5" style={{ borderColor: 'var(--isl-border)' }}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{title}</h2>
            <p className="mt-0.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{isChinese ? '点击添加，或直接拖到画布' : 'Click to add, or drag onto the canvas'}</p>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--isl-ink-soft)' }}>{filtered.length}/{items.length}</span>
        </div>
        <label className="isl-well flex h-9 items-center gap-2 px-2.5 focus-within:ring-2 focus-within:ring-[var(--isl-mint)]">
          <Search size={14} aria-hidden="true" style={{ color: 'var(--isl-ink-ghost)' }} />
          <input
            type="search"
            name={`${mode}-media-search`}
            autoComplete="off"
            aria-label={searchLabel}
            placeholder={`${searchLabel}…`}
            value={query}
            onChange={event => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            style={{ color: 'var(--isl-ink)' }}
          />
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label={isChinese ? '媒体类型' : 'Media Type'}>
          {(['all', 'image', 'video'] as const).map(filter => (
            <button key={filter} type="button" className={`isl-tab h-7 px-2.5 text-[11px] ${mediaFilter === filter ? 'isl-tab--active' : ''}`} onClick={() => setMediaFilter(filter)}>
              {filter === 'all' ? (isChinese ? '全部' : 'All') : filter === 'image' ? (isChinese ? '图片' : 'Images') : (isChinese ? '视频' : 'Videos')}
            </button>
          ))}
        </div>
        {mode === 'assets' && (
          <div className="mt-1 flex flex-wrap items-center gap-1" role="group" aria-label={isChinese ? '素材分类' : 'Asset Category'}>
            {(Object.keys(categoryLabels) as CategoryFilter[]).map(key => (
              <button key={key} type="button" className={`isl-tab h-7 px-2 text-[10px] ${category === key ? 'isl-tab--active' : ''}`} onClick={() => setCategory(key)}>
                {isChinese ? categoryLabels[key] : key === 'all' ? 'All' : key[0].toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {filtered.length === 0 ? (
          <div className="grid min-h-44 place-content-center text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>
            {query || mediaFilter !== 'all' || category !== 'all' ? (isChinese ? '没有匹配的素材' : 'No Matching Media') : (isChinese ? '这里还没有内容' : 'No Media Yet')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map(item => (
              <article
                key={item.id}
                data-testid={`studio-media-${item.id}`}
                draggable
                onDragStart={event => startDrag(event, item)}
                className="group min-w-0 cursor-grab overflow-hidden rounded-xl border active:cursor-grabbing"
                style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
              >
                <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--isl-surface-2)' }}>
                  {item.type === 'image'
                    ? <img src={item.href} alt={item.name} width={item.width || 320} height={item.height || 240} loading="lazy" className="h-full w-full object-cover" />
                    : <video src={item.href} aria-label={item.name} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
                  <button type="button" className="isl-icon-btn absolute bottom-2 right-2 h-8 w-8 bg-[var(--isl-card)]" aria-label={`${isChinese ? '添加' : 'Add'} ${item.name}`} title={isChinese ? '添加到当前 Workflow' : 'Add to Workflow'} onClick={() => onInsert(item)}>
                    <Plus size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className="p-2">
                  {editingId === item.id ? (
                    <input
                      autoFocus
                      aria-label={isChinese ? '素材名称' : 'Media Name'}
                      value={editingName}
                      onChange={event => setEditingName(event.target.value)}
                      onBlur={() => saveName(item)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') saveName(item);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      className="isl-well w-full px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--isl-mint)]"
                    />
                  ) : (
                    <button type="button" className="block w-full truncate text-left text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[var(--isl-mint)]" style={{ color: 'var(--isl-ink)' }} title={onRename ? (isChinese ? '重命名' : 'Rename') : (isChinese ? '添加到当前 Workflow' : 'Add to Workflow')} onClick={() => { if (onRename) { setEditingId(item.id); setEditingName(item.name); } else onInsert(item); }}>
                      {item.name}
                    </button>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                    <span className="truncate">{item.width && item.height ? `${item.width}×${item.height}` : item.type === 'image' ? (isChinese ? '图片' : 'Image') : (isChinese ? '视频' : 'Video')}</span>
                    {item.createdAt ? <time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat(isChinese ? 'zh-CN' : 'en', { month: 'numeric', day: 'numeric' }).format(item.createdAt)}</time> : null}
                  </div>
                  <div className="mt-2 flex items-center justify-end gap-1">
                    {item.type === 'image' && onReversePrompt && <button type="button" className="isl-icon-btn h-7 w-7" aria-label={`${isChinese ? '反推 Prompt' : 'Analyze Prompt'} ${item.name}`} onClick={() => void reversePrompt(item)}><Sparkles size={13} aria-hidden="true" /></button>}
                    <a className="isl-icon-btn flex h-7 w-7 items-center justify-center" href={item.href} download={item.name} aria-label={`${isChinese ? '下载' : 'Download'} ${item.name}`}><Download size={13} aria-hidden="true" /></a>
                    {onRemove && <button type="button" className="isl-icon-btn h-7 w-7" aria-label={`${isChinese ? '删除' : 'Delete'} ${item.name}`} onClick={() => { if (window.confirm(isChinese ? `删除素材“${item.name}”？` : `Delete “${item.name}”?`)) onRemove(item); }}><Trash2 size={13} aria-hidden="true" /></button>}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{notice}</p>
    </section>
  );
}
