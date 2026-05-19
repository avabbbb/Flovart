/**
 * ============================================
 * 画布元素 @Mention 自定义 Tiptap 扩展
 * ============================================
 *
 * 实现在提示词编辑器中 @ 引用画布元素的能力。
 * 每个 mention 节点存储：元素 ID、类型、标签名、缩略图。
 * 节点渲染为带缩略图的不可编辑行内徽章。
 */

import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import React from 'react';

// ---- 可视化节点渲染 ----------------------------------------

interface MentionNodeViewProps {
    node: {
        attrs: {
            id: string;
            label: string;
            thumbnail: string;
            elementType: string;
        };
    };
    deleteNode: () => void;
}

const MentionNodeView: React.FC<MentionNodeViewProps> = ({ node, deleteNode }) => {
    const { label, thumbnail, elementType } = node.attrs;

    const typeIcon: Record<string, string> = {
        image: '🖼',
        video: '🎬',
        shape: '⬜',
        text: '📝',
        path: '✏️',
        group: '📦',
        arrow: '➡️',
        line: '📏',
    };

    return (
        <NodeViewWrapper
            as="span"
            className="mention-node"
            style={{ display: 'inline-flex', alignItems: 'center', userSelect: 'none' }}
            contentEditable={false}
        >
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    backgroundColor: 'rgba(99, 102, 241, 0.10)',
                    border: '1px solid rgba(99, 102, 241, 0.24)',
                    borderRadius: '6px',
                    padding: '1px 6px 1px 3px',
                    fontSize: '12px',
                    lineHeight: '1.5',
                    color: '#4F46E5',
                    fontWeight: 500,
                    cursor: 'default',
                    maxWidth: '140px',
                    verticalAlign: 'middle',
                }}
                title={label}
            >
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt={label}
                        style={{
                            width: '16px',
                            height: '16px',
                            objectFit: 'cover',
                            borderRadius: '3px',
                            flexShrink: 0,
                        }}
                    />
                ) : (
                    <span style={{ fontSize: '12px', lineHeight: 1 }}>
                        {typeIcon[elementType] || '🔷'}
                    </span>
                )}
                <span
                    style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '86px',
                    }}
                >
                    {label}
                </span>
                <span
                    onClick={deleteNode}
                    style={{
                        marginLeft: '2px',
                        opacity: 0.45,
                        cursor: 'pointer',
                        fontSize: '11px',
                        lineHeight: 1,
                        flexShrink: 0,
                        transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => { (e.target as HTMLElement).style.opacity = '1'; }}
                    onMouseLeave={e => { (e.target as HTMLElement).style.opacity = '0.45'; }}
                    title="移除引用"
                >
                    ×
                </span>
            </span>
        </NodeViewWrapper>
    );
};

// ---- Tiptap Node 定义 ----------------------------------------

export const CanvasMentionNode = Node.create({
    name: 'canvasMention',

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
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-canvas-mention]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes({ 'data-canvas-mention': '' }, HTMLAttributes)];
    },

    renderText({ node }) {
        return `@${node.attrs.label}`;
    },

    addNodeView() {
        return ReactNodeViewRenderer(MentionNodeView as any);
    },
});

// ---- 工具函数：从 editor JSON 提取所有 mention 节点 --------

export interface MentionData {
    id: string;
    label: string;
    thumbnail: string;
    elementType: string;
}

export function extractMentions(editorJSON: Record<string, unknown>): MentionData[] {
    const mentions: MentionData[] = [];

    function walk(node: Record<string, unknown>) {
        if (node.type === 'canvasMention' && node.attrs) {
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
        } else if (node.type === 'canvasMention') {
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
