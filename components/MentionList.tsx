/**
 * ============================================
 * @ 元素引用下拉菜单组件（Phase 2：分区 + 文件夹浏览）
 * ============================================
 *
 * 三类分区：
 *   1. 已连接：当前生成节点上游已连接节点
 *   2. 个人素材库：两级文件夹浏览 / 跨文件夹搜索 50 条
 *   3. Skill：Anthropic Claude Skills 占位（本轮 disabled）
 *
 * 文件夹导航状态由组件内部维护；query 非空时切换为跨文件夹搜索模式。
 * 键盘上下方向跨分区遍历，文件夹/返回条目通过 onClick 触发导航而非 command。
 */

import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { AssetFolder } from '../types';

export interface MentionItem {
    id: string;
    label: string;
    thumbnail: string;
    elementType: string;
    description?: string;
    sourceType?: 'connected' | 'assetLibrary';
    assetId?: string;
    kind?: 'item' | 'folder' | 'back' | 'skillDisabled';
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

interface MentionListProps {
    /** 已连接节点（已按 query 过滤） */
    connectedItems: MentionItem[];
    /** 全部素材文件夹（扁平，含 parentId） */
    assetFolders: AssetFolder[];
    /** 全部素材索引（不含原图，thumbnail 可空） */
    assetItems: AssetSuggestion[];
    /** 当前 @ query（来自 Tiptap suggestion plugin） */
    query: string;
    /** 选择实际条目（connected / asset）时调用，由 Tiptap command 接管 */
    command: (item: MentionItem) => void;
    /** Skill 分区是否可用；本轮恒为 false，仅显示占位 */
    skillEnabled?: boolean;
}

export interface MentionListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const typeIcon: Record<string, string> = {
    image: '🖼',
    video: '🎬',
    shape: '⬜',
    text: '📝',
    path: '✏️',
    group: '📦',
    arrow: '➡️',
    line: '📏',
    folder: '📁',
    skill: '⚡',
};

interface RenderEntry {
    item: MentionItem;
    sectionTitle: string | null;
    sectionIndex: number;
    clickable: boolean;
}

const SECTION_CONNECTED = '已连接';
const SECTION_LIBRARY = '个人素材库';
const SECTION_SKILL = 'Skill';

const MentionList = forwardRef<MentionListHandle, MentionListProps>(
    ({ connectedItems, assetFolders, assetItems, query, command, skillEnabled = false }, ref) => {
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
        const containerRef = useRef<HTMLDivElement>(null);

        // 当 connectedItems / assetItems / query / activeFolderId 变化时重建扁平渲染列表
        const entries = useMemo<RenderEntry[]>(() => {
            const list: RenderEntry[] = [];
            const normalizedQuery = query.trim().toLowerCase();
            let sectionIndex = 0;

            // 分区 1：已连接
            if (connectedItems.length > 0) {
                connectedItems.forEach(item => {
                    list.push({
                        item: { ...item, kind: 'item', sourceType: item.sourceType || 'connected' },
                        sectionTitle: SECTION_CONNECTED,
                        sectionIndex,
                        clickable: true,
                    });
                });
                sectionIndex++;
            }

            // 分区 2：个人素材库
            const hasLibrary = assetFolders.length > 0 || assetItems.length > 0;
            if (hasLibrary) {
                let libraryEntries: MentionItem[] = [];

                if (normalizedQuery) {
                    // 跨文件夹搜索：name + tags 匹配，最多 50 条
                    const results = assetItems
                        .filter(a =>
                            a.name.toLowerCase().includes(normalizedQuery) ||
                            a.tags.some(t => t.toLowerCase().includes(normalizedQuery))
                        )
                        .slice(0, 50);
                    libraryEntries = results.map(a => ({
                        id: a.id,
                        label: a.name || '未命名素材',
                        thumbnail: a.thumbnail,
                        elementType: a.elementType,
                        kind: 'item',
                        sourceType: 'assetLibrary',
                        assetId: a.id,
                    }));
                } else if (activeFolderId) {
                    // 在文件夹内：显示返回 + 子文件夹 + 该文件夹内 items
                    const currentFolder = assetFolders.find(f => f.id === activeFolderId);
                    const parentFolderId = currentFolder?.parentId ?? null;
                    libraryEntries.push({
                        id: `__back__:${parentFolderId ?? 'root'}`,
                        label: `＜ 返回${parentFolderId ? '' : ' 到素材库'}`,
                        thumbnail: '',
                        elementType: 'folder',
                        kind: 'back',
                        folderId: parentFolderId,
                    });
                    const subFolders = assetFolders.filter(f => f.parentId === activeFolderId);
                    subFolders.forEach(f => {
                        libraryEntries.push({
                            id: `folder:${f.id}`,
                            label: f.name,
                            thumbnail: '',
                            elementType: 'folder',
                            kind: 'folder',
                            folderId: f.id,
                        });
                    });
                    const itemsInFolder = assetItems.filter(a => a.folderIds.includes(activeFolderId));
                    itemsInFolder.forEach(a => {
                        libraryEntries.push({
                            id: a.id,
                            label: a.name || '未命名素材',
                            thumbnail: a.thumbnail,
                            elementType: a.elementType,
                            kind: 'item',
                            sourceType: 'assetLibrary',
                            assetId: a.id,
                        });
                    });
                } else {
                    // 在根：显示根文件夹
                    const rootFolders = assetFolders.filter(f => f.parentId === null);
                    rootFolders.forEach(f => {
                        libraryEntries.push({
                            id: `folder:${f.id}`,
                            label: f.name,
                            thumbnail: '',
                            elementType: 'folder',
                            kind: 'folder',
                            folderId: f.id,
                        });
                    });
                }

                libraryEntries.forEach((item, i) => {
                    list.push({
                        item,
                        sectionTitle: i === 0 ? SECTION_LIBRARY : null,
                        sectionIndex,
                        clickable: item.kind === 'item',
                    });
                });
                if (libraryEntries.length === 0 && normalizedQuery) {
                    list.push({
                        item: {
                            id: '__library_empty__',
                            label: '没有匹配的素材',
                            thumbnail: '',
                            elementType: 'empty',
                            kind: 'skillDisabled',
                        },
                        sectionTitle: SECTION_LIBRARY,
                        sectionIndex,
                        clickable: false,
                    });
                }
                sectionIndex++;
            }

            // 分区 3：Skill（占位）
            if (!skillEnabled) {
                list.push({
                    item: {
                        id: '__skill__',
                        label: 'Skill（即将开放）',
                        thumbnail: '',
                        elementType: 'skill',
                        kind: 'skillDisabled',
                    },
                    sectionTitle: SECTION_SKILL,
                    sectionIndex,
                    clickable: false,
                });
            }

            return list;
        }, [connectedItems, assetFolders, assetItems, query, activeFolderId, skillEnabled]);

        // 列表变化时重置高亮
        useEffect(() => {
            setSelectedIndex(0);
        }, [entries]);

        // 高亮项滚动入视
        useEffect(() => {
            const el = containerRef.current?.querySelector<HTMLButtonElement>(
                `[data-index="${selectedIndex}"]`
            );
            el?.scrollIntoView({ block: 'nearest' });
        }, [selectedIndex]);

        const navigateFolder = (folderId: string | null) => {
            setActiveFolderId(folderId);
            setSelectedIndex(0);
        };

        const pickEntry = (entry: RenderEntry) => {
            if (!entry.clickable) return;
            const item = entry.item;
            if (item.kind === 'folder' || item.kind === 'back') {
                navigateFolder(item.folderId ?? null);
                return;
            }
            // 实际选择（connected / assetLibrary），交给 Tiptap command
            command(item);
        };

        const selectIndex = (index: number) => {
            const entry = entries[index];
            if (entry) pickEntry(entry);
        };

        useImperativeHandle(ref, () => ({
            onKeyDown({ event }: { event: KeyboardEvent }) {
                if (event.key === 'ArrowUp') {
                    setSelectedIndex(i => {
                        for (let step = 1; step <= entries.length; step++) {
                            const next = (i - step + entries.length) % entries.length;
                            const e = entries[next];
                            if (e.clickable || e.item.kind === 'folder' || e.item.kind === 'back') return next;
                        }
                        return i;
                    });
                    return true;
                }
                if (event.key === 'ArrowDown') {
                    setSelectedIndex(i => {
                        for (let step = 1; step <= entries.length; step++) {
                            const next = (i + step) % entries.length;
                            const e = entries[next];
                            if (e.clickable || e.item.kind === 'folder' || e.item.kind === 'back') return next;
                        }
                        return i;
                    });
                    return true;
                }
                if (event.key === 'Enter') {
                    selectIndex(selectedIndex);
                    return true;
                }
                return false;
            },
        }));

        if (entries.length === 0) {
            return (
                <div style={styles.container}>
                            <div style={styles.empty}>工作流中暂无可引用节点，也没有可用素材</div>
                </div>
            );
        }

        return (
            <div style={styles.container} ref={containerRef}>
                {entries.map((entry, index) => {
                    const { item, sectionTitle, clickable } = entry;
                    const isFolder = item.kind === 'folder';
                    const isBack = item.kind === 'back';
                    const isSkill = item.kind === 'skillDisabled';
                    const isItem = item.kind === 'item';
                    const isActive = index === selectedIndex && (clickable || isFolder || isBack);

                    return (
                        <React.Fragment key={`${item.id}-${index}`}>
                            {sectionTitle && <div style={styles.sectionHeader}>{sectionTitle}</div>}
                            <button
                                data-index={index}
                                onClick={() => pickEntry(entry)}
                                disabled={isSkill}
                                style={{
                                    ...styles.item,
                                    ...(isFolder ? styles.folderItem : {}),
                                    ...(isBack ? styles.backItem : {}),
                                    ...(isSkill ? styles.skillItem : {}),
                                    ...(isActive ? styles.itemActive : {}),
                                }}
                                onMouseEnter={() => (clickable || isFolder || isBack) && setSelectedIndex(index)}
                                title={isSkill ? '即将支持 Anthropic Claude Skills 作为参考资源' : undefined}
                            >
                                <span style={styles.thumb}>
                                    {item.thumbnail ? (
                                        <img src={item.thumbnail} alt={item.label} style={styles.thumbImg} />
                                    ) : (
                                        <span style={styles.thumbFallback}>
                                            {typeIcon[item.elementType] || (isFolder ? '📁' : isSkill ? '⚡' : '🔷')}
                                        </span>
                                    )}
                                </span>
                                <span style={styles.info}>
                                    <span style={styles.label}>{item.label}</span>
                                    <span style={styles.type}>
                                        {isFolder
                                            ? '文件夹'
                                            : isBack
                                                ? '返回上级'
                                                : isSkill
                                                    ? '即将开放'
                                                    : item.description || item.elementType}
                                    </span>
                                </span>
                                {(isFolder || isBack) && <span style={styles.chevron}>{isBack ? '' : '›'}</span>}
                            </button>
                        </React.Fragment>
                    );
                })}
            </div>
        );
    }
);

MentionList.displayName = 'MentionList';
export default MentionList;

// ---- 样式 -------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
    container: {
        background: 'var(--panel-bg, #ffffff)',
        border: '1px solid var(--border-color, #e5e7eb)',
        borderRadius: '12px',
        boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
        padding: '4px',
        minWidth: '220px',
        maxWidth: '280px',
        maxHeight: '320px',
        overflowY: 'auto',
        zIndex: 9999,
    },
    sectionHeader: {
        fontSize: '10px',
        fontWeight: 600,
        color: 'var(--text-muted, #9ca3af)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        padding: '6px 8px 3px',
        borderTop: '1px solid var(--border-color, #f0f0f0)',
        marginTop: '2px',
    },
    item: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '5px 8px',
        border: 'none',
        borderRadius: '8px',
        background: 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.12s',
        color: 'var(--text-primary, #111827)',
    },
    folderItem: {
        fontWeight: 500,
    },
    backItem: {
        color: 'var(--text-muted, #6b7280)',
        fontStyle: 'italic',
    },
    skillItem: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
    itemActive: {
        background: 'rgba(99, 102, 241, 0.15)',
    },
    thumb: {
        flexShrink: 0,
        width: '28px',
        height: '28px',
        borderRadius: '6px',
        overflow: 'hidden',
        background: 'var(--panel-soft, #f3f4f6)',
        border: '1px solid var(--border-color, #e5e7eb)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    thumbImg: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
    },
    thumbFallback: {
        fontSize: '14px',
        lineHeight: 1,
    },
    info: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        flex: 1,
    },
    label: {
        fontSize: '12px',
        fontWeight: 500,
        color: 'var(--text-primary, #111827)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    type: {
        fontSize: '10px',
        color: 'var(--text-muted, #9ca3af)',
        textTransform: 'capitalize',
    },
    chevron: {
        fontSize: '14px',
        color: 'var(--text-muted, #9ca3af)',
        marginLeft: '4px',
        flexShrink: 0,
    },
    empty: {
        padding: '10px 12px',
        fontSize: '12px',
        color: 'var(--text-muted, #9ca3af)',
    },
};
