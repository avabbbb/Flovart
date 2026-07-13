import { AnimatePresence, motion } from 'motion/react';
import { Download, Plus, Search, Sparkles, Tag, FolderInput, Pencil, MoreHorizontal, LayoutGrid, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowMediaUrl } from '../workflow/media';
import { STUDIO_MEDIA_DRAG_TYPE, type StudioMediaItem } from './StudioMediaBrowser';
import { FolderTree } from './FolderTree';
import { DeleteFolderDialog, type DeleteFolderMode } from './DeleteFolderDialog';
import { BatchManageModal } from './BatchManageModal';
import type { AssetItem, AssetLibrary, AssetFolder } from '../../types';

interface AssetLibraryBrowserProps {
  library: AssetLibrary;
  language: 'en' | 'zho';
  onInsert?: (item: AssetItem) => void;
  onRenameAsset: (id: string, name: string) => void;
  onRemoveAsset: (id: string) => void;
  onUpdateAssetTags?: (id: string, tags: string[]) => void;
  onRemoveAssetFromFolder?: (itemId: string, folderId: string) => void;
  onBatchRemoveAssets?: (ids: string[]) => void;
  onBatchAddAssetsToFolder?: (ids: string[], folderId: string) => void;
  onBatchAddAssetTags?: (ids: string[], tags: string[]) => void;
  onReversePrompt?: (item: AssetItem) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRemoveFolder: (id: string, deleteItems: boolean) => void;
}

type MediaFilter = 'all' | 'image' | 'video';

interface CardMenuState {
  itemId: string;
  x: number;
  y: number;
}

function assetToStudio(item: AssetItem): StudioMediaItem {
  return {
    id: item.id,
    name: item.name || '',
    href: item.dataUrl,
    mimeType: item.mimeType,
    type: item.mimeType.startsWith('video') ? 'video' : 'image',
    folderIds: item.folderIds,
    tags: item.tags,
    width: item.width,
    height: item.height,
    createdAt: item.createdAt,
    prompt: item.prompt,
    source: 'asset',
  };
}

function AssetCardPreview({ item }: { item: AssetItem }) {
  const media = useWorkflowMediaUrl(undefined, item.dataUrl);
  if (!media.url) {
    return <div className="grid h-full w-full place-content-center px-3 text-center text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{media.error || '读取中...'}</div>;
  }
  return item.mimeType.startsWith('video')
    ? <video src={media.url} aria-label={item.name || ''} muted playsInline preload="metadata" className="h-full w-full object-cover" />
    : <img src={media.url} alt={item.name || ''} width={item.width || 320} height={item.height || 240} loading="lazy" className="h-full w-full object-cover" />;
}

function AssetCard({ item, isChinese, onInsert, onRename, onRemove, onTagsUpdate, onRemoveFromFolder, onReversePrompt, onOpenMenu }: {
  item: AssetItem;
  isChinese: boolean;
  onInsert?: (item: AssetItem) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onTagsUpdate?: (id: string, tags: string[]) => void;
  onRemoveFromFolder?: (itemId: string, folderId: string) => void;
  onReversePrompt?: (item: AssetItem) => void;
  onOpenMenu: (x: number, y: number, itemId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(item.name || '');
  const [editingTags, setEditingTags] = useState(false);
  const [draftTag, setDraftTag] = useState('');
  const media = useWorkflowMediaUrl(undefined, item.dataUrl);

  const saveName = () => {
    const next = draftName.trim();
    if (next && next !== (item.name || '')) onRename(item.id, next);
    setEditingName(false);
  };

  const addTag = () => {
    const t = draftTag.trim();
    if (!t || !onTagsUpdate) return;
    if (item.tags.includes(t)) { setDraftTag(''); return; }
    onTagsUpdate(item.id, [...item.tags, t]);
    setDraftTag('');
  };
  const removeTag = (tag: string) => {
    if (!onTagsUpdate) return;
    onTagsUpdate(item.id, item.tags.filter(x => x !== tag));
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      whileHover={{ y: -3 }}
      data-testid={`asset-card-${item.id}`}
      draggable
      onDragStart={event => {
        const payload = JSON.stringify(assetToStudio(item));
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, payload);
        event.dataTransfer.setData('text/plain', payload);
      }}
      className="group relative overflow-hidden rounded-xl border-[1.5px]"
      style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--isl-surface-2)' }}>
        <AssetCardPreview item={item} />
        {onInsert && (
          <button
            type="button"
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] opacity-0 transition group-hover:opacity-100"
            style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-border)' }}
            aria-label={`${isChinese ? '添加' : 'Add'} ${item.name || ''}`}
            title={isChinese ? '添加到当前 Workflow' : 'Add to Workflow'}
            onClick={() => onInsert(item)}
          >
            <Plus size={15} />
          </button>
        )}
        <button
          type="button"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] opacity-0 transition group-hover:opacity-100"
          style={{ background: 'rgba(0,0,0,0.45)', borderColor: 'transparent', color: 'white' }}
          aria-label={isChinese ? '更多操作' : 'More'}
          onClick={e => onOpenMenu(e.clientX, e.clientY, item.id)}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      <div className="p-2.5">
        {editingName ? (
          <input
            autoFocus
            aria-label={isChinese ? '素材名称' : 'Media Name'}
            value={draftName}
            onChange={event => setDraftName(event.target.value)}
            onBlur={saveName}
            onKeyDown={event => { if (event.key === 'Enter') saveName(); if (event.key === 'Escape') setEditingName(false); }}
            className="w-full rounded-md border-[1.5px] px-2 py-1 text-xs outline-none"
            style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-surface-2)', color: 'var(--isl-ink)' }}
          />
        ) : (
          <button
            type="button"
            className="block w-full truncate text-left text-xs font-semibold focus-visible:ring-2 focus-visible:ring-[var(--isl-mint)]"
            style={{ color: 'var(--isl-ink)' }}
            title={isChinese ? '点击重命名' : 'Click to rename'}
            onClick={() => { setEditingName(true); setDraftName(item.name || ''); }}
          >
            {item.name || (isChinese ? '未命名' : 'Untitled')}
          </button>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
          <span className="truncate">{item.width && item.height ? `${item.width}×${item.height}` : item.mimeType.startsWith('video') ? (isChinese ? '视频' : 'Video') : (isChinese ? '图片' : 'Image')}</span>
          {item.createdAt ? <time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat(isChinese ? 'zh-CN' : 'en', { month: 'numeric', day: 'numeric' }).format(item.createdAt)}</time> : null}
        </div>

        {/* tags inline */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {item.tags.map(tag => (
            <span key={tag} className="group/tag inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>
              #{tag}
              {onTagsUpdate && (
                <button type="button" className="opacity-0 transition group-hover/tag:opacity-100" onClick={() => removeTag(tag)} aria-label={isChinese ? '移除标签' : 'Remove tag'}>
                  <X size={9} />
                </button>
              )}
            </span>
          ))}
          {onTagsUpdate && (
            editingTags ? (
              <span className="inline-flex items-center gap-0.5">
                <input
                  autoFocus
                  value={draftTag}
                  onChange={e => setDraftTag(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { addTag(); setEditingTags(false); } if (e.key === 'Escape') { setEditingTags(false); setDraftTag(''); } }}
                  onBlur={() => { addTag(); setEditingTags(false); }}
                  placeholder={isChinese ? '标签名' : 'Tag'}
                  className="w-16 rounded border-[1.5px] px-1 py-0.5 text-[10px] outline-none"
                  style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-surface-2)', color: 'var(--isl-ink)' }}
                />
              </span>
            ) : (
              <button type="button" className="inline-flex items-center rounded px-1 py-0.5 text-[10px] hover:bg-[var(--isl-surface-2)]" style={{ color: 'var(--isl-ink-ghost)' }} onClick={() => setEditingTags(true)} aria-label={isChinese ? '加标签' : 'Add tag'}>
                <Tag size={9} className="mr-0.5" />
                {isChinese ? '加标签' : 'Add'}
              </button>
            )
          )}
        </div>
      </div>

      {onReversePrompt && !item.mimeType.startsWith('video') && (
        <button
          type="button"
          className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] opacity-0 transition group-hover:opacity-100"
          style={{ background: 'rgba(0,0,0,0.45)', borderColor: 'transparent', color: 'white' }}
          aria-label={isChinese ? '反推 Prompt' : 'Analyze Prompt'}
          title={isChinese ? '反推 Prompt' : 'Analyze Prompt'}
          onClick={() => onReversePrompt(item)}
        >
          <Sparkles size={14} />
        </button>
      )}
      <a
        className="absolute bottom-2 left-2 flex h-8 w-8 items-center justify-center rounded-lg border-[1.5px] opacity-0 transition group-hover:opacity-100"
        href={media.url || '#'}
        download={item.name || 'asset'}
        aria-disabled={!media.url}
        onClick={event => { if (!media.url) event.preventDefault(); }}
        aria-label={`${isChinese ? '下载' : 'Download'} ${item.name || ''}`}
        style={{ background: 'rgba(0,0,0,0.45)', borderColor: 'transparent', color: 'white' }}
      >
        <Download size={14} />
      </a>
    </motion.article>
  );
}

export function AssetLibraryBrowser({
  library,
  language,
  onInsert,
  onRenameAsset,
  onRemoveAsset,
  onUpdateAssetTags,
  onRemoveAssetFromFolder,
  onBatchRemoveAssets,
  onBatchAddAssetsToFolder,
  onBatchAddAssetTags,
  onReversePrompt,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
}: AssetLibraryBrowserProps) {
  const isChinese = language === 'zho';
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [batchOpen, setBatchOpen] = useState(false);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  const itemFolderIdLists = useMemo(() => library.items.map(i => i.folderIds), [library.items]);

  const itemsInFolder = useMemo(() => {
    if (selectedFolderId === null) return library.items;
    return library.items.filter(i => i.folderIds.includes(selectedFolderId));
  }, [library.items, selectedFolderId]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return itemsInFolder.filter(item => {
      if (mediaFilter !== 'all') {
        const isVideo = item.mimeType.startsWith('video');
        if (mediaFilter === 'image' && isVideo) return false;
        if (mediaFilter === 'video' && !isVideo) return false;
      }
      return !keyword || `${item.name || ''} ${item.prompt || ''} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(keyword);
    });
  }, [itemsInFolder, mediaFilter, query]);

  const currentTitle = selectedFolderId === null
    ? (isChinese ? '全部素材' : 'All Assets')
    : (library.folders.find(f => f.id === selectedFolderId)?.name ?? (isChinese ? '素材' : 'Assets'));
  const searchLabel = isChinese ? '搜索素材库' : 'Search Assets';

  const openMenu = (x: number, y: number, itemId: string) => setMenu({ x, y, itemId });

  const handleMenuAction = (action: string) => {
    if (!menu) return;
    const item = library.items.find(i => i.id === menu.itemId);
    if (!item) { setMenu(null); return; }
    if (action === 'rename') {
      // Trigger inline edit by re-opening card? Simpler: prompt fallback
      const next = window.prompt(isChinese ? '重命名素材' : 'Rename asset', item.name || '');
      if (next && next.trim()) onRenameAsset(item.id, next.trim());
    } else if (action === 'delete') {
      if (window.confirm(isChinese ? `删除素材「${item.name || ''}」？` : `Delete "${item.name || ''}"?`)) onRemoveAsset(item.id);
    } else if (action === 'removeFromFolder' && selectedFolderId && onRemoveAssetFromFolder) {
      onRemoveAssetFromFolder(item.id, selectedFolderId);
    }
    setMenu(null);
  };

  const canBatch = filtered.length > 0 && (onBatchRemoveAssets || onBatchAddAssetsToFolder || onBatchAddAssetTags);

  return (
    <div className="flex h-full min-h-0" data-testid="asset-library-browser">
      <aside className="flex w-36 shrink-0 flex-col border-r lg:w-44" style={{ borderColor: 'var(--isl-border)' }}>
        <FolderTree
          folders={library.folders}
          itemFolderIdLists={itemFolderIdLists}
          totalItemCount={library.items.length}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onAddFolder={(name, parentId) => onCreateFolder(parentId, name)}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={(id, mode) => onRemoveFolder(id, mode === 'delete-all')}
          language={language}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* header: title + batch + search + filter */}
        <div className="shrink-0 border-b px-3 pb-3 pt-2.5" style={{ borderColor: 'var(--isl-border)' }}>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{currentTitle}</h2>
              <p className="mt-0.5 text-[10px]" style={{ color: 'var(--isl-ink-soft)' }}>{isChinese ? '点击 + 添加到画布，卡片右上角更多操作' : 'Click + to add, top-right for more'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--isl-ink-soft)' }}>{filtered.length}/{itemsInFolder.length}</span>
              {canBatch && (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setBatchOpen(true)}
                  className="flex h-7 items-center gap-1 rounded-lg border-[1.5px] px-2 text-[11px] font-bold"
                  style={{ background: 'var(--isl-mint-bg)', borderColor: 'var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
                  title={isChinese ? '批量管理全部素材' : 'Batch manage all assets'}
                  aria-label={isChinese ? '批量管理' : 'Batch manage'}
                >
                  <LayoutGrid size={11} />
                  <span>{isChinese ? '批量管理' : 'Batch'}</span>
                </motion.button>
              )}
            </div>
          </div>
          <label className="flex h-9 items-center gap-2 rounded-lg border-[1.5px] px-2.5 focus-within:border-[var(--isl-mint)] focus-within:ring-4 focus-within:ring-[var(--isl-mint-bg)]" style={{ background: 'var(--isl-surface-sunk)', borderColor: 'var(--isl-border)' }}>
            <Search size={14} aria-hidden="true" style={{ color: 'var(--isl-ink-ghost)' }} />
            <input
              type="search"
              name="asset-library-search"
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
              <motion.button
                key={filter}
                type="button"
                whileTap={{ scale: 0.94 }}
                className={`h-7 px-2.5 text-[11px] transition-colors ${mediaFilter === filter ? 'isl-tab--active' : 'isl-tab'}`}
                onClick={() => setMediaFilter(filter)}
              >
                {filter === 'all' ? (isChinese ? '全部' : 'All') : filter === 'image' ? (isChinese ? '图片' : 'Images') : (isChinese ? '视频' : 'Videos')}
              </motion.button>
            ))}
          </div>
        </div>

        {/* responsive grid */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" data-testid="asset-library-grid">
          {filtered.length === 0 ? (
            <div className="grid min-h-44 place-content-center text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>
              {query || mediaFilter !== 'all' ? (isChinese ? '没有匹配的素材' : 'No Matching Media') : (isChinese ? '这里还没有内容' : 'No Media Yet')}
            </div>
          ) : (
            <motion.div
              layout
              className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
            >
              <AnimatePresence>
                {filtered.map(item => (
                  <AssetCard
                    key={item.id}
                    item={item}
                    isChinese={isChinese}
                    onInsert={onInsert}
                    onRename={onRenameAsset}
                    onRemove={onRemoveAsset}
                    onTagsUpdate={onUpdateAssetTags}
                    onRemoveFromFolder={onRemoveAssetFromFolder}
                    onReversePrompt={onReversePrompt}
                    onOpenMenu={openMenu}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>

      {/* per-card more menu */}
      <AnimatePresence>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.14 }}
              className="fixed z-50 min-w-36 rounded-lg border-[1.5px] py-1 shadow-lg"
              style={{
                background: 'var(--isl-card)',
                borderColor: 'var(--isl-border)',
                left: Math.min(menu.x, window.innerWidth - 160),
                top: Math.min(menu.y, window.innerHeight - 200),
              }}
            >
              <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--isl-surface-2)]" onClick={() => handleMenuAction('rename')}>
                <Pencil size={12} />
                <span>{isChinese ? '重命名' : 'Rename'}</span>
              </button>
              {selectedFolderId && (
                <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--isl-surface-2)]" onClick={() => handleMenuAction('removeFromFolder')} disabled={!onRemoveAssetFromFolder}>
                  <FolderInput size={12} />
                  <span>{isChinese ? '移出此文件夹' : 'Remove from folder'}</span>
                </button>
              )}
              <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--isl-surface-2)]" style={{ color: 'var(--isl-coral-deep)' }} onClick={() => handleMenuAction('delete')}>
                <Trash2 size={12} />
                <span>{isChinese ? '删除' : 'Delete'}</span>
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {canBatch && (
        <BatchManageModal
          open={batchOpen}
          library={library}
          language={language}
          onClose={() => setBatchOpen(false)}
          onRemoveAssets={onBatchRemoveAssets || (() => {})}
          onAddToFolder={onBatchAddAssetsToFolder || (() => {})}
          onAddTags={onBatchAddAssetTags || (() => {})}
          onCreateFolder={onCreateFolder}
        />
      )}
    </div>
  );
}