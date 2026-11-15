/**
 * 打字浮现：刚键入的字符先带 `pm-fresh` 装饰，约 600ms 后移除。
 * 只做视觉装饰，不改文档；粘贴、撤销、整体替换内容不加装饰。动画样式由外层（如画布玻璃 prompt bar）按需提供。
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const FRESH_TEXT_TTL_MS = 600;
const MAX_TYPED_CHARS = 4;
const key = new PluginKey<DecorationSet>('promptFreshText');

/** 从一次事务中找出“键入”的字符区间（单步、插入少量文字、非粘贴 / 撤销）。 */
export function typedRanges(tr: Transaction): Array<{ from: number; to: number }> {
    if (!tr.docChanged || tr.getMeta('paste') || tr.getMeta('uiEvent') === 'paste' || tr.getMeta('history$') || tr.getMeta('addToHistory') === false) return [];
    const ranges: Array<{ from: number; to: number }> = [];
    tr.mapping.maps.forEach((map, index) => {
        map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            const len = newEnd - newStart;
            if (len <= 0 || len > MAX_TYPED_CHARS) return;
            const mapped = tr.mapping.slice(index + 1);
            const from = mapped.map(newStart, -1);
            const to = mapped.map(newEnd, 1);
            if (to > from && tr.doc.textBetween(from, to, '', '').length === to - from) ranges.push({ from, to });
        });
    });
    return ranges;
}

export function buildFreshTextExtension() {
    return Extension.create({
        name: 'promptFreshText',
        addProseMirrorPlugins() {
            return [new Plugin<DecorationSet>({
                key,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, set) {
                        if (tr.getMeta(key) === 'prune') {
                            const now = Date.now();
                            return set.remove(set.find(undefined, undefined, spec => now - (spec.at as number) >= FRESH_TEXT_TTL_MS));
                        }
                        let next = set.map(tr.mapping, tr.doc);
                        const ranges = typedRanges(tr);
                        if (ranges.length === 0) return next;
                        const at = Date.now();
                        const decorations: Decoration[] = [];
                        for (const { from, to } of ranges) {
                            for (let pos = from; pos < to; pos++) decorations.push(Decoration.inline(pos, pos + 1, { class: 'pm-fresh' }, { at }));
                        }
                        next = next.add(tr.doc, decorations);
                        return next;
                    },
                },
                props: { decorations: state => key.getState(state) },
                view: view => {
                    let timer: ReturnType<typeof setTimeout> | null = null;
                    return {
                        update: () => {
                            const set = key.getState(view.state);
                            if (!set || set === DecorationSet.empty || timer) return;
                            timer = setTimeout(() => {
                                timer = null;
                                if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(key, 'prune').setMeta('addToHistory', false));
                            }, FRESH_TEXT_TTL_MS);
                        },
                        destroy: () => { if (timer) clearTimeout(timer); },
                    };
                },
            })];
        },
    });
}
