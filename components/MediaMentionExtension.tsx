/**
 * ============================================
 * Workflow 媒体引用 @Mention 自定义 Tiptap 扩展
 * ============================================
 *
 * 实现在提示词编辑器中 @ 引用 Workflow 节点和资产的能力。
 * 每个 mention 节点存储：引用 ID、类型、标签名、缩略图。
 * 节点渲染为带缩略图的不可编辑行内徽章。
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { isFetchableMediaHref } from './workflow/media';
import type { WorkflowReferenceRegion } from './workflow/types';

// ---- 可视化节点渲染 ----------------------------------------

function createMentionNodeView({ node, getPos, editor }: { node: any; getPos: any; editor: any }) {
    const typeIcon: Record<string, string> = { image: '🖼', video: '🎬', shape: '⬜', text: '📝', path: '✏️', group: '📦', arrow: '➡️', line: '📏' };
    const { label, thumbnail, elementType } = node.attrs;
    const root = document.createElement('span');
    root.className = 'mention-node';
    root.dataset.mediaMention = '';
    root.contentEditable = 'false';
    root.style.cssText = 'display:inline-flex;align-items:center;user-select:none;';

    const chip = document.createElement('span');
    chip.title = label;
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:rgba(99,102,241,.10);border:1px solid rgba(99,102,241,.24);border-radius:6px;padding:1px 6px 1px 3px;font-size:12px;line-height:1.5;color:#4F46E5;font-weight:500;cursor:default;max-width:140px;vertical-align:middle;';

    if (thumbnail && isFetchableMediaHref(thumbnail)) {
        const image = document.createElement('img');
        image.src = thumbnail;
        image.alt = label;
        image.style.cssText = 'width:16px;height:16px;object-fit:cover;border-radius:3px;flex-shrink:0;';
        chip.appendChild(image);
    } else {
        const icon = document.createElement('span');
        icon.textContent = typeIcon[elementType] || '🔷';
        icon.style.cssText = 'font-size:12px;line-height:1;';
        chip.appendChild(icon);
    }

    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:86px;';
    chip.appendChild(text);

    const remove = document.createElement('span');
    remove.textContent = '×';
    remove.title = '移除引用';
    remove.style.cssText = 'margin-left:2px;opacity:.45;cursor:pointer;font-size:11px;line-height:1;flex-shrink:0;transition:opacity .15s;';
    remove.addEventListener('mouseenter', () => { remove.style.opacity = '1'; });
    remove.addEventListener('mouseleave', () => { remove.style.opacity = '.45'; });
    const handleRemoveClick = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof getPos !== 'function') return;
        const position = getPos();
        if (typeof position === 'number') editor.chain().focus().deleteRange({ from: position, to: position + node.nodeSize }).run();
    };
    remove.addEventListener('click', handleRemoveClick);
    chip.appendChild(remove);
    root.appendChild(chip);

    return {
        dom: root,
        stopEvent: (event: Event) => root.contains(event.target as HTMLElement),
        ignoreMutation: () => true,
        destroy: () => {
            remove.removeEventListener('click', handleRemoveClick);
        },
    };
}

// ---- Tiptap Node 定义 ----------------------------------------

export const MediaMentionNode = Node.create({
    name: 'mediaMention',

    group: 'inline',
    inline: true,
    selectable: false,
    atom: true,

    addAttributes() {
        return {
            id: { default: null },
            label: { default: '' },
            thumbnail: { default: '' },
            elementType: { default: 'image' },
            description: { default: '' },
            sourceType: { default: null },
            assetId: { default: null },
            /** 带区域的引用：{x,y,w,h}（0-1）与可选 mask；null 表示整张图。 */
            region: { default: null },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-media-mention]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes({ 'data-media-mention': '' }, HTMLAttributes)];
    },

    renderText({ node }) {
        return `@${node.attrs.label}`;
    },

    addNodeView() {
        return (props: any) => createMentionNodeView(props);
    },
});

// ---- 工具函数：从 editor JSON 提取所有 mention 节点 --------

export interface MentionData {
    id: string;
    label: string;
    thumbnail: string;
    elementType: string;
    description?: string;
    sourceType?: 'connected' | 'assetLibrary';
    assetId?: string;
    region?: WorkflowReferenceRegion | null;
}

export function extractMentions(editorJSON: Record<string, unknown>): MentionData[] {
    const mentions: MentionData[] = [];

    function walk(node: Record<string, unknown>) {
        if (node.type === 'mediaMention' && node.attrs) {
            const attrs = node.attrs as MentionData;
            if (attrs.id) mentions.push(attrs);
        }
        if (Array.isArray(node.content)) {
            (node.content as Record<string, unknown>[]).forEach(walk);
        }
    }

    walk(editorJSON);
    return mentions;
}

/** 将 editor JSON 转为纯文本（把 mention 节点渲染为 @名称） */
export function editorJSONToText(editorJSON: Record<string, unknown>): string {
    const parts: string[] = [];

    function walk(node: Record<string, unknown>) {
        if (node.type === 'text') {
            parts.push((node.text as string) || '');
        } else if (node.type === 'mediaMention') {
            const attrs = node.attrs as MentionData;
            parts.push(`@${attrs.label}`);
        } else if (node.type === 'hardBreak') {
            parts.push('\n');
        } else if (Array.isArray(node.content)) {
            (node.content as Record<string, unknown>[]).forEach(walk);
            if (node.type === 'paragraph') parts.push('\n');
        }
    }

    walk(editorJSON);
    return parts.join('').replace(/\n$/, '').trim();
}
