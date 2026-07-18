import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Download, Folder, FolderInput, LayoutGrid, MoreHorizontal, Pencil, Plus, SlidersHorizontal, Sparkles, Tag, Trash2, X } from 'lucide-react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkflowMediaUrl } from '../workflow/media';
import { DeleteFolderDialog, type DeleteFolderMode } from './DeleteFolderDialog';
import { BatchManageModal } from './BatchManageModal';
import {
  AssetCardPreview,
  assetToStudio,
  AssetSearchBar,
  folderAncestors,
  FolderBreadcrumb,
  MediaTabs,
  type MediaFilter,
} from './assetLibraryShared';
import { STUDIO_MEDIA_DRAG_TYPE } from './StudioMediaBrowser';
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
  compact?: boolean;
}

interface CardMenuState {
  itemId: string;
  x: number;
  y: number;
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

  const handleDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    const payload = JSON.stringify(assetToStudio(item));
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(STUDIO_MEDIA_DRAG_TYPE, payload);
    event.dataTransfer.setData('text/plain', payload);
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
      onDragStartCapture={handleDragStart}
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

function SubFolderRow({ folder, isChinese, count, onOpen, onDelete }: {
  folder: AssetFolder;
  isChinese: boolean;
  count: number;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.button
      type="button"
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      whileHover={{ x: 2 }}
      onClick={onOpen}
      className="group flex w-full items-center gap-2.5 rounded-lg border-[1.5px] px-3 py-2.5 text-left transition"
      style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
      data-testid={`folder-row-${folder.id}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--isl-surface-2)' }}>
        <Folder size={16} style={{ color: 'var(--isl-ink-soft)' }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{folder.name}</span>
        <span className="mt-0.5 block text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
          {count} {isChinese ? '个素材' : 'items'}
        </span>
      </span>
      <ChevronRight size={14} className="shrink-0" style={{ color: 'var(--isl-ink-ghost)' }} />
      <span
        role="button"
        tabIndex={-1}
        className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition group-hover:opacity-100 hover:bg-[var(--isl-surface-2)]"
        onClick={event => { event.stopPropagation(); onDelete(); }}
        aria-label={isChinese ? '删除文件夹' : 'Delete folder'}
      >
        <Trash2 size={12} style={{ color: 'var(--isl-coral-deep)' }} />
      </span>
    </motion.button>
  );
}

function buildOrderedDescendants(folders: AssetFolder[], rootId: string): AssetFolder[] {
  const childMap = new Map<string | null, AssetFolder[]>();
  for (const f of folders) {
    const list = childMap.get(f.parentId) || [];
    list.push(f);
    childMap.set(f.parentId, list);
  }
  const out: AssetFolder[] = [];
  const queue: string[] = [rootId];
  const seen = new Set<string>([rootId]);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of childMap.get(id) || []) {
      if (!seen.has(child.id)) {
        out.push(child);
        seen.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return out;
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
  compact = false,
}: AssetLibraryBrowserProps) {
  const isChinese = language === 'zho';
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [batchOpen, setBatchOpen] = useState(false);
  const [folderDelete, setFolderDelete] = useState<AssetFolder | null>(null);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [scope, setScope] = useState<'personal' | 'agent'>('personal');
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  // 文件夹直接素材计数（不统计子文件夹）
  const directItemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of library.items) {
      for (const fid of item.folderIds) counts.set(fid, (counts.get(fid) || 0) + 1);
    }
    return counts;
  }, [library.items]);

  // 当前层级的子文件夹（parentId === selectedFolderId）
  const subFolders = useMemo(() => {
    return library.folders
      .filter(f => f.parentId === selectedFolderId)
      .sort((a, b) => a.name.localeCompare(b.name, isChinese ? 'zh-CN' : 'en'));
  }, [library.folders, selectedFolderId, isChinese]);

  // 包含子文件夹后，某文件夹下的全部素材（用于族下拉/搜索结果时标注原始文件夹）
  const folderNameById = useMemo(() => new Map(library.folders.map(f => [f.id, f.name])), [library.folders]);
  const descendantFolderIds = useMemo(() => {
    if (selectedFolderId === null) return null; // 根级别不展开
    const set = new Set<string>([selectedFolderId]);
    for (const child of buildOrderedDescendants(library.folders, selectedFolderId)) set.add(child.id);
    return set;
  }, [library.folders, selectedFolderId]);

  // 进入文件夹后，包含子文件夹下所有素材
  const itemsInView = useMemo(() => {
    if (selectedFolderId === null) {
      // 根级别：未分类素材
      return library.items.filter(item => item.folderIds.length === 0);
    }
    if (!descendantFolderIds) return [];
    return library.items.filter(item => item.folderIds.some(fid => descendantFolderIds.has(fid)));
  }, [library.items, selectedFolderId, descendantFolderIds]);

  // 搜索：跨整个素材库，结果标注所属文件夹
  const searchResults = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return null;
    return library.items.filter(item => {
      if (mediaFilter !== 'all') {
        const isVideo = item.mimeType.startsWith('video');
        if (mediaFilter === 'image' && isVideo) return false;
        if (mediaFilter === 'video' && !isVideo) return false;
      }
      return `${item.name || ''} ${item.prompt || ''} ${item.tags.join(' ')}`.toLocaleLowerCase().includes(keyword);
    }).slice(0, 80);
  }, [library.items, query, mediaFilter]);

  // 日常未搜索时的过滤（针对 itemsInView 应用媒体类型）
  const filtered = useMemo(() => {
    if (searchResults) return searchResults;
    return itemsInView.filter(item => {
      if (mediaFilter === 'all') return true;
      const isVideo = item.mimeType.startsWith('video');
      if (mediaFilter === 'image' && isVideo) return false;
      if (mediaFilter === 'video' && !isVideo) return false;
      return true;
    });
  }, [searchResults, itemsInView, mediaFilter]);

  const totalCount = searchResults ? searchResults.length : itemsInView.length;

  const openMenu = (x: number, y: number, itemId: string) => setMenu({ x, y, itemId });

  const handleMenuAction = (action: string) => {
    if (!menu) return;
    const item = library.items.find(i => i.id === menu.itemId);
    if (!item) { setMenu(null); return; }
    if (action === 'rename') {
      const next = window.prompt(isChinese ? '重命名素材' : 'Rename asset', item.name || '');
      if (next && next.trim()) onRenameAsset(item.id, next.trim());
    } else if (action === 'delete') {
      if (window.confirm(isChinese ? `删除素材「${item.name || ''}」？` : `Delete "${item.name || ''}"?`)) onRemoveAsset(item.id);
    } else if (action === 'removeFromFolder' && selectedFolderId && onRemoveAssetFromFolder) {
      onRemoveAssetFromFolder(item.id, selectedFolderId);
    }
    setMenu(null);
  };

  const canBatch = library.items.length > 0 && (onBatchRemoveAssets || onBatchAddAssetsToFolder || onBatchAddAssetTags);
  const compactTags = useMemo(() => Array.from(new Set(['其它', '人物', '场景', '物品', '风格', '音效', ...library.items.flatMap(item => item.tags)])).slice(0, 18), [library.items]);
  const compactAssets = useMemo(() => filtered.filter(item => selectedTags.length === 0 || selectedTags.some(tag => tag === '其它' ? item.tags.length === 0 : item.tags.includes(tag))), [filtered, selectedTags]);

  const isSearching = searchResults !== null;
  const currentAncestors = folderAncestors(library.folders, selectedFolderId);
  const currentTitle = selectedFolderId === null
    ? (isChinese ? '全部素材' : 'All Assets')
    : (library.folders.find(f => f.id === selectedFolderId)?.name ?? (isChinese ? '素材' : 'Assets'));
  const folderDeleteItemCount = folderDelete ? library.items.filter(item => item.folderIds.includes(folderDelete.id)).length : 0;
  const folderDeleteSubfolderCount = folderDelete ? library.folders.filter(folder => folder.parentId === folderDelete.id).length : 0;
  const handleCreateSubFolder = () => {
    const name = window.prompt(isChinese ? '新建子文件夹' : 'New subfolder', '');
    if (name && name.trim()) onCreateFolder(selectedFolderId, name.trim());
  };

  if (compact) return (
    <div className="relative flex h-full min-h-0 flex-col" data-testid="asset-library-browser" data-compact="true">
      <div className="shrink-0 px-2 pb-2 pt-2">
        <div className="mb-3 grid grid-cols-2 rounded-xl border p-0.5" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-sunk)' }}>
          <button type="button" onClick={() => setScope('personal')} className={`h-9 rounded-[10px] text-sm font-bold transition ${scope === 'personal' ? 'bg-[var(--isl-surface-2)] text-[var(--isl-ink)]' : 'text-[var(--isl-ink-soft)] hover:text-[var(--isl-ink)]'}`}>{isChinese ? '个人' : 'Personal'}</button>
          <button type="button" onClick={() => setScope('agent')} className={`h-9 rounded-[10px] text-sm font-bold transition ${scope === 'agent' ? 'bg-[var(--isl-surface-2)] text-[var(--isl-ink)]' : 'text-[var(--isl-ink-soft)] hover:text-[var(--isl-ink)]'}`}>Agent</button>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1"><AssetSearchBar query={query} setQuery={setQuery} isChinese={isChinese} label={isChinese ? '请输入搜索内容' : 'Search'} /></div>
          <button type="button" onClick={() => { setDraftTags(selectedTags); setTagMenuOpen(open => !open); }} className={`isl-icon-btn h-9 w-9 shrink-0 ${selectedTags.length ? 'isl-chip--active' : ''}`} aria-label={isChinese ? '按标签筛选' : 'Filter by tags'} title={isChinese ? '标签筛选' : 'Tag filter'}><SlidersHorizontal size={15} /></button>
        </div>
      </div>

      {tagMenuOpen && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="absolute left-2 right-2 top-[104px] z-30 rounded-2xl border p-4 shadow-2xl backdrop-blur-xl" style={{ borderColor: 'var(--isl-border)', background: 'color-mix(in srgb,var(--isl-card) 94%,transparent)' }} data-testid="asset-tag-filter">
          <div className="mb-3 text-xs font-bold" style={{ color: 'var(--isl-ink-soft)' }}>{isChinese ? '标签' : 'Tags'}</div>
          <div className="flex flex-wrap gap-2">{compactTags.map(tag => <button key={tag} type="button" onClick={() => setDraftTags(tags => tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag])} className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${draftTags.includes(tag) ? 'border-[var(--isl-mint)] bg-[var(--isl-mint-bg)] text-[var(--isl-mint-deep)]' : 'border-[var(--isl-border)] text-[var(--isl-ink-soft)] hover:text-[var(--isl-ink)]'}`}>{tag}</button>)}</div>
          <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setDraftTags([]); setSelectedTags([]); }} className="px-3 py-2 text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{isChinese ? '清空' : 'Clear'}</button><button type="button" onClick={() => { setSelectedTags(draftTags); setTagMenuOpen(false); }} className="isl-go px-4 py-2 text-xs">{isChinese ? '应用' : 'Apply'}</button></div>
        </motion.div>
      )}

      {scope === 'agent' ? (
        <div className="grid min-h-0 flex-1 place-content-center whitespace-pre-line px-6 text-center text-xs leading-5" style={{ color: 'var(--isl-ink-ghost)' }}>{isChinese ? 'Agent 资产库尚未接入\n当前个人资产与 PromptBar 已保持同步' : 'Agent assets are not connected yet'}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 isl-scrollbar">
          {(selectedFolderId !== null || query) && <div className="mb-2 px-1"><FolderBreadcrumb folders={library.folders} selectedFolderId={query ? null : selectedFolderId} onSelect={id => { setQuery(''); setSelectedFolderId(id); }} isChinese={isChinese} /></div>}
          {!query && subFolders.map(folder => (
            <button key={folder.id} type="button" onClick={() => setSelectedFolderId(folder.id)} className="group mb-1 flex w-full items-center gap-2 rounded-xl px-1.5 py-2 text-left transition hover:bg-[var(--isl-surface-2)]" data-testid={`folder-row-${folder.id}`}>
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}><Folder size={20} /></span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>{folder.name}</span>
              <span role="button" tabIndex={-1} onClick={event => { event.stopPropagation(); setFolderDelete(folder); }} className="grid h-7 w-7 place-items-center rounded-lg opacity-0 transition group-hover:opacity-100 hover:bg-[var(--isl-surface-sunk)]" aria-label={isChinese ? '删除文件夹' : 'Delete folder'}><MoreHorizontal size={15} /></span>
            </button>
          ))}
          {compactAssets.map(item => (
            <div key={item.id} className="group mb-1 flex items-center gap-2 rounded-xl px-1.5 py-1.5 transition hover:bg-[var(--isl-surface-2)]">
              <button type="button" onClick={() => onInsert?.(item)} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={`${isChinese ? '添加' : 'Add'} ${item.name || ''}`}>
                <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[var(--isl-surface-sunk)]"><AssetCardPreview item={item} /></span>
                <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>{item.name || (isChinese ? '未命名素材' : 'Untitled')}</span>
              </button>
              <button type="button" onClick={event => { event.stopPropagation(); openMenu(event.clientX, event.clientY, item.id); }} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg opacity-0 transition group-hover:opacity-100 hover:bg-[var(--isl-surface-sunk)]" aria-label={isChinese ? '更多操作' : 'More'}><MoreHorizontal size={15} /></button>
            </div>
          ))}
          {subFolders.length === 0 && compactAssets.length === 0 && <div className="grid min-h-44 place-content-center text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>{query || selectedTags.length ? (isChinese ? '没有匹配的资产' : 'No matching assets') : (isChinese ? '这里还没有资产' : 'No assets here')}</div>}
        </div>
      )}

      {menu && <><div className="fixed inset-0 z-40" onClick={() => setMenu(null)} /><motion.div ref={menuRef} initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="fixed z-50 min-w-36 rounded-xl border py-1 shadow-xl" style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-border)', left: Math.min(menu.x, window.innerWidth - 160), top: Math.min(menu.y, window.innerHeight - 160) }}><button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--isl-surface-2)]" onClick={() => handleMenuAction('rename')}><Pencil size={12} />{isChinese ? '重命名' : 'Rename'}</button>{selectedFolderId && <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--isl-surface-2)]" onClick={() => handleMenuAction('removeFromFolder')}><FolderInput size={12} />{isChinese ? '移出此文件夹' : 'Remove'}</button>}<button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[var(--isl-surface-2)]" style={{ color: 'var(--isl-coral-deep)' }} onClick={() => handleMenuAction('delete')}><Trash2 size={12} />{isChinese ? '删除' : 'Delete'}</button></motion.div></>}
      <DeleteFolderDialog open={Boolean(folderDelete)} folder={folderDelete} itemCount={folderDeleteItemCount} subfolderCount={folderDeleteSubfolderCount} onConfirm={mode => { if (folderDelete) onRemoveFolder(folderDelete.id, mode === 'delete-all'); setFolderDelete(null); }} onCancel={() => setFolderDelete(null)} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="asset-library-browser">
      {/* 顶部：面包屑 + 标题 + 计数 */}
      <div className="shrink-0 border-b px-3 pb-2.5 pt-2.5" style={{ borderColor: 'var(--isl-border)' }}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <FolderBreadcrumb
              folders={library.folders}
              selectedFolderId={isSearching ? null : selectedFolderId}
              onSelect={id => { setQuery(''); setSelectedFolderId(id); }}
              isChinese={isChinese}
            />
            <h2 className="mt-1 truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>
              {isSearching ? (isChinese ? '搜索结果' : 'Search Results') : currentTitle}
              {!isSearching && selectedFolderId !== null && (
                <button
                  type="button"
                  onClick={handleCreateSubFolder}
                  className="ml-2 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold transition hover:bg-[var(--isl-surface-2)]"
                  style={{ color: 'var(--isl-mint-deep)' }}
                  title={isChinese ? '新建子文件夹' : 'New subfolder'}
                >
                  <Plus size={10} /> {isChinese ? '子文件夹' : 'Subfolder'}
                </button>
              )}
            </h2>
          </div>
          <span className="shrink-0 text-[11px] tabular-nums" style={{ color: 'var(--isl-ink-soft)' }}>{totalCount}/{library.items.length}</span>
        </div>

        <AssetSearchBar query={query} setQuery={setQuery} isChinese={isChinese} />

        {!isSearching && selectedFolderId === null && (
          <div className="mt-2 flex items-center justify-between">
            <MediaTabs value={mediaFilter} onChange={setMediaFilter} isChinese={isChinese} />
            <button
              type="button"
              onClick={handleCreateSubFolder}
              className="flex items-center gap-0.5 rounded-lg border-[1.5px] px-2 py-1 text-[11px] font-bold transition hover:bg-[var(--isl-surface-2)]"
              style={{ background: 'var(--isl-mint-bg)', borderColor: 'var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
              aria-label={isChinese ? '新建根文件夹' : 'New root folder'}
            >
              <Plus size={11} /> {isChinese ? '文件夹' : 'Folder'}
            </button>
          </div>
        )}
        {(!isSearching && selectedFolderId !== null || isSearching) && (
          <div className="mt-2"><MediaTabs value={mediaFilter} onChange={setMediaFilter} isChinese={isChinese} /></div>
        )}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" data-testid="asset-library-grid">
        {/* 根级：文件夹列表 */}
        {!isSearching && subFolders.length > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>
              {selectedFolderId === null ? (isChinese ? '文件夹' : 'Folders') : (isChinese ? '子文件夹' : 'Subfolders')}
            </div>
            <motion.div layout className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <AnimatePresence>
                {subFolders.map(folder => (
                  <SubFolderRow
                    key={folder.id}
                    folder={folder}
                    isChinese={isChinese}
                    count={directItemCounts.get(folder.id) || 0}
                    onOpen={() => setSelectedFolderId(folder.id)}
                    onDelete={() => setFolderDelete(folder)}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
            {subFolders.length > 0 && filtered.length > 0 && (
              <div className="my-3 h-px" style={{ background: 'var(--isl-border)' }} />
            )}
          </div>
        )}

        {/* 素材网格 */}
        {filtered.length === 0 ? (
          <div className="grid min-h-44 place-content-center text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>
            {query || mediaFilter !== 'all' || isSearching
              ? (isChinese ? '没有匹配的素材' : 'No Matching Media')
              : selectedFolderId === null
                ? (isChinese ? '未分类素材为空，点击右上"文件夹"创建文件夹' : 'No uncategorized assets. Use "Folder" to create one.')
                : (isChinese ? '此文件夹还没有素材' : 'No assets in this folder')}
          </div>
        ) : (
          <motion.div layout className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            <AnimatePresence>
              {filtered.map(item => (
                <div key={item.id} className="flex flex-col gap-1">
                  <AssetCard
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
                  {isSearching && item.folderIds.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 px-0.5 text-[9px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                      {item.folderIds.slice(0, 2).map(fid => (
                        <span key={fid} className="inline-flex items-center gap-0.5 rounded px-1" style={{ background: 'var(--isl-surface-2)' }}>
                          <Folder size={8} /> {folderNameById.get(fid) || ''}
                        </span>
                      ))}
                      {item.folderIds.length > 2 && <span>+{item.folderIds.length - 2}</span>}
                    </div>
                  )}
                </div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* 底部展开批量管理 */}
      {canBatch && (
        <div className="shrink-0 border-t px-3 py-2" style={{ borderColor: 'var(--isl-border)' }}>
          <motion.button
            type="button"
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setBatchOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] px-2 py-1.5 text-[11px] font-bold transition"
            style={{ background: 'var(--isl-mint-bg)', borderColor: 'var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
            title={isChinese ? '批量管理全部素材' : 'Batch manage all assets'}
            aria-label={isChinese ? '展开批量管理' : 'Expand batch manage'}
          >
            <LayoutGrid size={12} />
            <span>{isChinese ? '展开批量管理' : 'Expand Batch Manage'}</span>
          </motion.button>
        </div>
      )}

      {/* 卡片更多菜单 */}
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
              {selectedFolderId && !isSearching && (
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

      {folderDelete && (
        <DeleteFolderDialog
          open
          folder={folderDelete}
          itemCount={folderDeleteItemCount}
          subfolderCount={folderDeleteSubfolderCount}
          onConfirm={mode => { onRemoveFolder(folderDelete.id, mode === 'delete-all'); setFolderDelete(null); }}
          onCancel={() => setFolderDelete(null)}
        />
      )}

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
