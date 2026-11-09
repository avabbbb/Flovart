import { buildReferenceHintExtension, REFERENCE_HINT_STYLES } from './promptReferenceHint';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DOMSerializer, Slice } from '@tiptap/pm/model';
import { Suggestion } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import ReactDOM from 'react-dom/client';
import MentionList, { type MentionItem, type AssetSuggestion, type MentionListHandle, type MentionCommandPayload } from './MentionList';
import { MediaMentionNode, editorJSONToText, extractMentions, type MentionData } from './MediaMentionExtension';
import type { AssetFolder } from '../types';
import {
    decodePromptClipboard,
    encodePromptClipboard,
    FLOVART_PROMPT_CLIPBOARD_MIME,
    hydratePromptText,
    rebindPromptDocument,
    type PromptReferenceMention,
} from '../utils/promptReferenceClipboard';

function buildDocFromText(text: string) {
    const paragraphs = (text || '').split('\n').map(line => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : [],
    }));

    return {
        type: 'doc',
        content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
    };
}

function normalizeDocument(
    text: string,
    document?: Record<string, unknown>,
): Record<string, unknown> {
    if (document && typeof document === 'object' && document.type === 'doc') {
        return document;
    }
    return buildDocFromText(text);
}

// ---- @ 建议弹层：显式会话状态机 ----
// 一次 @ 输入从 onStart 到 onExit 是一个会话；Escape 只隐藏（hidden），继续输入改变 query 时重新打开。
export type MentionPopupPhase =
    | { kind: 'closed' }
    | { kind: 'open'; query: string }
    | { kind: 'hidden'; query: string }
    | { kind: 'exiting' };

export type MentionPopupEvent =
    | { type: 'start'; query: string }
    | { type: 'update'; query: string }
    | { type: 'escape' }
    | { type: 'exit' };

export function nextMentionPopupPhase(phase: MentionPopupPhase, event: MentionPopupEvent): MentionPopupPhase {
    switch (event.type) {
        case 'start':
            return { kind: 'open', query: event.query };
        case 'update':
            if (phase.kind === 'open') return { kind: 'open', query: event.query };
            if (phase.kind === 'hidden' && phase.query !== event.query) return { kind: 'open', query: event.query };
            return phase;
        case 'escape':
            return phase.kind === 'open' ? { kind: 'hidden', query: phase.query } : phase;
        case 'exit':
            return phase.kind === 'open' || phase.kind === 'hidden' ? { kind: 'exiting' } : phase;
    }
}

export type MentionKeyRoute = 'hide' | 'list' | 'editor';

// 只有可见的列表才接管按键；隐藏后 Enter/方向键原样交给编辑器，避免对看不见的列表误操作。
export function routeMentionKey(phase: MentionPopupPhase, key: string): MentionKeyRoute {
    if (phase.kind !== 'open') return 'editor';
    return key === 'Escape' || key === 'Esc' ? 'hide' : 'list';
}

// 程序化写回（润色/翻译/还原）带此 meta，不解除 @ 建议抑制。
export const suggestionProgrammaticMeta = 'flovartProgrammaticWrite';

// 真实用户输入事务（键入、IME、鼠标点选、拖放/剪切）解除抑制；插件追加的事务不算。
export function releasesSuggestionSuppression(tr: { docChanged: boolean; getMeta: (key: string) => unknown }): boolean {
    if (tr.getMeta(suggestionProgrammaticMeta) || tr.getMeta('appendedTransaction')) return false;
    return tr.docChanged || !!tr.getMeta('pointer') || !!tr.getMeta('uiEvent') || tr.getMeta('composition') !== undefined;
}

interface MentionSuggestionProps {
    query: string;
    items: MentionItem[];
    command: (payload: MentionCommandPayload) => void;
    clientRect?: (() => DOMRect | null) | null;
}

export interface MentionPopupSession {
    phase: MentionPopupPhase;
    popup: TippyInstance | null;
    readonly container: HTMLElement;
    readonly root: ReactDOM.Root;
    readonly listRef: React.RefObject<MentionListHandle>;
}

export interface MentionPopupRenderer {
    readonly session: MentionPopupSession | null;
    onStart(props: MentionSuggestionProps): void;
    onUpdate(props: MentionSuggestionProps): void;
    onKeyDown(props: { event: KeyboardEvent }): boolean;
    onExit(): void;
}

export function createMentionPopupRenderer(
    assetFoldersRef: { current: AssetFolder[] },
    assetItemsRef: { current: AssetSuggestion[] },
): MentionPopupRenderer {
    let session: MentionPopupSession | null = null;

    const renderList = (target: MentionPopupSession, props: MentionSuggestionProps) => {
        target.root.render(
            <MentionList
                ref={target.listRef}
                connectedItems={props.items}
                assetFolders={assetFoldersRef.current}
                assetItems={assetItemsRef.current}
                query={props.query || ''}
                command={props.command}
            />
        );
    };

    return {
        get session() {
            return session;
        },
        onStart(props) {
            const container = document.createElement('div');
            document.body.appendChild(container);
            const started: MentionPopupSession = {
                phase: nextMentionPopupPhase({ kind: 'closed' }, { type: 'start', query: props.query || '' }),
                popup: null,
                container,
                root: ReactDOM.createRoot(container),
                listRef: React.createRef<MentionListHandle>(),
            };
            session = started;
            renderList(started, props);
            started.popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: container,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'top-start',
                theme: 'mention-popup',
                arrow: false,
                offset: [0, 4],
                zIndex: 99999,
                popperOptions: {
                    strategy: 'fixed',
                    modifiers: [
                        {
                            name: 'flip',
                            enabled: true,
                            options: {
                                behavior: ['bottom-start', 'top-start'],
                                padding: 8,
                            },
                        },
                        { name: 'preventOverflow', enabled: true, options: { padding: 8 } },
                    ],
                },
            })[0] ?? null;
        },
        onUpdate(props) {
            const current = session;
            if (!current) return;
            const previous = current.phase;
            current.phase = nextMentionPopupPhase(previous, { type: 'update', query: props.query || '' });
            renderList(current, props);
            if (props.clientRect) {
                current.popup?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect });
            }
            if (previous.kind === 'hidden' && current.phase.kind === 'open') current.popup?.show();
        },
        onKeyDown({ event }) {
            const current = session;
            if (!current) return false;
            const route = routeMentionKey(current.phase, event.key);
            if (route === 'editor') return false;
            if (route === 'hide') {
                current.phase = nextMentionPopupPhase(current.phase, { type: 'escape' });
                current.popup?.hide();
                return true;
            }
            return current.listRef.current?.onKeyDown({ event }) ?? false;
        },
        onExit() {
            const ending = session;
            if (!ending) return;
            session = null;
            ending.phase = nextMentionPopupPhase(ending.phase, { type: 'exit' });
            ending.popup?.destroy();
            ending.popup = null;
            // 推迟卸载避免在渲染中同步 unmount；只拆除本会话自己的 root，快速重开的新会话不受影响。
            setTimeout(() => {
                ending.root.unmount();
                ending.container.remove();
                ending.phase = { kind: 'closed' };
            }, 0);
        },
    };
}

function buildSuggestionExtension(
    getItems: (query: string) => MentionItem[],
    assetFoldersRef: { current: AssetFolder[] },
    assetItemsRef: { current: AssetSuggestion[] },
    onSelectAssetRef: { current: ((assetId: string) => string | undefined) | null },
    suppressSuggestionRef: { current: boolean },
) {
    return Extension.create({
        name: 'mediaMentionSuggestion',
        addProseMirrorPlugins() {
            return [
                // 必须排在 Suggestion 之前：同一事务里先解除抑制，Suggestion 的 allow 才能看到最新值。
                new Plugin({
                    key: new PluginKey('mediaMentionSuggestionRelease'),
                    state: {
                        init: () => null,
                        apply(tr, value) {
                            if (releasesSuggestionSuppression(tr)) suppressSuggestionRef.current = false;
                            return value;
                        },
                    },
                }),
                Suggestion({
                    editor: this.editor,
                    char: '@',
                    allowSpaces: false,
                    allowedPrefixes: null,
                    // 润色/翻译/还原等程序化写回不应弹出 @ 建议层；任意真实用户输入后恢复。
                    allow: () => !suppressSuggestionRef.current,
                    items: ({ query }) => getItems(query),
                    render: () => createMentionPopupRenderer(assetFoldersRef, assetItemsRef),
                    command({ editor, range, props }) {
                        // 单个条目或勾选后的批量条目；素材先物化为上游节点，物化失败的跳过。
                        const payload = props as MentionCommandPayload;
                        const picked = 'batch' in payload ? payload.batch : [payload];
                        const content = picked.flatMap(item => {
                            let mentionId: string | undefined = item.id;
                            if (item.sourceType === 'assetLibrary' && item.assetId && onSelectAssetRef.current) {
                                mentionId = onSelectAssetRef.current(item.assetId);
                            }
                            if (!mentionId) return [];
                            return [{
                                type: 'mediaMention',
                                attrs: {
                                    id: mentionId,
                                    label: item.label,
                                    thumbnail: item.thumbnail,
                                    elementType: item.elementType,
                                    description: item.description,
                                    sourceType: item.sourceType ?? null,
                                    assetId: item.assetId ?? null,
                                },
                            }, { type: 'text', text: ' ' }];
                        });
                        if (content.length === 0) return;
                        editor.chain().focus().deleteRange(range).insertContent(content).run();
                    },
                }),
            ];
        },
    });
}

export interface RichPromptEditorHandle {
    clear: () => void;
    focus: () => void;
    setText: (text: string) => void;
    setDocument: (document: Record<string, unknown>) => void;
    getJSON: () => Record<string, unknown>;
    getText: () => string;
    getMentions: () => MentionData[];
}

export function applyEditorPlaceholder(
    editor: { isDestroyed: boolean; view: { dom: HTMLElement } } | null,
    placeholder: string,
): void {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute('data-placeholder', placeholder);
    editor.view.dom.setAttribute('aria-label', placeholder);
}

export interface RichPromptEditorProps {
    referenceItems: MentionItem[];
    /** 粘贴纯文本时允许按名称恢复的候选项；与 @ 下拉候选分开，避免把所有画布节点塞进下拉。 */
    pasteReferenceItems?: MentionItem[];
    placeholder?: string;
    disabled?: boolean;
    onTextChange?: (plainText: string, json: Record<string, unknown>) => void;
    onSubmit?: () => void;
    initialText?: string;
    initialDocument?: Record<string, unknown>;
    /** 个人素材库根文件夹（扁平数组，parentId=null 表示根级） */
    assetFolders?: AssetFolder[];
    /** 个人素材库条目（轻量索引，不含原图 dataUrl） */
    assetItems?: AssetSuggestion[];
    /** 选择素材时调用，返回新节点 id（或复用已存在节点 id）；未提供则禁用素材选择 */
    onSelectAsset?: (assetId: string) => string | undefined;
    /** 批量把粘贴内容里的来源 id / assetId 绑定为当前节点可用的上游引用。返回值与入参数组按索引对应。 */
    onResolvePastedMentions?: (mentions: MentionData[]) => Array<MentionData | null>;
    onPasteUnresolvedMentions?: (labels: string[]) => void;
}

const RichPromptEditor = forwardRef<RichPromptEditorHandle, RichPromptEditorProps>(
    ({ referenceItems, pasteReferenceItems = referenceItems, placeholder = '输入提示词，@ 引用工作流节点或资产...', disabled, onTextChange, onSubmit, initialText = '', initialDocument, assetFolders = [], assetItems = [], onSelectAsset, onResolvePastedMentions, onPasteUnresolvedMentions }, ref) => {
        const referenceItemsRef = useRef(referenceItems);
        const pasteReferenceItemsRef = useRef(pasteReferenceItems);
        const assetFoldersRef = useRef(assetFolders);
        const assetItemsRef = useRef(assetItems);
        const onSelectAssetRef = useRef(onSelectAsset);
        const onResolvePastedMentionsRef = useRef(onResolvePastedMentions);
        const onPasteUnresolvedMentionsRef = useRef(onPasteUnresolvedMentions);

        useEffect(() => {
            referenceItemsRef.current = referenceItems;
        }, [referenceItems]);

        useEffect(() => {
            pasteReferenceItemsRef.current = pasteReferenceItems;
        }, [pasteReferenceItems]);

        useEffect(() => {
            assetFoldersRef.current = assetFolders;
        }, [assetFolders]);

        useEffect(() => {
            assetItemsRef.current = assetItems;
        }, [assetItems]);

        useEffect(() => {
            onSelectAssetRef.current = onSelectAsset;
        }, [onSelectAsset]);

        useEffect(() => {
            onResolvePastedMentionsRef.current = onResolvePastedMentions;
        }, [onResolvePastedMentions]);

        useEffect(() => {
            onPasteUnresolvedMentionsRef.current = onPasteUnresolvedMentions;
        }, [onPasteUnresolvedMentions]);

        const suppressSuggestionRef = useRef(false);
        const getFilteredItems = useCallback((query: string): MentionItem[] => {
            const normalized = query.toLowerCase();
            return referenceItemsRef.current.filter(
                item =>
                    item.label.toLowerCase().includes(normalized) ||
                    item.elementType.toLowerCase().includes(normalized) ||
                    item.description?.toLowerCase().includes(normalized) ||
                    item.id.toLowerCase().includes(normalized)
            );
        }, []);

        const editor = useEditor({
            extensions: [
                StarterKit.configure({
                    bold: false,
                    italic: false,
                    strike: false,
                    code: false,
                    blockquote: false,
                    heading: false,
                    codeBlock: false,
                    bulletList: false,
                    orderedList: false,
                    listItem: false,
                    horizontalRule: false,
                }),
                MediaMentionNode,
                buildSuggestionExtension(getFilteredItems, assetFoldersRef, assetItemsRef, onSelectAssetRef, suppressSuggestionRef),
                buildReferenceHintExtension(() => referenceItemsRef.current),
            ],
            content: normalizeDocument(initialText, initialDocument),
            editable: !disabled,
            editorProps: {
                attributes: {
                    class: 'rich-prompt-editor',
                    role: 'textbox',
                    spellcheck: 'false',
                    'aria-multiline': 'true',
                    'aria-label': placeholder,
                    'data-placeholder': placeholder,
                },
                handleKeyDown(_, event) {
                    suppressSuggestionRef.current = false;
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        onSubmit?.();
                        return true;
                    }
                    return false;
                },
                handlePaste(view, event) {
                    suppressSuggestionRef.current = false;
                    const clipboard = event.clipboardData;
                    if (!clipboard) return false;
                    const encoded = clipboard.getData(FLOVART_PROMPT_CLIPBOARD_MIME);
                    const payload = decodePromptClipboard(encoded);
                    const plainText = payload?.plainText || clipboard.getData('text/plain');
                    if (!payload && !plainText.includes('@')) return false;
                    const hydrated = payload
                        ? { plainText, document: payload.document, mentionedElementIds: [], unresolvedLabels: [] }
                        : hydratePromptText(plainText, pasteReferenceItemsRef.current);
                    if (!payload && hydrated.mentionedElementIds.length === 0 && hydrated.unresolvedLabels.length === 0) return false;
                    try {
                        view.state.schema.nodeFromJSON(hydrated.document).check();
                    } catch {
                        return false;
                    }
                    const mentions = extractMentions(hydrated.document);
                    const aliasSources = new Map<string, string>();
                    const resolvable = mentions.map((mention, index) => ({ mention, index })).filter(({ mention }) => {
                        const alias = mention.label.trim().toLocaleLowerCase();
                        const identity = mention.assetId ? `asset:${mention.assetId}` : `node:${mention.id}`;
                        const owner = aliasSources.get(alias);
                        if (owner && owner !== identity) return false;
                        aliasSources.set(alias, identity);
                        return true;
                    });
                    const reboundMentions = onResolvePastedMentionsRef.current?.(resolvable.map(item => item.mention))
                        || resolvable.map(item => item.mention);
                    const resolved: Array<MentionData | null> = mentions.map(() => null);
                    resolvable.forEach((item, index) => { resolved[item.index] = reboundMentions[index] || null; });
                    let mentionIndex = 0;
                    const rebound = rebindPromptDocument(hydrated.document, () => resolved[mentionIndex++] || null);
                    const unresolvedLabels = [...new Set([...hydrated.unresolvedLabels, ...rebound.unresolvedLabels])];
                    try {
                        const doc = view.state.schema.nodeFromJSON(rebound.document);
                        view.dispatch(view.state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
                    } catch {
                        return false;
                    }
                    event.preventDefault();
                    if (unresolvedLabels.length > 0) onPasteUnresolvedMentionsRef.current?.(unresolvedLabels);
                    return true;
                },
                handleDOMEvents: {
                    copy(view, rawEvent) {
                        const event = rawEvent as ClipboardEvent;
                        if (!event.clipboardData || view.state.selection.empty) return false;
                        const slice = view.state.selection.content();
                        const document = { type: 'doc', content: slice.content.toJSON() };
                        const wrapper = window.document.createElement('div');
                        wrapper.appendChild(DOMSerializer.fromSchema(view.state.schema).serializeFragment(slice.content));
                        event.clipboardData.setData(FLOVART_PROMPT_CLIPBOARD_MIME, encodePromptClipboard(document));
                        event.clipboardData.setData('text/plain', editorJSONToText(document));
                        event.clipboardData.setData('text/html', wrapper.innerHTML);
                        event.preventDefault();
                        return true;
                    },
                },
            },
            onUpdate({ editor }) {
                const json = editor.getJSON() as Record<string, unknown>;
                onTextChange?.(editorJSONToText(json), json);
            },
        });

        useImperativeHandle(ref, () => ({
            clear() {
                editor?.commands.clearContent(true);
            },
            focus() {
                editor?.commands.focus('end');
            },
            setText(text: string) {
                if (!editor) return;
                // tiptap v3：setContent 的 emitUpdate 默认即为 true（此前传 false 也会走默认值），显式声明保持契约
                suppressSuggestionRef.current = true;
                editor.chain().setMeta(suggestionProgrammaticMeta, true).setContent(buildDocFromText(text), { emitUpdate: true }).run();
            },
            setDocument(document: Record<string, unknown>) {
                if (!editor) return;
                suppressSuggestionRef.current = true;
                editor.chain().setMeta(suggestionProgrammaticMeta, true).setContent(normalizeDocument('', document), { emitUpdate: true }).run();
            },
            getJSON() {
                return (editor?.getJSON() ?? {}) as Record<string, unknown>;
            },
            getText() {
                const json = editor?.getJSON() as Record<string, unknown> | undefined;
                return json ? editorJSONToText(json) : '';
            },
            getMentions() {
                const json = editor?.getJSON() as Record<string, unknown> | undefined;
                return json ? extractMentions(json) : [];
            },
        }));

        useEffect(() => {
            editor?.setEditable(!disabled);
        }, [disabled, editor]);

        useEffect(() => {
            applyEditorPlaceholder(editor, placeholder);
        }, [editor, placeholder]);

        return (
            <>
                <style>{editorStyles() + REFERENCE_HINT_STYLES}</style>
                <EditorContent editor={editor} />
            </>
        );
    }
);

RichPromptEditor.displayName = 'RichPromptEditor';

export type PromptReferenceMentionItem = PromptReferenceMention;

// 提交前把纯文本里的 @名称（用户手动输入而非从选择器选择）解析为真实引用绑定。
// 与粘贴路径共用同一套名称匹配 + rebind 逻辑；返回是否发生了文档改写。
export function resolveEditorMentions(
    editor: RichPromptEditorHandle,
    candidates: PromptReferenceMention[],
    resolvePasted?: (mentions: MentionData[]) => Array<MentionData | null>,
): boolean {
    const text = editor.getText();
    if (!text.includes('@')) return false;
    const hydrated = hydratePromptText(text, candidates);
    const mentions = extractMentions(hydrated.document);
    if (mentions.length === 0) return false;

    const aliasSources = new Map<string, string>();
    const resolvable = mentions.map((mention, index) => ({ mention, index })).filter(({ mention }) => {
        const alias = mention.label.trim().toLocaleLowerCase();
        const identity = mention.assetId ? `asset:${mention.assetId}` : `node:${mention.id}`;
        const owner = aliasSources.get(alias);
        if (owner && owner !== identity) return false;
        aliasSources.set(alias, identity);
        return true;
    });
    if (resolvable.length === 0) return false;

    const reboundMentions = resolvePasted?.(resolvable.map(item => item.mention))
        || resolvable.map(item => item.mention);
    const resolved: Array<MentionData | null> = mentions.map(() => null);
    resolvable.forEach((item, index) => { resolved[item.index] = reboundMentions[index] || null; });
    let mentionIndex = 0;
    const rebound = rebindPromptDocument(hydrated.document, () => resolved[mentionIndex++] || null);
    try {
        editor.setDocument(rebound.document);
        return true;
    } catch {
        return false;
    }
}

export default RichPromptEditor;

function editorStyles(): string {
    return `
.rich-prompt-editor {
    position: relative;
    flex: 1;
    min-height: var(--prompt-editor-min-height, 22px);
    max-height: var(--prompt-editor-max-height, 160px);
    overflow-y: auto;
    outline: none;
    font-size: var(--prompt-editor-font-size, 13px);
    line-height: var(--prompt-editor-line-height, 1.5);
    color: var(--prompt-editor-color, #111827) !important;
    caret-color: var(--prompt-editor-caret, #4f46e5);
    padding: var(--prompt-editor-padding, 0 4px);
    word-break: break-word;
    background: transparent;
    white-space: pre-wrap;
}

.rich-prompt-editor,
.rich-prompt-editor .ProseMirror,
.rich-prompt-editor .ProseMirror *,
.rich-prompt-editor p,
.rich-prompt-editor span:not(.mention-node span) {
    color: var(--prompt-editor-color, #111827) !important;
}

.rich-prompt-editor .mention-node span {
    color: #4F46E5 !important;
}

.rich-prompt-editor p {
    margin: 0;
    padding: 0;
}

/* Placeholder when editor is empty */
.rich-prompt-editor.ProseMirror:empty:before,
.rich-prompt-editor.ProseMirror:has(> p:only-child:empty):before,
.rich-prompt-editor.ProseMirror:has(> p:only-child > br.ProseMirror-trailingBreak:only-child):before {
    content: attr(data-placeholder);
    color: var(--prompt-editor-placeholder, #9ca3af) !important;
    pointer-events: none;
    position: absolute;
    inset-inline-start: 4px;
    top: 0;
}

.tippy-box[data-theme~='light-border'] {
    background-color: transparent;
    box-shadow: none;
    border: none;
    padding: 0;
}

.tippy-box[data-theme~='light-border'] .tippy-content {
    padding: 0;
}

.rich-prompt-editor::-webkit-scrollbar {
    width: 3px;
}

.rich-prompt-editor::-webkit-scrollbar-thumb {
    background: var(--prompt-editor-scrollbar, #e5e7eb);
    border-radius: 2px;
}
`;
}
