import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Extension } from '@tiptap/core';
import { DOMSerializer, Slice } from '@tiptap/pm/model';
import { Suggestion } from '@tiptap/suggestion';
import tippy, { type Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import ReactDOM from 'react-dom/client';
import MentionList, { type MentionItem, type AssetSuggestion, type MentionListHandle } from './MentionList';
import { MediaMentionNode, editorJSONToText, extractMentions, type MentionData } from './MediaMentionExtension';
import type { AssetFolder } from '../types';
import {
    decodePromptClipboard,
    encodePromptClipboard,
    FLOVART_PROMPT_CLIPBOARD_MIME,
    hydratePromptText,
    rebindPromptDocument,
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

function buildSuggestionExtension(
    getItems: (query: string) => MentionItem[],
    assetFoldersRef: { current: AssetFolder[] },
    assetItemsRef: { current: AssetSuggestion[] },
    onSelectAssetRef: { current: ((assetId: string) => string | undefined) | null },
    skillEnabled: boolean,
) {
    return Extension.create({
        name: 'mediaMentionSuggestion',
        addProseMirrorPlugins() {
            return [
                Suggestion({
                    editor: this.editor,
                    char: '@',
                    allowSpaces: false,
                    allowedPrefixes: null,
                    items: ({ query }) => getItems(query),
                    render() {
                        let reactRoot: ReactDOM.Root | null = null;
                        let container: HTMLElement | null = null;
                        let popup: TippyInstance[] | null = null;
                        let componentRef: React.RefObject<MentionListHandle> = React.createRef();
                        let currentQuery: string = '';

                        const renderList = (items: MentionItem[], command: (item: MentionItem) => void) => {
                            reactRoot?.render(
                                <MentionList
                                    ref={componentRef}
                                    connectedItems={items}
                                    assetFolders={assetFoldersRef.current}
                                    assetItems={assetItemsRef.current}
                                    query={currentQuery}
                                    command={command}
                                    skillEnabled={skillEnabled}
                                />
                            );
                        };

                        return {
                            onStart(props) {
                                console.log('[RichPromptEditor] @ onStart', { itemsCount: (props.items as MentionItem[])?.length, hasClientRect: !!props.clientRect });
                                currentQuery = (props.query as string) || '';
                                container = document.createElement('div');
                                document.body.appendChild(container);

                                componentRef = React.createRef<MentionListHandle>();
                                reactRoot = ReactDOM.createRoot(container);
                                renderList(props.items as MentionItem[], props.command);

                                popup = tippy('body', {
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
                                });
                            },
                            onUpdate(props) {
                                currentQuery = (props.query as string) || '';
                                renderList(props.items as MentionItem[], props.command);

                                if (popup?.[0] && props.clientRect) {
                                    popup[0].setProps({
                                        getReferenceClientRect: props.clientRect as () => DOMRect,
                                    });
                                }
                            },
                            onKeyDown(props) {
                                if (props.event.key === 'Escape') {
                                    popup?.[0]?.hide();
                                    return true;
                                }

                                return componentRef.current?.onKeyDown(props) ?? false;
                            },
                            onExit() {
                                popup?.[0]?.destroy();
                                popup = null;
                                setTimeout(() => {
                                    reactRoot?.unmount();
                                    container?.remove();
                                }, 0);
                            },
                        };
                    },
                    command({ editor, range, props }) {
                        const item = props as MentionItem;
                        let mentionId = item.id;
                        if (item.sourceType === 'assetLibrary' && item.assetId && onSelectAssetRef.current) {
                            const newNodeId = onSelectAssetRef.current(item.assetId);
                            if (!newNodeId) return;
                            mentionId = newNodeId;
                        }
                        editor
                            .chain()
                            .focus()
                            .deleteRange(range)
                            .insertContent({
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
                            })
                            .insertContent(' ')
                            .run();
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
    /** Skill 分区是否可用；本轮默认 false 仅显示占位 */
    skillEnabled?: boolean;
}

const RichPromptEditor = forwardRef<RichPromptEditorHandle, RichPromptEditorProps>(
    ({ referenceItems, pasteReferenceItems = referenceItems, placeholder = '输入提示词，@ 引用工作流节点或资产...', disabled, onTextChange, onSubmit, initialText = '', initialDocument, assetFolders = [], assetItems = [], onSelectAsset, onResolvePastedMentions, onPasteUnresolvedMentions, skillEnabled = false }, ref) => {
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
                buildSuggestionExtension(getFilteredItems, assetFoldersRef, assetItemsRef, onSelectAssetRef, skillEnabled),
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
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        onSubmit?.();
                        return true;
                    }
                    return false;
                },
                handlePaste(view, event) {
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
                editor.commands.setContent(buildDocFromText(text), false as unknown as Record<string, never>);
            },
            setDocument(document: Record<string, unknown>) {
                if (!editor) return;
                editor.commands.setContent(normalizeDocument('', document), false as unknown as Record<string, never>);
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
                <style>{editorStyles()}</style>
                <EditorContent editor={editor} />
            </>
        );
    }
);

RichPromptEditor.displayName = 'RichPromptEditor';

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
