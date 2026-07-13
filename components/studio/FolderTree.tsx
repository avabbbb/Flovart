import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Folder, FolderPlus, Pencil, Trash2, FolderOpen, Home, MoreHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AssetFolder } from '../../types';
import { DeleteFolderDialog, type DeleteFolderMode } from './DeleteFolderDialog';

export interface FolderTreeProps {
  folders: AssetFolder[];
  itemFolderIdLists: string[][];
  totalItemCount: number;
  selectedFolderId: string | null;
  onSelectFolder: (id: string | null) => void;
  onAddFolder: (name: string, parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string, mode: DeleteFolderMode) => void;
  language?: 'en' | 'zho';
}

interface TreeNode {
  folder: AssetFolder;
  children: TreeNode[];
  itemCount: number;
  totalItemCount: number;
  subfolderCount: number;
}

function buildTree(folders: AssetFolder[], itemFolderIdLists: string[][]): TreeNode[] {
  const itemCounts = new Map<string, number>();
  for (const folderIds of itemFolderIdLists) {
    for (const fid of folderIds) {
      itemCounts.set(fid, (itemCounts.get(fid) || 0) + 1);
    }
  }
  const childMap = new Map<string | null, AssetFolder[]>();
  for (const f of folders) {
    const key = f.parentId;
    const list = childMap.get(key) || [];
    list.push(f);
    childMap.set(key, list);
  }
  const subtreeCount = (id: string): Set<string> => {
    const ids = new Set<string>([id]);
    const queue = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const child of childMap.get(current) || []) {
        if (!ids.has(child.id)) { ids.add(child.id); queue.push(child.id); }
      }
    }
    return ids;
  };
  const totalItemsIn = (id: string): number => {
    const subtreeIds = subtreeCount(id);
    let count = 0;
    for (const folderIds of itemFolderIdLists) {
      if (folderIds.some(fid => subtreeIds.has(fid))) count++;
    }
    return count;
  };
  const build = (parentId: string | null): TreeNode[] => {
    const childFolders = childMap.get(parentId) || [];
    return childFolders.map(folder => {
      const children = build(folder.id);
      const subfolderCount = children.reduce((sum, child) => sum + 1 + child.subfolderCount, 0);
      return {
        folder,
        children,
        itemCount: itemCounts.get(folder.id) || 0,
        totalItemCount: totalItemsIn(folder.id),
        subfolderCount,
      };
    });
  };
  return build(null);
}

function FolderRow({
  node,
  depth,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  language,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (node: TreeNode) => void;
  language: 'en' | 'zho';
}) {
  const isChinese = language === 'zho';
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.folder.id);
  const isSelected = selectedId === node.folder.id;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.folder.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const startEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(node.folder.name);
    setEditing(true);
    setMenuOpen(false);
  };
  const saveEdit = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== node.folder.name) onRename(node.folder.id, trimmed);
    setEditing(false);
  };

  const rowStyle: React.CSSProperties = {
    paddingLeft: depth * 14 + 6,
    background: isSelected ? 'var(--isl-mint-bg)' : 'transparent',
    color: isSelected ? 'var(--isl-mint-deep)' : 'var(--isl-ink)',
  };

  return (
    <div>
      <div
        className="group relative flex h-9 items-center gap-1 rounded-lg pr-1 text-xs transition-colors duration-150"
        style={rowStyle}
        onClick={() => onSelect(node.folder.id)}
      >
        <motion.button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
          onClick={e => { e.stopPropagation(); onToggle(node.folder.id); }}
          style={{ color: 'var(--isl-ink-soft)' }}
          animate={{ rotate: isExpanded ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          aria-hidden={!hasChildren}
          aria-label={isExpanded ? (isChinese ? '折叠' : 'Collapse') : (isChinese ? '展开' : 'Expand')}
        >
          {hasChildren ? <ChevronRight size={12} /> : <span className="block h-3 w-px" style={{ background: 'var(--isl-border-strong)' }} />}
        </motion.button>
        <span className="shrink-0" style={{ color: isSelected ? 'var(--isl-mint-deep)' : 'var(--isl-ink-soft)' }}>
          {isSelected ? <FolderOpen size={14} /> : <Folder size={14} />}
        </span>
        {editing ? (
          <input
            autoFocus
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onBlur={saveEdit}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }}
            className="min-w-0 flex-1 rounded-md border-[1.5px] px-1.5 py-0.5 text-xs outline-none"
            style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-card)', color: 'var(--isl-ink)' }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">{node.folder.name || (isChinese ? '未命名' : 'Untitled')}</span>
        )}
        <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums" style={{
          background: isSelected ? 'var(--isl-mint)' : 'var(--isl-surface-2)',
          color: isSelected ? 'var(--isl-card)' : 'var(--isl-ink-ghost)',
        }}>{node.totalItemCount}</span>
        {!editing && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded opacity-0 transition group-hover:opacity-100"
              onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
              title={isChinese ? '更多操作' : 'More'}
              style={{ color: 'var(--isl-ink-soft)' }}
            >
              <MoreHorizontal size={13} />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.96 }}
                  transition={{ duration: 0.14, ease: 'easeOut' }}
                  className="absolute right-0 top-6 z-30 min-w-32 rounded-lg border-[1.5px] py-1 shadow-lg"
                  style={{ background: 'var(--isl-card)', borderColor: 'var(--isl-border)' }}
                  onClick={e => e.stopPropagation()}
                >
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--isl-surface-2)]"
                    onClick={startEdit}
                  >
                    <Pencil size={12} />
                    <span>{isChinese ? '重命名' : 'Rename'}</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--isl-surface-2)]"
                    style={{ color: 'var(--isl-coral-deep)' }}
                    onClick={e => { e.stopPropagation(); setMenuOpen(false); onDelete(node); }}
                  >
                    <Trash2 size={12} />
                    <span>{isChinese ? '删除文件夹' : 'Delete Folder'}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
      <AnimatePresence initial={false}>
        {hasChildren && isExpanded && (
          <motion.div
            key="children"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="overflow-hidden"
          >
            {node.children.map(child => (
              <FolderRow
                key={child.folder.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                expandedIds={expandedIds}
                onToggle={onToggle}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                language={language}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FolderTree({ folders, itemFolderIdLists, totalItemCount, selectedFolderId, onSelectFolder, onAddFolder, onRenameFolder, onDeleteFolder, language = 'zho' }: FolderTreeProps) {
  const isChinese = language === 'zho';
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<TreeNode | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const tree = useMemo(() => buildTree(folders, itemFolderIdLists), [folders, itemFolderIdLists]);

  const toggle = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmAdd = () => {
    const trimmed = newName.trim();
    if (trimmed) onAddFolder(trimmed, selectedFolderId);
    setNewName('');
    setAdding(false);
  };

  const confirmDelete = (mode: DeleteFolderMode) => {
    if (deleteTarget) onDeleteFolder(deleteTarget.folder.id, mode);
    setDeleteTarget(null);
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between px-1.5 pb-1.5 pt-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--isl-ink-soft)' }}>{isChinese ? '文件夹' : 'Folders'}</span>
        <button
          type="button"
          className="flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-bold transition-colors hover:bg-[var(--isl-surface-2)]"
          onClick={() => setAdding(true)}
          style={{ color: 'var(--isl-mint-deep)' }}
          title={isChinese ? '新建文件夹' : 'New Folder'}
        >
          <FolderPlus size={12} />
          <span>{isChinese ? '新建' : 'New'}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 isl-scrollbar">
        <motion.div
          className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-xs"
          style={{
            background: selectedFolderId === null ? 'var(--isl-mint-bg)' : 'transparent',
            color: selectedFolderId === null ? 'var(--isl-mint-deep)' : 'var(--isl-ink)',
            cursor: 'pointer',
          }}
          whileHover={{ backgroundColor: 'var(--isl-surface-2)' }}
          onClick={() => onSelectFolder(null)}
        >
          <Home size={13} className="shrink-0" />
          <span className="flex-1 truncate font-medium">{isChinese ? '全部素材' : 'All Assets'}</span>
          <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums" style={{
            background: selectedFolderId === null ? 'var(--isl-mint)' : 'var(--isl-surface-2)',
            color: selectedFolderId === null ? 'var(--isl-card)' : 'var(--isl-ink-ghost)',
          }}>{totalItemCount}</span>
        </motion.div>

        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="overflow-hidden"
            >
              <div className="flex h-9 items-center gap-1.5 rounded-lg px-2" style={{ paddingLeft: 18 }}>
                <Folder size={13} className="shrink-0" style={{ color: 'var(--isl-ink-soft)' }} />
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onBlur={confirmAdd}
                  onKeyDown={e => { if (e.key === 'Enter') confirmAdd(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
                  placeholder={isChinese ? '文件夹名称' : 'Folder name'}
                  className="min-w-0 flex-1 rounded-md border-[1.5px] px-1.5 py-0.5 text-xs outline-none"
                  style={{ borderColor: 'var(--isl-mint)', background: 'var(--isl-card)', color: 'var(--isl-ink)' }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {tree.map(node => (
          <FolderRow
            key={node.folder.id}
            node={node}
            depth={1}
            selectedId={selectedFolderId}
            expandedIds={expandedIds}
            onToggle={toggle}
            onSelect={onSelectFolder}
            onRename={onRenameFolder}
            onDelete={setDeleteTarget}
            language={language}
          />
        ))}

        {tree.length === 0 && !adding && (
          <p className="px-2 py-3 text-center text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
            {isChinese ? '暂无文件夹，点击「新建」创建' : 'No folders yet. Click "New" to create one.'}
          </p>
        )}
      </div>

      <DeleteFolderDialog
        open={deleteTarget !== null}
        folder={deleteTarget?.folder || null}
        itemCount={deleteTarget?.itemCount || 0}
        subfolderCount={deleteTarget?.subfolderCount || 0}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}