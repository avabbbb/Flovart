import { AnimatePresence, motion } from 'motion/react';
import { Folder, Image as ImageIcon, MonitorUp, Plus, Search, Video, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AssetLibrary } from '../../types';
import { useWorkflowMediaUrl } from '../workflow/media';
import { AssetCardPreview, FolderBreadcrumb, MediaTabs, type MediaFilter } from './assetLibraryShared';

export interface ReferencePickerWorkflowItem {
  id: string;
  label: string;
  elementType: 'image' | 'video' | 'audio';
  thumbnail?: string;
  storageKey?: string;
  description?: string;
}

interface AssetReferencePickerProps {
  open: boolean;
  language: 'en' | 'zho';
  workflowItems: ReferencePickerWorkflowItem[];
  connectedIds?: string[];
  library?: AssetLibrary;
  onClose: () => void;
  onSelectWorkflow?: (nodeId: string) => string | undefined;
  onSelectAsset?: (assetId: string) => string | undefined;
  onUploadFiles?: (files: File[]) => void | Promise<void>;
}

function WorkflowPreview({ item }: { item: ReferencePickerWorkflowItem }) {
  const media = useWorkflowMediaUrl(item.storageKey, item.thumbnail);
  if (!media.url) return <div className="grid h-full place-items-center text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>{item.elementType === 'video' ? <Video size={22} /> : <ImageIcon size={22} />}</div>;
  return item.elementType === 'video'
    ? <video src={media.url} aria-label={item.label} muted playsInline preload="metadata" className="h-full w-full object-cover" />
    : <img src={media.url} alt={item.label} loading="lazy" className="h-full w-full object-cover" />;
}

export function AssetReferencePicker({ open, language, workflowItems, connectedIds = [], library, onClose, onSelectWorkflow, onSelectAsset, onUploadFiles }: AssetReferencePickerProps) {
  const isChinese = language === 'zho';
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<'workflow' | 'assets'>('workflow');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const connected = useMemo(() => new Set(connectedIds), [connectedIds]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setFilter('all');
    setFolderId(null);
    setSelectedTags([]);
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const folders = library?.folders || [];
  const assetTags = useMemo(() => Array.from(new Set(['其它', '人物', '场景', '物品', '风格', '音效', ...(library?.items || []).flatMap(item => item.tags)])).slice(0, 18), [library?.items]);
  const childFolders = useMemo(() => folders.filter(folder => folder.parentId === folderId), [folderId, folders]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleWorkflow = useMemo(() => workflowItems.filter(item => {
    if (item.elementType === 'audio') return false;
    if (filter !== 'all' && item.elementType !== filter) return false;
    return !normalizedQuery || `${item.label} ${item.description || ''}`.toLocaleLowerCase().includes(normalizedQuery);
  }), [workflowItems, filter, normalizedQuery]);
  const visibleAssets = useMemo(() => (library?.items || []).filter(item => {
    const mediaType = item.mimeType.startsWith('video/') ? 'video' : 'image';
    if (filter !== 'all' && mediaType !== filter) return false;
    if (folderId && !item.folderIds.includes(folderId)) return false;
    if (selectedTags.length > 0 && !selectedTags.some(tag => tag === '其它' ? item.tags.length === 0 : item.tags.includes(tag))) return false;
    return !normalizedQuery || `${item.name || ''} ${item.tags.join(' ')} ${item.prompt || ''}`.toLocaleLowerCase().includes(normalizedQuery);
  }), [filter, folderId, library?.items, normalizedQuery, selectedTags]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[2147483646] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={isChinese ? '添加工作流参考' : 'Add workflow reference'}
            data-testid="asset-reference-picker"
            className="isl-panel flex h-[min(680px,88vh)] w-[min(980px,94vw)] min-h-0 overflow-hidden rounded-[24px] border"
            style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)' }}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            onMouseDown={event => event.stopPropagation()}
          >
            <aside className="flex w-48 shrink-0 flex-col border-r p-3" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-sunk)' }}>
              <div className="mb-3 px-2 text-sm font-extrabold" style={{ color: 'var(--isl-ink)' }}>{isChinese ? '添加参考' : 'Add reference'}</div>
              {([
                ['workflow', <ImageIcon size={15} />, isChinese ? '工作流节点' : 'Workflow nodes'],
                ['assets', <Folder size={15} />, isChinese ? '资产管理' : 'Asset library'],
              ] as const).map(([value, icon, label]) => (
                <button key={value} type="button" onClick={() => setSource(value)} className={`mb-1 flex h-10 items-center gap-2 rounded-xl px-3 text-left text-xs font-bold transition ${source === value ? 'isl-tab--active' : 'hover:bg-[var(--isl-surface-2)]'}`} style={{ color: source === value ? 'var(--isl-mint-deep)' : 'var(--isl-ink)' }}>{icon}{label}</button>
              ))}
              <div className="mt-auto rounded-xl border p-2 text-[10px] leading-4" style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink-soft)' }}>
                {isChinese ? '选择或上传后会成为工作流节点，并自动连接到当前节点。' : 'Selections become Workflow nodes and connect to the current node automatically.'}
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--isl-border)' }}>
                <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface-sunk)' }}>
                  <Search size={14} style={{ color: 'var(--isl-ink-ghost)' }} />
                  <input value={query} onChange={event => setQuery(event.target.value)} placeholder={isChinese ? '搜索工作流节点或资产…' : 'Search nodes or assets…'} className="min-w-0 flex-1 bg-transparent text-xs outline-none" style={{ color: 'var(--isl-ink)' }} />
                </label>
                <MediaTabs value={filter} onChange={setFilter} isChinese={isChinese} />
                {onUploadFiles && (
                  <>
                    <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={async event => {
                      const files = Array.from(event.target.files || []);
                      event.target.value = '';
                      if (!files.length) return;
                      setBusy(true);
                      try { await onUploadFiles(files); onClose(); } finally { setBusy(false); }
                    }} />
                    <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="isl-go flex h-9 shrink-0 items-center gap-1.5 px-3 text-xs"><MonitorUp size={14} />{busy ? (isChinese ? '上传中' : 'Uploading') : (isChinese ? '本地上传' : 'Upload')}</button>
                  </>
                )}
                <button type="button" onClick={onClose} className="isl-icon-btn h-9 w-9 shrink-0" aria-label={isChinese ? '关闭' : 'Close'}><X size={17} /></button>
              </header>

              {source === 'assets' && (
                <div className="border-b px-4 py-2" style={{ borderColor: 'var(--isl-border)' }}>
                  {folders.length > 0 && <FolderBreadcrumb folders={folders} selectedFolderId={folderId} onSelect={setFolderId} isChinese={isChinese} />}
                  <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5 isl-scrollbar">{assetTags.map(tag => <button key={tag} type="button" onClick={() => setSelectedTags(tags => tags.includes(tag) ? tags.filter(item => item !== tag) : [...tags, tag])} className={`shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-bold transition ${selectedTags.includes(tag) ? 'border-[var(--isl-mint)] bg-[var(--isl-mint-bg)] text-[var(--isl-mint-deep)]' : 'border-[var(--isl-border)] text-[var(--isl-ink-soft)]'}`}>{tag}</button>)}</div>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto p-4 isl-scrollbar">
                {source === 'assets' && childFolders.length > 0 && !normalizedQuery && (
                  <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {childFolders.map(folder => <button key={folder.id} type="button" onClick={() => setFolderId(folder.id)} className="flex h-12 items-center gap-2 rounded-xl border px-3 text-left text-xs font-bold hover:border-[var(--isl-mint)]" style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink)', background: 'var(--isl-surface)' }}><Folder size={16} style={{ color: 'var(--isl-mint-deep)' }} /><span className="truncate">{folder.name}</span></button>)}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {source === 'workflow' ? visibleWorkflow.map(item => {
                    const selected = connected.has(item.id);
                    return <motion.button key={item.id} type="button" whileTap={{ scale: 0.97 }} onClick={() => { const id = onSelectWorkflow?.(item.id); if (id) onClose(); }} className="group overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 hover:border-[var(--isl-mint)]" style={{ borderColor: selected ? 'var(--isl-mint)' : 'var(--isl-border)', background: 'var(--isl-surface)' }}>
                      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--isl-surface-sunk)]"><WorkflowPreview item={item} />{selected && <span className="absolute right-2 top-2 rounded-full px-2 py-1 text-[10px] font-bold backdrop-blur-md" style={{ color: 'var(--isl-mint-deep)', background: 'var(--isl-mint-bg)' }}>{isChinese ? '已连接' : 'Connected'}</span>}</div>
                      <div className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{item.label}</span><Plus size={13} style={{ color: 'var(--isl-mint-deep)' }} /></div>
                    </motion.button>;
                  }) : visibleAssets.map(item => (
                    <motion.button key={item.id} type="button" whileTap={{ scale: 0.97 }} onClick={() => { const id = onSelectAsset?.(item.id); if (id) onClose(); }} className="group overflow-hidden rounded-2xl border text-left transition hover:-translate-y-0.5 hover:border-[var(--isl-mint)]" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
                      <div className="aspect-[4/3] overflow-hidden bg-[var(--isl-surface-sunk)]"><AssetCardPreview item={item} /></div>
                      <div className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: 'var(--isl-ink)' }}>{item.name || (isChinese ? '未命名素材' : 'Untitled')}</span><Plus size={13} style={{ color: 'var(--isl-mint-deep)' }} /></div>
                    </motion.button>
                  ))}
                </div>

                {((source === 'workflow' && visibleWorkflow.length === 0) || (source === 'assets' && visibleAssets.length === 0 && childFolders.length === 0)) && (
                  <div className="grid h-52 place-items-center text-xs" style={{ color: 'var(--isl-ink-ghost)' }}>{source === 'assets' && !library ? (isChinese ? '资产库尚未接入' : 'Asset library unavailable') : (isChinese ? '没有匹配的内容' : 'No matching items')}</div>
                )}
              </div>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
