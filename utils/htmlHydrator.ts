import type { CanvasElement } from '../types';

type TiptapJSONNode = {
    type: string;
    attrs?: Record<string, unknown>;
    text?: string;
    content?: TiptapJSONNode[];
};

const mentionTokenRegex = /(@[a-zA-Z0-9_\u4e00-\u9fa5-]+)/g;

const escapeHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const buildEmptyDoc = (): Record<string, unknown> => ({
    type: 'doc',
    content: [{ type: 'paragraph' }],
});

const toMentionAttrs = (element: CanvasElement) => ({
    id: element.id,
    label: element.name?.trim() || element.id,
    thumbnail: element.type === 'image' ? element.href : '',
    elementType: element.type,
});

const pushTextNode = (content: TiptapJSONNode[], text: string): void => {
    if (!text) return;
    const previous = content[content.length - 1];
    if (previous?.type === 'text' && typeof previous.text === 'string') {
        previous.text += text;
        return;
    }
    content.push({ type: 'text', text });
};

const buildParagraphFromLine = (
    line: string,
    elements: CanvasElement[],
): { html: string; content: TiptapJSONNode[] } => {
    const fragments = line.split(mentionTokenRegex);
    const content: TiptapJSONNode[] = [];
    let html = '';

    for (const fragment of fragments) {
        if (!fragment) continue;

        if (fragment.startsWith('@')) {
            const targetName = fragment.slice(1).trim();
            const matchedElement = elements.find(element => element.name?.trim() === targetName);
            if (matchedElement) {
                const attrs = toMentionAttrs(matchedElement);
                content.push({
                    type: 'canvasMention',
                    attrs,
                });
                html += `<span data-canvas-mention="" data-id="${escapeHtml(String(attrs.id))}" data-label="${escapeHtml(String(attrs.label))}" data-element-type="${escapeHtml(String(attrs.elementType))}">${escapeHtml(fragment)}</span>`;
                continue;
            }
        }

        pushTextNode(content, fragment);
        html += escapeHtml(fragment);
    }

    return { html, content };
};

export const hydrateRawTextToTiptapJSON = (
    rawText: string,
    elements: CanvasElement[],
): { html: string; json: Record<string, unknown> } => {
    if (!rawText.trim()) {
        return { html: '', json: buildEmptyDoc() };
    }

    const lines = rawText.split(/\r?\n/);
    const paragraphs = lines.map((line) => {
        const paragraph = buildParagraphFromLine(line, elements);
        return {
            html: `<p>${paragraph.html}</p>`,
            node: {
                type: 'paragraph',
                ...(paragraph.content.length > 0 ? { content: paragraph.content } : {}),
            } satisfies TiptapJSONNode,
        };
    });

    return {
        html: paragraphs.map(item => item.html).join(''),
        json: {
            type: 'doc',
            content: paragraphs.map(item => item.node),
        },
    };
};

export const createEmptyPromptDocument = buildEmptyDoc;
