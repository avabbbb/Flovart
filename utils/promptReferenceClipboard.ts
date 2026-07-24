export const FLOVART_PROMPT_CLIPBOARD_MIME = 'application/x-flovart-prompt+json';

export interface PromptReferenceMention {
  id: string;
  label: string;
  thumbnail: string;
  elementType: string;
  description?: string;
  sourceType?: 'connected' | 'assetLibrary';
  assetId?: string;
}

export interface PromptClipboardPayload {
  version: 1;
  plainText: string;
  document: Record<string, unknown>;
}

export interface PromptPasteResult {
  plainText: string;
  document: Record<string, unknown>;
  mentionedElementIds: string[];
  unresolvedLabels: string[];
}

function promptDocumentToText(document: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (node: Record<string, unknown>) => {
    if (node.type === 'text') parts.push(typeof node.text === 'string' ? node.text : '');
    else if (node.type === 'mediaMention') {
      const attrs = node.attrs as Partial<PromptReferenceMention> | undefined;
      parts.push(`@${attrs?.label || ''}`);
    } else if (node.type === 'hardBreak') parts.push('\n');
    else if (Array.isArray(node.content)) {
      (node.content as Record<string, unknown>[]).forEach(walk);
      if (node.type === 'paragraph') parts.push('\n');
    }
  };
  walk(document);
  return parts.join('').replace(/\n$/, '');
}

export function encodePromptClipboard(document: Record<string, unknown>): string {
  const sanitize = (node: Record<string, unknown>): Record<string, unknown> => {
    if (node.type === 'mediaMention' && node.attrs) {
      const attrs = { ...node.attrs as Record<string, unknown> };
      if ('thumbnail' in attrs) attrs.thumbnail = '';
      return { ...node, attrs };
    }
    return Array.isArray(node.content)
      ? { ...node, content: (node.content as Record<string, unknown>[]).map(sanitize) }
      : { ...node };
  };
  const portableDocument = sanitize(document);
  return JSON.stringify({
    version: 1,
    plainText: promptDocumentToText(portableDocument),
    document: portableDocument,
  } satisfies PromptClipboardPayload);
}

export function decodePromptClipboard(value: string): PromptClipboardPayload | null {
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as Partial<PromptClipboardPayload>;
    if (payload.version !== 1 || typeof payload.plainText !== 'string' || !payload.document || payload.document.type !== 'doc') return null;
    return payload as PromptClipboardPayload;
  } catch {
    return null;
  }
}

export function rebindPromptDocument(
  document: Record<string, unknown>,
  resolveMention: (mention: PromptReferenceMention) => PromptReferenceMention | null,
): PromptPasteResult {
  const mentionedElementIds: string[] = [];
  const unresolvedLabels: string[] = [];
  const aliasOwners = new Map<string, string>();
  const rewrite = (node: Record<string, unknown>): Record<string, unknown> => {
    if (node.type === 'mediaMention' && node.attrs) {
      const mention = node.attrs as unknown as PromptReferenceMention;
      const resolved = resolveMention(mention);
      const aliasKey = resolved?.label.trim().toLocaleLowerCase() || '';
      const aliasOwner = aliasKey ? aliasOwners.get(aliasKey) : undefined;
      if (!resolved || (aliasOwner && aliasOwner !== resolved.id)) {
        if (mention.label && !unresolvedLabels.includes(mention.label)) unresolvedLabels.push(mention.label);
        return { type: 'text', text: `@${mention.label}` };
      }
      if (aliasKey) aliasOwners.set(aliasKey, resolved.id);
      if (resolved.id && !mentionedElementIds.includes(resolved.id)) mentionedElementIds.push(resolved.id);
      return { ...node, attrs: { ...node.attrs as Record<string, unknown>, ...resolved } };
    }
    if (!Array.isArray(node.content)) return { ...node };
    return { ...node, content: (node.content as Record<string, unknown>[]).map(rewrite) };
  };
  const rebound = rewrite(document);
  return {
    plainText: promptDocumentToText(rebound),
    document: rebound,
    mentionedElementIds,
    unresolvedLabels,
  };
}

export function hydratePromptText(plainText: string, candidates: PromptReferenceMention[]): PromptPasteResult {
  const grouped = new Map<string, PromptReferenceMention[]>();
  for (const candidate of candidates) {
    const label = candidate.label.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    grouped.set(key, [...(grouped.get(key) || []), { ...candidate, label }]);
  }
  const labels = [...grouped.keys()].sort((left, right) => right.length - left.length);
  const mentionedElementIds: string[] = [];
  const unresolvedLabels: string[] = [];
  const paragraphs = plainText.split('\n').map(line => {
    const content: Record<string, unknown>[] = [];
    let buffer = '';
    const flush = () => {
      if (!buffer) return;
      content.push({ type: 'text', text: buffer });
      buffer = '';
    };
    for (let index = 0; index < line.length;) {
      if (line[index] !== '@') {
        buffer += line[index++];
        continue;
      }
      const tail = line.slice(index + 1).toLocaleLowerCase();
      const matchedLabel = labels.find(label => {
        if (!tail.startsWith(label)) return false;
        const next = line[index + 1 + label.length];
        const last = label[label.length - 1];
        return !(next && /[A-Za-z0-9_]/.test(next) && /[A-Za-z0-9_]/.test(last));
      });
      if (!matchedLabel) {
        buffer += line[index++];
        continue;
      }
      const matches = grouped.get(matchedLabel) || [];
      const visibleLabel = line.slice(index + 1, index + 1 + matchedLabel.length);
      if (matches.length !== 1) {
        buffer += `@${visibleLabel}`;
        if (visibleLabel && !unresolvedLabels.includes(visibleLabel)) unresolvedLabels.push(visibleLabel);
      } else {
        flush();
        const mention = matches[0];
        content.push({ type: 'mediaMention', attrs: mention });
        if (mention.id && !mentionedElementIds.includes(mention.id)) mentionedElementIds.push(mention.id);
      }
      index += matchedLabel.length + 1;
    }
    flush();
    return { type: 'paragraph', content };
  });
  const document = { type: 'doc', content: paragraphs };
  return { plainText, document, mentionedElementIds, unresolvedLabels };
}

export function getPromptReferenceAliases(document?: Record<string, unknown>): Record<string, string> {
  if (!document) return {};
  const aliases: Record<string, string> = {};
  const walk = (node: Record<string, unknown>) => {
    if (node.type === 'mediaMention' && node.attrs) {
      const mention = node.attrs as Partial<PromptReferenceMention>;
      if (mention.id && mention.label && !aliases[mention.id]) aliases[mention.id] = mention.label;
    }
    if (Array.isArray(node.content)) (node.content as Record<string, unknown>[]).forEach(walk);
  };
  walk(document);
  return aliases;
}
