/**
 * 提示词引用提示：光标紧跟在未加 @ 的引用名（如 图片1、视频2、节点标题）之后时，
 * 在其后显示一个虚线引用 chip 和「点击 或 按Tab键插入」提示；按 Tab 或点击即把该段文字替换为 mediaMention 引用。
 * 候选只来自当前节点已连线的上游节点（与 @ 菜单同一份 referenceItems），因此插入的引用一定能被运行时解析。
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { MentionItem } from './MentionList';
import { isFetchableMediaHref } from './workflow/media';

export interface ReferenceHintMatch {
    from: number;
    to: number;
    item: MentionItem;
}

const LEAF_PLACEHOLDER = '\ufffc';

export function findReferenceHint(state: EditorState, items: MentionItem[]): ReferenceHintMatch | null {
    const { selection } = state;
    if (!selection.empty || items.length === 0) return null;
    const $pos = selection.$from;
    if (!$pos.parent.isTextblock) return null;
    // 行内 mention 等叶子节点按 1 个占位字符计，保证字符偏移与文档位置一一对应
    const before = $pos.parent.textBetween(0, $pos.parentOffset, undefined, LEAF_PLACEHOLDER);
    let best: ReferenceHintMatch | null = null;
    for (const item of items) {
        for (const name of [item.label, ...(item.aliases || [])]) {
            const candidate = name?.trim();
            if (!candidate || !before.endsWith(candidate)) continue;
            if (before[before.length - candidate.length - 1] === '@') continue;
            if (best && best.to - best.from >= candidate.length) continue;
            best = { from: $pos.pos - candidate.length, to: $pos.pos, item };
        }
    }
    return best;
}

export function insertReferenceHint(view: EditorView, match: ReferenceHintMatch): boolean {
    const { schema } = view.state;
    const type = schema.nodes.mediaMention;
    if (!type) return false;
    const { item } = match;
    const mention = type.create({
        id: item.id,
        label: item.label,
        thumbnail: item.thumbnail,
        elementType: item.elementType,
        description: item.description,
        sourceType: item.sourceType ?? null,
        assetId: item.assetId ?? null,
    });
    view.dispatch(view.state.tr.replaceWith(match.from, match.to, [mention, schema.text(' ')]).scrollIntoView());
    view.focus();
    return true;
}

function renderHint(view: EditorView, match: ReferenceHintMatch, getItems: () => MentionItem[]): HTMLElement {
    const root = document.createElement('span');
    root.className = 'prompt-ref-hint';
    root.contentEditable = 'false';
    root.dataset.testid = 'prompt-ref-hint';
    const tip = document.createElement('span');
    tip.className = 'prompt-ref-hint__tip';
    tip.textContent = '点击 或 按Tab键插入';
    const chip = document.createElement('span');
    chip.className = 'prompt-ref-hint__chip';
    if (match.item.thumbnail && isFetchableMediaHref(match.item.thumbnail)) {
        const img = document.createElement('img');
        img.src = match.item.thumbnail;
        img.alt = '';
        chip.appendChild(img);
    }
    const label = document.createElement('span');
    label.textContent = match.item.label;
    chip.appendChild(label);
    root.append(tip, chip);
    root.addEventListener('mousedown', event => {
        event.preventDefault();
        const current = findReferenceHint(view.state, getItems());
        if (current) insertReferenceHint(view, current);
    });
    return root;
}

export function buildReferenceHintExtension(getItems: () => MentionItem[]) {
    return Extension.create({
        name: 'promptReferenceHint',
        addProseMirrorPlugins() {
            return [
                new Plugin({
                    key: new PluginKey('promptReferenceHint'),
                    props: {
                        decorations(state) {
                            const match = findReferenceHint(state, getItems());
                            if (!match) return null;
                            return DecorationSet.create(state.doc, [
                                Decoration.inline(match.from, match.to, { class: 'prompt-ref-hint__text' }),
                                Decoration.widget(match.to, view => renderHint(view, match, getItems), {
                                    side: 1,
                                    key: 'ref-hint:' + match.item.id + ':' + match.from,
                                }),
                            ]);
                        },
                        handleKeyDown(view, event) {
                            if (event.key !== 'Tab' || event.shiftKey || event.isComposing) return false;
                            const match = findReferenceHint(view.state, getItems());
                            if (!match) return false;
                            event.preventDefault();
                            return insertReferenceHint(view, match);
                        },
                    },
                }),
            ];
        },
    });
}

export const REFERENCE_HINT_STYLES = [
    '.prompt-ref-hint{position:relative;display:inline-flex;align-items:center;margin-left:4px;vertical-align:middle;cursor:pointer;user-select:none}',
    '.prompt-ref-hint__chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px 0 2px;border-radius:6px;border:1px dashed var(--isl-border,rgba(255,255,255,.25));color:var(--isl-ink-soft,#9a9aa2);font-size:12px;line-height:1}',
    '.prompt-ref-hint__chip img{width:16px;height:16px;border-radius:4px;object-fit:cover}',
    '.prompt-ref-hint__tip{position:absolute;bottom:calc(100% + 6px);left:0;white-space:nowrap;padding:3px 7px;border-radius:6px;background:rgba(15,15,18,.92);color:#fff;font-size:11px;pointer-events:none;z-index:2}',
    '.prompt-ref-hint__text{border-bottom:1px dashed var(--isl-mint-deep,#16a34a)}',
].join('\n');
