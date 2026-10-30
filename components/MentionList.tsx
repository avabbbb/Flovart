/**
 * @ 引用菜单（LibTV 式两级菜单）
 * 左列：素材引用 → 图片 / 视频 / 音频 / 文本（当前节点已连线的上游节点），以及 资产（个人素材库，可按文件夹浏览）。
 * 右列：当前类别的条目。点名称直接插入一个引用；勾选多项后回车或点「插入 N 项」一次插入。
 * 输入 @ 后继续打字即搜索：切换为跨类别平铺结果（上游节点 + 素材，素材最多 50 条）。
 * 键盘：↑↓ 在当前列移动，→/回车 进入子菜单，← 返回，空格 勾选，回车 插入。
 */

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, ChevronLeft, ChevronRight, FileText, Folder, FolderOpen, Image as ImageIcon, Search, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AssetFolder } from '../types';
import { isFetchableMediaHref } from './workflow/media';

export interface MentionItem {
    id: string;
    label: string;
    thumbnail: string;
    elementType: string;
    description?: string;
    /** 除 label 外的可 @ 匹配名（如自定义标题），与运行时 mentionAliases 保持一致 */
    aliases?: string[];
    sourceType?: 'connected' | 'assetLibrary';
    assetId?: string;
    kind?: 'item' | 'folder' | 'back';
    folderId?: string;
}

/** 轻量素材索引：不含原图 dataUrl，thumbnail 字段供 UI 显示（可以是小图或空） */
export interface AssetSuggestion {
    id: string;
    name: string;
    folderIds: string[];
    tags: string[];
    thumbnail: string;
    elementType: 'image' | 'video';
}

/** Tiptap command 载荷：单个条目，或勾选后一次插入多个 */
export type MentionCommandPayload = MentionItem | { batch: MentionItem[] };

interface MentionListProps {
    /** 当前节点已连线的上游节点（图片/视频/音频/文本） */
    connectedItems: MentionItem[];
    /** 全部素材文件夹（扁平，含 parentId） */
    assetFolders: AssetFolder[];
    /** 全部素材索引（不含原图，thumbnail 可空） */
    assetItems: AssetSuggestion[];
    /** 当前 @ query（来自 Tiptap suggestion plugin） */
    query: string;
    command: (payload: MentionCommandPayload) => void;
}

export interface MentionListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

type CategoryId = 'image' | 'video' | 'audio' | 'text' | 'asset';

const CATEGORIES: Array<{ id: CategoryId; label: string; icon: LucideIcon }> = [
    { id: 'image', label: '图片', icon: ImageIcon },
    { id: 'video', label: '视频', icon: Video },
    { id: 'audio', label: '音频', icon: AudioLines },
    { id: 'text', label: '文本', icon: FileText },
    { id: 'asset', label: '资产', icon: FolderOpen },
];

const TYPE_ICONS: Record<string, LucideIcon> = { image: ImageIcon, video: Video, audio: AudioLines, text: FileText };

const rowKey = (row: MentionItem) => (row.sourceType || 'connected') + ':' + row.id;

const asConnected = (item: MentionItem): MentionItem => ({ ...item, kind: 'item', sourceType: item.sourceType || 'connected' });

const assetToItem = (asset: AssetSuggestion): MentionItem => ({
    id: asset.id,
    label: asset.name || '未命名素材',
    thumbnail: asset.thumbnail,
    elementType: asset.elementType,
    kind: 'item',
    sourceType: 'assetLibrary',
    assetId: asset.id,
});

const MentionList = forwardRef<MentionListHandle, MentionListProps>(
    ({ connectedItems, assetFolders, assetItems, query, command }, ref) => {
        const normalizedQuery = query.trim().toLowerCase();
        const searching = normalizedQuery.length > 0;
        const hasLibrary = assetFolders.length > 0 || assetItems.length > 0;

        const counts = useMemo(() => {
            const result: Record<CategoryId, number> = { image: 0, video: 0, audio: 0, text: 0, asset: assetItems.length };
            for (const item of connectedItems) {
                const key = item.elementType as CategoryId;
                if (key !== 'asset' && key in result) result[key] += 1;
            }
            return result;
        }, [connectedItems, assetItems.length]);
        const isEnabled = (id: CategoryId) => (id === 'asset' ? hasLibrary : counts[id] > 0);

        const [rootIndex, setRootIndex] = useState(() => Math.max(0, CATEGORIES.findIndex(category => isEnabled(category.id))));
        const [activeCategory, setActiveCategory] = useState<CategoryId | null>(() => {
            const first = CATEGORIES.find(category => isEnabled(category.id));
            return first ? first.id : null;
        });
        const [focus, setFocus] = useState<'root' | 'sub'>('root');
        const [subIndex, setSubIndex] = useState(0);
        const [folderId, setFolderId] = useState<string | null>(null);
        const [checked, setChecked] = useState<Map<string, MentionItem>>(() => new Map());
        const listRef = useRef<HTMLDivElement>(null);

        const subRows = useMemo<MentionItem[]>(() => {
            if (searching) {
                const matches = (text?: string) => !!text && text.toLowerCase().includes(normalizedQuery);
                const connected = connectedItems
                    .filter(item => matches(item.label) || item.aliases?.some(matches) || matches(item.description))
                    .map(asConnected);
                const assets = assetItems
                    .filter(asset => matches(asset.name) || asset.tags.some(matches))
                    .slice(0, 50)
                    .map(assetToItem);
                return [...connected, ...assets];
            }
            if (!activeCategory) return [];
            if (activeCategory !== 'asset') {
                return connectedItems.filter(item => item.elementType === activeCategory).map(asConnected);
            }
            const rows: MentionItem[] = [];
            if (folderId) {
                const parentId = assetFolders.find(folder => folder.id === folderId)?.parentId ?? undefined;
                rows.push({ id: '__back__:' + (parentId ?? 'root'), label: '返回上级', thumbnail: '', elementType: 'folder', kind: 'back', folderId: parentId });
            }
            for (const folder of assetFolders) {
                if ((folder.parentId ?? null) !== folderId) continue;
                rows.push({ id: 'folder:' + folder.id, label: folder.name, thumbnail: '', elementType: 'folder', kind: 'folder', folderId: folder.id });
            }
            const inFolder = folderId
                ? assetItems.filter(asset => asset.folderIds.includes(folderId))
                : assetItems.filter(asset => asset.folderIds.length === 0);
            return [...rows, ...inFolder.map(assetToItem)];
        }, [searching, normalizedQuery, connectedItems, assetItems, assetFolders, activeCategory, folderId]);

        useEffect(() => { setSubIndex(0); }, [activeCategory, folderId, normalizedQuery]);
        useEffect(() => { setFocus(searching ? 'sub' : 'root'); }, [searching]);
        useEffect(() => {
            listRef.current?.querySelector<HTMLElement>('[data-sub-index="' + subIndex + '"]')?.scrollIntoView?.({ block: 'nearest' });
        }, [subIndex]);

        const openCategory = (id: CategoryId) => {
            if (!isEnabled(id)) return;
            setActiveCategory(id);
            setFolderId(null);
        };

        const activateRow = (row: MentionItem) => {
            if (row.kind === 'folder' || row.kind === 'back') {
                setFolderId(row.folderId ?? null);
                return;
            }
            command(row);
        };

        const toggle = (row: MentionItem) => {
            if (row.kind !== 'item') return;
            setChecked(previous => {
                const next = new Map(previous);
                const key = rowKey(row);
                if (next.has(key)) next.delete(key);
                else next.set(key, row);
                return next;
            });
        };

        const insertChecked = () => command({ batch: [...checked.values()] });

        const enterRootCategory = () => {
            const id = CATEGORIES[rootIndex].id;
            if (!isEnabled(id)) return;
            openCategory(id);
            setFocus('sub');
        };

        const step = (delta: number) => {
            if (focus === 'sub') {
                if (subRows.length) setSubIndex(index => (index + delta + subRows.length) % subRows.length);
                return;
            }
            const total = CATEGORIES.length;
            for (let offset = 1; offset <= total; offset += 1) {
                const next = (((rootIndex + delta * offset) % total) + total) % total;
                if (!isEnabled(CATEGORIES[next].id)) continue;
                setRootIndex(next);
                openCategory(CATEGORIES[next].id);
                return;
            }
        };

        useImperativeHandle(ref, () => ({
            onKeyDown({ event }: { event: KeyboardEvent }) {
                const { key } = event;
                if (key === 'ArrowDown' || key === 'ArrowUp') {
                    step(key === 'ArrowDown' ? 1 : -1);
                    return true;
                }
                if (key === 'ArrowRight' && focus === 'root' && !searching) {
                    enterRootCategory();
                    return true;
                }
                if (key === 'ArrowLeft' && focus === 'sub' && !searching) {
                    if (activeCategory === 'asset' && folderId) {
                        setFolderId(assetFolders.find(folder => folder.id === folderId)?.parentId ?? null);
                    } else {
                        setFocus('root');
                    }
                    return true;
                }
                if (key === ' ' && focus === 'sub') {
                    const row = subRows[subIndex];
                    if (row?.kind !== 'item') return false;
                    toggle(row);
                    return true;
                }
                if (key === 'Enter') {
                    if (checked.size > 0) insertChecked();
                    else if (focus === 'root') enterRootCategory();
                    else if (subRows[subIndex]) activateRow(subRows[subIndex]);
                    return true;
                }
                return false;
            },
        }));

        const keepEditorFocus = (event: React.MouseEvent) => event.preventDefault();

        const rows = (
            <div style={styles.list} ref={listRef} data-testid="mention-submenu" role="listbox">
                {subRows.length === 0 && (
                    <div style={styles.empty}>{searching ? '没有匹配的节点或素材' : '这里还没有内容'}</div>
                )}
                {subRows.map((row, index) => {
                    const isItem = row.kind === 'item';
                    const isChecked = checked.has(rowKey(row));
                    const focused = focus === 'sub' && index === subIndex;
                    const TypeIcon = TYPE_ICONS[row.elementType] || ImageIcon;
                    return (
                        <div
                            key={rowKey(row) + '-' + index}
                            data-sub-index={index}
                            role="option"
                            aria-selected={focused}
                            onMouseEnter={() => { setFocus('sub'); setSubIndex(index); }}
                            onMouseDown={keepEditorFocus}
                            onClick={() => activateRow(row)}
                            style={{ ...styles.row, ...(focused ? styles.rowActive : {}) }}
                        >
                            {isItem ? (
                                <span
                                    role="checkbox"
                                    aria-checked={isChecked}
                                    aria-label={'选择 ' + row.label}
                                    onClick={event => { event.stopPropagation(); toggle(row); }}
                                    style={{ ...styles.checkbox, ...(isChecked ? styles.checkboxOn : {}) }}
                                >
                                    {isChecked && <Check size={11} strokeWidth={3} />}
                                </span>
                            ) : row.kind === 'back' ? <ChevronLeft size={15} style={styles.icon} /> : <Folder size={15} style={styles.icon} />}
                            {isItem && (
                                <span style={styles.thumb}>
                                    {row.thumbnail && isFetchableMediaHref(row.thumbnail)
                                        ? <img src={row.thumbnail} alt="" style={styles.thumbImg} />
                                        : <TypeIcon size={13} style={styles.icon} />}
                                </span>
                            )}
                            <span style={styles.label}>{row.label}</span>
                            {row.kind === 'folder' && <ChevronRight size={13} style={styles.chevron} />}
                        </div>
                    );
                })}
                {checked.size > 0 && (
                    <button type="button" style={styles.insert} onMouseDown={keepEditorFocus} onClick={insertChecked}>
                        插入 {checked.size} 项
                    </button>
                )}
            </div>
        );

        return (
            <div style={styles.shell} data-testid="mention-menu">
                <div style={styles.card}>
                    <div style={styles.search}>
                        <Search size={13} />
                        <span style={query ? styles.searchText : undefined}>{query || '搜索'}</span>
                    </div>
                    {searching ? rows : (
                        <>
                            <div style={styles.sectionHeader}>素材引用</div>
                            {CATEGORIES.map((category, index) => {
                                const Icon = category.icon;
                                const enabled = isEnabled(category.id);
                                const highlighted = activeCategory === category.id || (focus === 'root' && index === rootIndex);
                                return (
                                    <button
                                        key={category.id}
                                        type="button"
                                        data-testid={'mention-category-' + category.id}
                                        disabled={!enabled}
                                        onMouseEnter={() => { if (!enabled) return; setRootIndex(index); setFocus('root'); openCategory(category.id); }}
                                        onMouseDown={keepEditorFocus}
                                        onClick={() => { openCategory(category.id); setFocus('sub'); }}
                                        style={{
                                            ...styles.row,
                                            ...(category.id === 'asset' ? styles.assetRow : {}),
                                            ...(highlighted && enabled ? styles.rowActive : {}),
                                            ...(enabled ? {} : styles.rowDisabled),
                                        }}
                                    >
                                        <Icon size={15} style={styles.icon} />
                                        <span style={styles.label}>{category.label}</span>
                                        {category.id !== 'asset' && counts[category.id] > 0 && <span style={styles.count}>{counts[category.id]}</span>}
                                        {category.id !== 'asset' || hasLibrary ? <ChevronRight size={13} style={styles.chevron} /> : null}
                                    </button>
                                );
                            })}
                            {connectedItems.length === 0 && <div style={styles.hint}>把上游节点连到当前节点后，可在这里 @ 引用</div>}
                        </>
                    )}
                </div>
                {!searching && activeCategory && <div style={{ ...styles.card, ...styles.subCard }}>{rows}</div>}
            </div>
        );
    }
);

MentionList.displayName = 'MentionList';
export default MentionList;

// ---- 样式 -------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
    shell: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '6px',
        zIndex: 9999,
    },
    card: {
        width: '168px',
        padding: '6px',
        borderRadius: '12px',
        background: 'var(--isl-card, #1f1f23)',
        border: '1px solid var(--isl-border, rgba(255,255,255,0.08))',
        boxShadow: '0 10px 30px rgba(0,0,0,0.28)',
        color: 'var(--isl-ink, #e8e8ea)',
    },
    subCard: {
        width: '188px',
    },
    search: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        height: '30px',
        padding: '0 9px',
        marginBottom: '4px',
        borderRadius: '8px',
        border: '1px solid var(--isl-border, rgba(255,255,255,0.1))',
        fontSize: '12px',
        color: 'var(--isl-ink-soft, #8b8b93)',
    },
    searchText: {
        color: 'var(--isl-ink, #e8e8ea)',
    },
    sectionHeader: {
        padding: '6px 8px 4px',
        fontSize: '11px',
        color: 'var(--isl-ink-soft, #8b8b93)',
    },
    list: {
        maxHeight: '300px',
        overflowY: 'auto',
    },
    row: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        height: '30px',
        padding: '0 8px',
        border: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: 'inherit',
        fontSize: '12.5px',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.12s',
    },
    rowActive: {
        background: 'var(--isl-surface-2, rgba(255,255,255,0.08))',
    },
    rowDisabled: {
        opacity: 0.4,
        cursor: 'default',
    },
    assetRow: {
        marginTop: '2px',
    },
    icon: {
        flexShrink: 0,
        color: 'var(--isl-ink-soft, #a1a1aa)',
    },
    label: {
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    count: {
        fontSize: '11px',
        color: 'var(--isl-ink-soft, #8b8b93)',
    },
    chevron: {
        flexShrink: 0,
        color: 'var(--isl-ink-soft, #8b8b93)',
    },
    checkbox: {
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        width: '15px',
        height: '15px',
        borderRadius: '4px',
        border: '1.5px solid var(--isl-ink-soft, #6b6b73)',
        color: '#fff',
    },
    checkboxOn: {
        background: 'var(--isl-mint-deep, #16a34a)',
        borderColor: 'var(--isl-mint-deep, #16a34a)',
    },
    thumb: {
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        width: '22px',
        height: '22px',
        overflow: 'hidden',
        borderRadius: '5px',
        background: 'var(--isl-surface-2, rgba(255,255,255,0.06))',
    },
    thumbImg: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    },
    insert: {
        width: '100%',
        height: '28px',
        marginTop: '4px',
        border: 'none',
        borderRadius: '7px',
        background: 'var(--isl-mint-deep, #16a34a)',
        color: '#fff',
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
    },
    hint: {
        padding: '6px 8px 2px',
        fontSize: '11px',
        lineHeight: 1.4,
        color: 'var(--isl-ink-soft, #8b8b93)',
    },
    empty: {
        padding: '10px 8px',
        fontSize: '12px',
        color: 'var(--isl-ink-soft, #8b8b93)',
    },
};
