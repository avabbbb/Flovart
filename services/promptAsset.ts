import type { WorkflowGenerationReferenceRole, WorkflowResourceKind } from '../components/workflow/types';
import type { PromptItem, PromptPack } from './promptApi';

export type PromptAssetModality = WorkflowResourceKind | 'mixed';
export type PromptAssetSourceKind = 'bundled' | 'local' | 'remote' | 'user';

export interface PromptAssetSource {
  kind: PromptAssetSourceKind;
  id: string;
  label?: string;
  url?: string;
}

export interface PromptAssetExample {
  title?: string;
  text: string;
}

export interface PromptAsset {
  id: string;
  title: string;
  text: string;
  tags: string[];
  modality: PromptAssetModality;
  modelHints?: string[];
  requiredReferenceRoles: WorkflowGenerationReferenceRole[];
  optionalReferenceRoles: WorkflowGenerationReferenceRole[];
  source: PromptAssetSource;
  examples: PromptAssetExample[];
}

const REFERENCE_ROLES: WorkflowGenerationReferenceRole[] = ['first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio'];
const CREDENTIAL_PATTERNS = [
  /(?:^|\s)(?:sk|rk)-[a-z0-9_-]{16,}/i,
  /AIza[0-9A-Za-z_-]{20,}/,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}/i,
  /\bapi[_-]?key\s*[:=]\s*[^\s,;]+/i,
];

type PromptAssetInput = Omit<Partial<PromptAsset>, 'source' | 'requiredReferenceRoles' | 'optionalReferenceRoles'> & {
  id: string;
  title: string;
  text: string;
  source: PromptAssetSource;
  requiredReferenceRoles?: unknown[];
  optionalReferenceRoles?: unknown[];
};

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function referenceRoles(values: unknown[]): WorkflowGenerationReferenceRole[] {
  return uniqueStrings(values).filter((value): value is WorkflowGenerationReferenceRole => REFERENCE_ROLES.includes(value as WorkflowGenerationReferenceRole));
}

function ensureNoCredential(text: string) {
  if (CREDENTIAL_PATTERNS.some(pattern => pattern.test(text))) throw new Error('PromptAsset 不得包含 API Key 或 Authorization 凭据。');
}

export function createPromptAsset(input: PromptAssetInput): PromptAsset {
  const id = input.id.trim();
  const title = input.title.trim();
  const text = input.text.trim();
  if (!id || !title || !text || !input.source.id.trim()) throw new Error('PromptAsset 必须包含 id、title、text 和 source.id。');
  ensureNoCredential(text);
  const examples = (input.examples || []).map(example => ({ title: example.title?.trim() || undefined, text: example.text.trim() })).filter(example => example.text);
  examples.forEach(example => ensureNoCredential(example.text));
  return {
    id,
    title,
    text,
    tags: uniqueStrings(input.tags || []),
    modality: input.modality || 'text',
    modelHints: uniqueStrings(input.modelHints || []),
    requiredReferenceRoles: referenceRoles(input.requiredReferenceRoles || []),
    optionalReferenceRoles: referenceRoles(input.optionalReferenceRoles || []),
    source: { kind: input.source.kind, id: input.source.id.trim(), label: input.source.label?.trim(), url: input.source.url?.trim() },
    examples,
  };
}

export function promptAssetFromPromptItem(pack: PromptPack, item: PromptItem, index = 0): PromptAsset {
  return createPromptAsset({
    id: `prompt:${pack.id}:${item.id || index}`,
    title: item.name || pack.title,
    text: item.prompt,
    tags: [...(pack.tags || []), ...(item.tags || [])],
    modality: item.modality || pack.mode,
    modelHints: item.modelHints,
    requiredReferenceRoles: item.requiredReferenceRoles as WorkflowGenerationReferenceRole[] | undefined,
    optionalReferenceRoles: item.optionalReferenceRoles as WorkflowGenerationReferenceRole[] | undefined,
    examples: item.examples,
    source: { kind: 'remote', id: pack.id, label: pack.title },
  });
}

export function promptAssetsFromPromptPack(pack: PromptPack): PromptAsset[] {
  return (pack.items || []).map((item, index) => promptAssetFromPromptItem(pack, item, index));
}

export function promptAssetFromQuickPrompt(input: { id: string; title: string; text: string; tags?: string[]; modality?: PromptAssetModality }): PromptAsset {
  return createPromptAsset({
    ...input,
    source: { kind: 'bundled', id: input.id, label: 'Flovart 快速提示词' },
  });
}

export function searchPromptAssets(assets: PromptAsset[], query = '', modality?: PromptAssetModality): PromptAsset[] {
  const normalized = query.trim().toLowerCase();
  return assets.filter(asset => (!modality || asset.modality === modality) && (!normalized || [asset.title, asset.text, ...asset.tags, ...(asset.modelHints || [])].some(value => value.toLowerCase().includes(normalized))));
}
