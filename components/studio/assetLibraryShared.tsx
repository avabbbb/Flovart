import { motion } from 'motion/react';
import { ChevronRight, Folder, Home, Search } from 'lucide-react';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { StudioMediaItem } from './StudioMediaBrowser';
import type { AssetFolder, AssetItem } from '../../types';

export function assetToStudio(item: AssetItem): StudioMediaItem {
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

export function AssetCardPreview({ item }: { item: Pick<AssetItem, 'dataUrl' | 'mimeType' | 'name'> }) {
  const media = useWorkflowMediaUrl(undefined, item.dataUrl);
  if (!media.url) {
    return <div className="grid h-full w-full place-content-center px-3 text-center text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{media.error || '读取中...'}</div>;
  }
  return item.mimeType.startsWith('video')
    ? <video src={media.url} aria-label={item.name || ''} muted playsInline preload="metadata" className="h-full w-full object-cover" />
    : <img src={media.url} alt={item.name || ''} loading="lazy" className="h-full w-full object-cover" />;
}

export function AssetSearchBar({ query, setQuery, isChinese, label }: {
  query: string;
  setQuery: (next: string) => void;
  isChinese: boolean;
  label?: string;
}) {
  const placeholder = label || (isChinese ? '搜索素材库' : 'Search Assets');
  return (
    <label
      className="flex h-9 items-center gap-2 rounded-lg border-[1.5px] px-2.5 focus-within:border-[var(--isl-mint)] focus-within:ring-4 focus-within:ring-[var(--isl-mint-bg)]"
      style={{ background: 'var(--isl-surface-sunk)', borderColor: 'var(--isl-border)' }}
    >
      <Search size={14} aria-hidden="true" style={{ color: 'var(--isl-ink-ghost)' }} />
      <input
        type="search"
        autoComplete="off"
        aria-label={placeholder}
        placeholder={`${placeholder}…`}
        value={query}
        onChange={event => setQuery(event.target.value)}
        className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        style={{ color: 'var(--isl-ink)' }}
      />
    </label>
  );
}

export type MediaFilter = 'all' | 'image' | 'video';

export function MediaTabs({ value, onChange, isChinese }: {
  value: MediaFilter;
  onChange: (next: MediaFilter) => void;
  isChinese: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={isChinese ? '媒体类型' : 'Media Type'}>
      {(['all', 'image', 'video'] as const).map(filter => (
        <motion.button
          key={filter}
          type="button"
          whileTap={{ scale: 0.94 }}
          className={`h-7 px-2.5 text-[11px] transition-colors ${value === filter ? 'isl-tab--active' : 'isl-tab'}`}
          onClick={() => onChange(filter)}
        >
          {filter === 'all' ? (isChinese ? '全部' : 'All') : filter === 'image' ? (isChinese ? '图片' : 'Images') : (isChinese ? '视频' : 'Videos')}
        </motion.button>
      ))}
    </div>
  );
}

/** 计算从根到当前文件夹的祖先链（含根节点 null），用于面包屑。 */
export function folderAncestors(folders: AssetFolder[], currentId: string | null): AssetFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const chain: AssetFolder[] = [];
  let cursor = currentId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    const node = byId.get(cursor);
    if (!node) break;
    chain.unshift(node);
    seen.add(cursor);
    cursor = node.parentId;
  }
  return chain;
}

export function FolderBreadcrumb({ folders, selectedFolderId, onSelect, isChinese }: {
  folders: AssetFolder[];
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
  isChinese: boolean;
}) {
  const ancestors = folderAncestors(folders, selectedFolderId);
  return (
    <nav className="flex min-w-0 items-center gap-0.5 text-xs" aria-label={isChinese ? '文件夹路径' : 'Folder Path'}>
      <button
        type="button"
        className="flex items-center gap-0.5 rounded px-1.5 py-1 font-bold transition hover:bg-[var(--isl-surface-2)]"
        style={{ color: selectedFolderId === null ? 'var(--isl-ink)' : 'var(--isl-ink-soft)' }}
        onClick={() => onSelect(null)}
        aria-current={selectedFolderId === null ? 'page' : undefined}
      >
        <Home size={12} />
        <span>{isChinese ? '全部' : 'All'}</span>
      </button>
      {ancestors.map((folder, index) => {
        const isLast = index === ancestors.length - 1;
        return (
          <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight size={12} style={{ color: 'var(--isl-ink-ghost)' }} />
            <button
              type="button"
              className="truncate rounded px-1.5 py-1 font-bold transition hover:bg-[var(--isl-surface-2)]"
              style={{ color: isLast ? 'var(--isl-ink)' : 'var(--isl-ink-soft)' }}
              onClick={() => onSelect(folder.id)}
              aria-current={isLast ? 'page' : undefined}
              title={folder.name}
            >
              <span className="inline-flex items-center gap-1">
                <Folder size={11} style={{ color: 'var(--isl-ink-ghost)' }} />
                {folder.name}
              </span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}