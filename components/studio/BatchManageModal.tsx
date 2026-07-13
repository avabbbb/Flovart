import { AnimatePresence, motion } from 'motion/react';
import { Trash2, FolderInput, Tag, X, Check, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { AssetItem, AssetLibrary, AssetFolder } from '../../types';

interface BatchManageModalProps {
  open: boolean;
  library: AssetLibrary;
  language: 'en' | 'zho';
  onClose: () => void;
  onRemoveAssets: (ids: string[]) => void;
  onAddToFolder: (ids: string[], folderId: string) => void;
  onAddTags: (ids: string[], tags: string[]) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
}

type MediaFilter = 'all' | 'image' | 'video';

function buildFolderTree(folders: AssetFolder[], parentId: string | null = null, depth = 0): Array<{ folder: AssetFolder; depth: number }> {
  const out: Array<{ folder: AssetFolder; depth: number }> = [];
  const children = folders.filter(f => f.parentId === parentId);
  for (const child of children) {
    out.push({ folder: child, depth });
    out.push(...buildFolderTree(folders, child.id, depth + 1));
  }
  return out;
}

export function BatchManageModal({ open, library, language, onClose, onRemoveAssets, onAddToFolder, onAddTags, onCreateFolder }: BatchManageModalProps) {
  const isChinese = language === 'zho';
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setSelected(new Set()); setQuery(''); setMediaFilter('all'); setMoveTarget(null); setTagDraft(''); }
  }, [open]);

  const flatFolders = useMemo(() => buildFolderTree(library.folders), [library.folders]);

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

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const selectAllVisible = () => setSelected(new Set(filtered.map(i => i.id)));
  const clearSelection = () => setSelected(new Set());

  const batchDelete = () => {
    const list = Array.from(selected);
    if (list.length === 0) return;
    if (!window.confirm(isChinese ? `删除选中的 ${list.length} 个素材？此操作不可恢复。` : `Delete ${list.length} selected assets? This cannot be undone.`)) return;
    setBusy('delete');
    onRemoveAssets(list);
    setSelected(new Set());
    setBusy(null);
  };

  const batchMove = () => {
    const list = Array.from(selected);
    if (list.length === 0 || !moveTarget) return;
    setBusy('move');
    onAddToFolder(list, moveTarget);
    setSelected(new Set());
    setMoveTarget(null);
    setBusy(null);
  };

  const batchAddTags = () => {
    const list = Array.from(selected);
    const tags = tagDraft.split(',').map(t => t.trim()).filter(Boolean);
    if (list.length === 0 || tags.length === 0) return;
    setBusy('tag');
    onAddTags(list, tags);
    setTagDraft('');
    setBusy(null);
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="92vw"
      style={{ top: 24 }}
      styles={{ body: { padding: 0, height: '85vh', background: 'var(--isl-surface)' }, content: { background: 'var(--isl-surface)' } }}
      title={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold" style={{ color: 'var(--isl-ink)' }}>{isChinese ? '批量管理素材' : 'Batch Manage Assets'}</span>
          <span className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{library.items.length} {isChinese ? '个' : 'items'}</span>
        </div>
      }
      destroyOnClose
    >
      <div className="flex h-full min-h-0">
        {/* left: folders */}
        <aside className="flex w-44 shrink-0 flex-col overflow-y-auto border-r px-2 py-3 isl-scrollbar" style={{ borderColor: 'var(--isl-border)' }}>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors"
            style={{
              background: selectedFolderId === null ? 'var(--isl-mint-bg)' : 'transparent',
              color: selectedFolderId === null ? 'var(--isl-mint-deep)' : 'var(--isl-ink)',
            }}
            onClick={() => setSelectedFolderId(null)}
          >
            <span className="flex-1 truncate text-left font-medium">{isChinese ? '全部素材' : 'All Assets'}</span>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }}>{library.items.length}</span>
          </button>
          {flatFolders.map(({ folder, depth }) => (
            <button
              key={folder.id}
              type="button"
              className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors"
              style={{
                paddingLeft: depth * 14 + 8,
                background: selectedFolderId === folder.id ? 'var(--isl-mint-bg)' : 'transparent',
                color: selectedFolderId === folder.id ? 'var(--isl-mint-deep)' : 'var(--isl-ink)',
              }}
              onClick={() => setSelectedFolderId(folder.id)}
            >
              <span className="flex-1 truncate text-left font-medium">{folder.name}</span>
              <span className="text-[10px] tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }}>{library.items.filter(i => i.folderIds.includes(folder.id)).length}</span>
            </button>
          ))}
        </aside>

        {/* right: cards + toolbar */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* toolbar */}
          <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: 'var(--isl-border)' }}>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border-[1.5px] px-2.5" style={{ background: 'var(--isl-surface-sunk)', borderColor: 'var(--isl-border)' }}>
                <Search size={13} style={{ color: 'var(--isl-ink-ghost)' }} />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={isChinese ? '搜索当前列表…' : 'Search current list…'}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  style={{ color: 'var(--isl-ink)' }}
                />
              </label>
              <div className="flex items-center gap-1" role="group">
                {(['all', 'image', 'video'] as const).map(filter => (
                  <button
                    key={filter}
                    type="button"
                    className={`h-8 px-2.5 text-[11px] transition-colors ${mediaFilter === filter ? 'isl-tab--active' : 'isl-tab'}`}
                    onClick={() => setMediaFilter(filter)}
                  >
                    {filter === 'all' ? (isChinese ? '全部' : 'All') : filter === 'image' ? (isChinese ? '图' : 'Img') : (isChinese ? '视' : 'Vid')}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" className="h-7 rounded-md px-2 text-[11px] font-bold" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink)' }} onClick={selected.size === filtered.length ? clearSelection : selectAllVisible}>
                {selected.size === filtered.length && filtered.length > 0
                  ? (isChinese ? '取消全选' : 'Deselect all')
                  : (isChinese ? `全选当前 ${filtered.length}` : `Select ${filtered.length}`)}
              </button>
              <span className="rounded-md px-2 py-0.5 text-[11px] tabular-nums" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>
                {isChinese ? `已选 ${selected.size}` : `${selected.size} selected`}
              </span>

              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {/* batch move */}
                <div className="flex items-center gap-1">
                  <select
                    className="h-7 max-w-40 rounded-md border-[1.5px] px-1.5 text-[11px] outline-none"
                    style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-border)', color: 'var(--isl-ink)' }}
                    value={moveTarget ?? ''}
                    onChange={e => setMoveTarget(e.target.value || null)}
                    aria-label={isChinese ? '目标文件夹' : 'Target folder'}
                  >
                    <option value="">{isChinese ? '选择目标文件夹…' : 'Target folder…'}</option>
                    {flatFolders.map(({ folder, depth }) => (
                      <option key={folder.id} value={folder.id}>{'　'.repeat(depth)}{folder.name}</option>
                    ))}
                  </select>
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    disabled={!selected.size || !moveTarget || busy === 'move'}
                    onClick={batchMove}
                    className="flex h-7 items-center gap-1 rounded-md border-[1.5px] px-2 text-[11px] font-bold disabled:opacity-40"
                    style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
                  >
                    <FolderInput size={11} />
                    <span>{isChinese ? '加入文件夹' : 'Add to folder'}</span>
                  </motion.button>
                </div>

                {/* batch add tags */}
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={tagDraft}
                    onChange={e => setTagDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') batchAddTags(); }}
                    placeholder={isChinese ? '逗号分隔标签' : 'comma tags'}
                    className="h-7 w-28 rounded-md border-[1.5px] px-1.5 text-[11px] outline-none"
                    style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-border)', color: 'var(--isl-ink)' }}
                  />
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.94 }}
                    disabled={!selected.size || !tagDraft.trim() || busy === 'tag'}
                    onClick={batchAddTags}
                    className="flex h-7 items-center gap-1 rounded-md border-[1.5px] px-2 text-[11px] font-bold disabled:opacity-40"
                    style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-mint)', color: 'var(--isl-mint-deep)' }}
                  >
                    <Tag size={11} />
                    <span>{isChinese ? '加标签' : 'Tag'}</span>
                  </motion.button>
                </div>

                <motion.button
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  disabled={!selected.size || busy === 'delete'}
                  onClick={batchDelete}
                  className="flex h-7 items-center gap-1 rounded-md border-[1.5px] px-2 text-[11px] font-bold disabled:opacity-40"
                  style={{ background: 'var(--isl-coral-bg, rgba(255,90,90,0.08))', borderColor: 'var(--isl-coral, #ff5a5a)', color: 'var(--isl-coral-deep)' }}
                >
                  <Trash2 size={11} />
                  <span>{isChinese ? `删除 ${selected.size}` : `Delete ${selected.size}`}</span>
                </motion.button>
              </div>
            </div>
          </div>

          {/* grid */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3 isl-scrollbar" data-testid="batch-asset-grid">
            {filtered.length === 0 ? (
              <div className="grid min-h-44 place-content-center text-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>
                {query || mediaFilter !== 'all' ? (isChinese ? '没有匹配的素材' : 'No Matching Media') : (isChinese ? '这里还没有内容' : 'No Media Yet')}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                <AnimatePresence>
                  {filtered.map(item => {
                    const isSel = selected.has(item.id);
                    return <BatchCard key={item.id} item={item} selected={isSel} onToggle={() => toggleSelect(item.id)} isChinese={isChinese} />;
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BatchCard({ item, selected, onToggle, isChinese }: { item: AssetItem; selected: boolean; onToggle: () => void; isChinese: boolean }) {
  const media = useWorkflowMediaUrl(undefined, item.dataUrl);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      whileHover={{ y: -2 }}
      onClick={onToggle}
      className="group relative cursor-pointer overflow-hidden rounded-xl border-[1.5px]"
      style={{
        borderColor: selected ? 'var(--isl-mint)' : 'var(--isl-border)',
        background: 'var(--isl-card)',
        boxShadow: selected ? '0 0 0 4px var(--isl-mint-bg)' : 'none',
      }}
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ background: 'var(--isl-surface-2)' }}>
        {media.url
          ? item.mimeType.startsWith('video')
            ? <video src={media.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            : <img src={media.url} alt={item.name || ''} loading="lazy" className="h-full w-full object-cover" />
          : <div className="grid h-full w-full place-content-center text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{isChinese ? '读取中' : 'Loading'}</div>}
        <div className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-md" style={{
          background: selected ? 'var(--isl-mint)' : 'rgba(0,0,0,0.5)',
          color: selected ? 'var(--isl-card)' : 'white',
          border: selected ? 'none' : '1.5px solid rgba(255,255,255,0.6)',
        }}>
          {selected ? <Check size={13} /> : <X size={13} className="opacity-0 transition group-hover:opacity-100" />}
        </div>
      </div>
      <div className="px-2 py-1.5">
        <p className="truncate text-xs font-semibold" style={{ color: 'var(--isl-ink)' }}>{item.name || (isChinese ? '未命名' : 'Untitled')}</p>
        <p className="mt-0.5 truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
          {item.width && item.height ? `${item.width}×${item.height}` : item.mimeType.startsWith('video') ? (isChinese ? '视频' : 'Video') : (isChinese ? '图片' : 'Image')}
        </p>
      </div>
    </motion.article>
  );
}