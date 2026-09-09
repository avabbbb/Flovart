import type { ProductModelMode } from '../../types';
import { findWorkflowNodeDefinition } from './resourceContract';
import type { PromptIntent } from './promptIntent';
import type {
  SeedanceReferences,
  WorkflowArtifactRef,
  WorkflowConnection,
  WorkflowGenerationReferenceRole,
  WorkflowGenerationMode,
  WorkflowNode,
  WorkflowResource,
  WorkflowResourceKind,
  WorkflowResourceLocator,
  WorkflowResourceReference,
} from './types';

export type GenerationReferenceOrigin = 'graph' | 'mention' | 'asset' | 'runtime-artifact' | 'creative-host';

export type WorkflowGenerationCapability =
  | 'text-generate'
  | 'audio-generate'
  | 'text-to-image'
  | 'image-edit'
  | 'text-to-video'
  | 'image-to-video'
  | 'reference-to-video'
  | 'first-last-frame'
  | 'video-extension';

export interface WorkflowMentionReferenceInput {
  id?: string;
  label?: string;
  elementType?: string;
  sourceType?: string;
  assetId?: string;
  role?: WorkflowGenerationReferenceRole;
}

export interface WorkflowAssetReferenceInput {
  id: string;
  name?: string;
  mimeType?: string;
  kind?: Extract<WorkflowResourceKind, 'image' | 'video' | 'audio'>;
}

export interface WorkflowInputResolutionOptions {
  /** PromptBar/Agent 的稳定意图；提供后优先于节点上的旧 mention 投影。 */
  promptIntent?: Pick<PromptIntent, 'targetNodeId' | 'text' | 'mentions'>;
  /** 测试、Agent 或未来无 UI 入口可直接提供的 mention；未提供时读取节点富文本。 */
  mentions?: readonly WorkflowMentionReferenceInput[];
  /** 只提供轻量 Asset 索引；真实媒体仍由 ExecutableResourceResolver 按 asset id hydrate。 */
  assets?: readonly WorkflowAssetReferenceInput[];
  /** 旧 Seedance 槽位只在此处映射为 canonical 的选择集合，不得继续传给 Provider。 */
  legacySeedanceRefs?: SeedanceReferences;
}

export interface InputDiagnostic {
  code: 'UNRESOLVED_MENTION' | 'ROLE_CONFLICT' | 'MISSING_RESOURCE';
  severity: 'warning' | 'error';
  message: string;
  resourceId?: string;
  sourceId?: string;
}

export interface ResolvedWorkflowResource {
  resource: WorkflowResource;
  resourceId: string;
  reference: WorkflowResourceReference;
  sourceNodeId: string;
  connectionId?: string;
  title: string;
  kind: WorkflowResourceKind;
  available: boolean;
  locator: WorkflowResourceLocator;
  text?: string;
  /** @deprecated Phase C 会移除这些 compatibility projection，执行层应改读 resource/locator。 */
  href?: string;
  assetId?: string;
  storageKey?: string;
  artifactRef?: WorkflowArtifactRef;
  mimeType?: string;
}

export type WorkflowMediaResource = ResolvedWorkflowResource & {
  kind: Exclude<WorkflowResourceKind, 'text'>;
};

export interface GenerationReference {
  resource: WorkflowMediaResource;
  role: WorkflowGenerationReferenceRole;
  /** 输入契约中显式声明的角色；role 可能在 canonical 阶段按 capability 重排。 */
  declaredRole?: WorkflowGenerationReferenceRole;
  order?: number;
  origin: GenerationReferenceOrigin;
  /** Prompt 中的稳定可读别名只属于 canonical manifest，不是 Provider 专属字段。 */
  label?: string;
}

export interface CanonicalGenerationReference extends GenerationReference {
  order: number;
}

export interface CanonicalGenerationParameters {
  modelId?: string;
  generationSubmode?: ProductModelMode;
  aspectRatio?: string;
  durationSec?: number;
  resolution?: string;
  quality?: string;
  generateAudio?: boolean;
  watermark?: boolean;
}

export interface CanonicalGenerationInput {
  nodeId: string;
  capability: WorkflowGenerationCapability;
  prompt: string;
  textInputs: ResolvedWorkflowResource[];
  references: CanonicalGenerationReference[];
  parameters: CanonicalGenerationParameters;
  diagnostics: InputDiagnostic[];
}

export interface ResolvedNodeInputs {
  nodeId: string;
  prompt: string;
  resources: ResolvedWorkflowResource[];
  texts: ResolvedWorkflowResource[];
  images: ResolvedWorkflowResource[];
  videos: ResolvedWorkflowResource[];
  audios: ResolvedWorkflowResource[];
  references: GenerationReference[];
  diagnostics: InputDiagnostic[];
  /** 只用于决定“所有图都被 @ 提及时”的稳定顺序，不是 Provider 输入。 */
  mentionResourceIds: string[];
  /** legacy seedanceRefs 映射后的选择集合；Provider 不会看到原字段。 */
  legacySourceNodeIds: string[];
}

/** 旧名称保留给已有 Graph/Operation 工具调用；生成路径统一使用 ResolvedNodeInputs。 */
export type ResolvedWorkflowInputs = ResolvedNodeInputs;

const MEDIA_KINDS = new Set<WorkflowResourceKind>(['image', 'video', 'audio']);
const REFERENCE_ROLES = new Set<WorkflowGenerationReferenceRole>([
  'first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio',
]);

function isMediaResource(resource: ResolvedWorkflowResource): resource is WorkflowMediaResource {
  return MEDIA_KINDS.has(resource.kind);
}

function isReferenceRole(value: unknown): value is WorkflowGenerationReferenceRole {
  return typeof value === 'string' && REFERENCE_ROLES.has(value as WorkflowGenerationReferenceRole);
}

function connectionInputRole(role?: WorkflowConnection['role']): WorkflowGenerationReferenceRole | undefined {
  if (role === 'source_image') return 'first_frame';
  if (role === 'reference_image') return 'reference';
  if (role === 'mask_image') return 'mask';
  if (role === 'source_video') return 'source_video';
  if (role === 'source_audio') return 'source_audio';
  return undefined;
}

function legacyResourceFields(locator: WorkflowResourceLocator): Pick<ResolvedWorkflowResource, 'href' | 'assetId' | 'storageKey' | 'artifactRef'> {
  const fields: Pick<ResolvedWorkflowResource, 'href' | 'assetId' | 'storageKey' | 'artifactRef'> = {
    href: undefined,
    assetId: undefined,
    storageKey: undefined,
    artifactRef: undefined,
  };
  if (locator.kind === 'asset') fields.assetId = locator.assetId;
  if (locator.kind === 'workflow-storage') fields.storageKey = locator.storageKey;
  if (locator.kind === 'runtime-artifact') fields.artifactRef = locator.artifactRef;
  if (locator.kind === 'remote-url' || locator.kind === 'legacy-href') fields.href = locator.href;
  return fields;
}

function resolveNodeResources(node: WorkflowNode, connection: WorkflowConnection): ResolvedWorkflowResource[] {
  const definition = findWorkflowNodeDefinition(node.type);
  if (!definition) return [];
  return definition.output(node).map(resource => {
    const { locator } = resource;
    const legacy = legacyResourceFields(locator);
    const sourceId = locator.kind === 'asset' ? locator.assetId : node.id;
    const reference: WorkflowResourceReference = {
      id: connection.id,
      resourceId: resource.resourceId,
      resourceOrigin: locator.kind === 'asset' ? 'asset' : locator.kind === 'creative-host' ? 'creative-host' : 'node',
      sourceId,
      kind: resource.kind,
      source: 'edge',
      role: connectionInputRole(connection.role),
      connectionId: connection.id,
    };
    return {
      resource,
      resourceId: resource.resourceId,
      reference,
      sourceNodeId: node.id,
      connectionId: connection.id,
      title: resource.title,
      kind: resource.kind,
      available: locator.kind !== 'missing',
      locator,
      text: locator.kind === 'inline-text' ? locator.text : undefined,
      ...legacy,
      mimeType: resource.mimeType || (locator.kind === 'runtime-artifact' ? locator.artifactRef.mimeType : undefined),
    };
  });
}

function resourceIdentity(resource: ResolvedWorkflowResource): string {
  switch (resource.locator.kind) {
    case 'asset': return `asset:${resource.locator.assetId}`;
    case 'workflow-storage': return `storage:${resource.locator.storageKey}`;
    case 'runtime-artifact': return `artifact:${resource.locator.artifactRef.artifactId || resource.locator.artifactRef.taskId}:${resource.locator.artifactRef.outputIndex ?? 0}`;
    case 'creative-host': return `host:${resource.locator.host}:${JSON.stringify(Object.entries(resource.locator.locator).sort(([left], [right]) => left.localeCompare(right)))}`;
    case 'remote-url': return `remote:${resource.resourceId}`;
    case 'legacy-href': return `legacy:${resource.locator.href}`;
    case 'inline-text': return `text:${resource.resourceId}`;
    case 'missing': return `missing:${resource.resourceId}`;
  }
}

function resourceKindFromMention(mention: WorkflowMentionReferenceInput, asset?: WorkflowAssetReferenceInput): Extract<WorkflowResourceKind, 'image' | 'video' | 'audio'> | undefined {
  if (asset?.kind) return asset.kind;
  if (asset?.mimeType?.startsWith('video/')) return 'video';
  if (asset?.mimeType?.startsWith('audio/')) return 'audio';
  if (asset?.mimeType?.startsWith('image/')) return 'image';
  if (mention.elementType === 'image' || mention.elementType === 'video' || mention.elementType === 'audio') return mention.elementType;
  return undefined;
}

function extractDocumentMentions(document?: Record<string, unknown>): WorkflowMentionReferenceInput[] {
  if (!document) return [];
  const result: WorkflowMentionReferenceInput[] = [];
  const walk = (node: Record<string, unknown>) => {
    if (node.type === 'mediaMention' && node.attrs && typeof node.attrs === 'object') {
      const attrs = node.attrs as Record<string, unknown>;
      const role = isReferenceRole(attrs.role) ? attrs.role : undefined;
      if (typeof attrs.id === 'string' || typeof attrs.assetId === 'string') {
        result.push({
          id: typeof attrs.id === 'string' ? attrs.id : undefined,
          label: typeof attrs.label === 'string' ? attrs.label : undefined,
          elementType: typeof attrs.elementType === 'string' ? attrs.elementType : undefined,
          sourceType: typeof attrs.sourceType === 'string' ? attrs.sourceType : undefined,
          assetId: typeof attrs.assetId === 'string' ? attrs.assetId : undefined,
          role,
        });
      }
    }
    if (Array.isArray(node.content)) (node.content as Record<string, unknown>[]).forEach(walk);
  };
  walk(document);
  return result;
}

function addMentionAlias(aliases: Map<string, string[]>, label: string, resourceId: string) {
  const key = label.trim().toLocaleLowerCase();
  if (!key) return;
  const current = aliases.get(key) || [];
  if (!current.includes(resourceId)) current.push(resourceId);
  aliases.set(key, current);
}

function mentionAliases(resources: WorkflowMediaResource[]): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  const counters = { image: 0, video: 0, audio: 0 };
  resources.forEach(resource => {
    addMentionAlias(aliases, resource.title, resourceIdentity(resource));
    if (resource.kind === 'image') addMentionAlias(aliases, `图片${++counters.image}`, resourceIdentity(resource));
    if (resource.kind === 'video') addMentionAlias(aliases, `视频${++counters.video}`, resourceIdentity(resource));
    if (resource.kind === 'audio') addMentionAlias(aliases, `音频${++counters.audio}`, resourceIdentity(resource));
  });
  return aliases;
}

function plainTextMentionInputs(prompt: string, resources: WorkflowMediaResource[]): WorkflowMentionReferenceInput[] {
  if (!prompt.includes('@')) return [];
  const aliases = mentionAliases(resources);
  const matches: Array<{ index: number; label: string; resourceId: string }> = [];
  aliases.forEach((resourceIds, label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`@${escaped}(?![\\p{L}\\p{N}_-])`, 'giu');
    for (const match of prompt.matchAll(expression)) {
      if (resourceIds.length === 1 && match.index !== undefined) matches.push({ index: match.index, label, resourceId: resourceIds[0] });
    }
  });
  return matches
    .sort((left, right) => left.index - right.index)
    .map(match => ({ id: match.resourceId, label: match.label }));
}

function assetResource(mention: WorkflowMentionReferenceInput, asset: WorkflowAssetReferenceInput): ResolvedWorkflowResource {
  const kind = resourceKindFromMention(mention, asset) || 'image';
  const resource: WorkflowResource = {
    resourceId: `asset:${asset.id}`,
    title: asset.name || mention.label || asset.id,
    kind,
    locator: { kind: 'asset', assetId: asset.id },
    mimeType: asset.mimeType,
  };
  return {
    resource,
    resourceId: resource.resourceId,
    reference: {
      id: resource.resourceId,
      resourceId: resource.resourceId,
      resourceOrigin: 'asset',
      sourceId: resource.resourceId,
      kind,
      source: 'mention',
      role: mention.role,
    },
    sourceNodeId: resource.resourceId,
    title: resource.title,
    kind,
    available: true,
    locator: resource.locator,
    ...legacyResourceFields(resource.locator),
    mimeType: resource.mimeType,
  };
}

function mediaOrigin(resource: ResolvedWorkflowResource): GenerationReferenceOrigin {
  if (resource.locator.kind === 'asset') return 'asset';
  if (resource.locator.kind === 'runtime-artifact') return 'runtime-artifact';
  if (resource.locator.kind === 'creative-host') return 'creative-host';
  return 'graph';
}

function diagnostic(diagnostics: InputDiagnostic[], value: InputDiagnostic) {
  const duplicate = diagnostics.some(item => item.code === value.code && item.resourceId === value.resourceId && item.sourceId === value.sourceId && item.message === value.message);
  if (!duplicate) diagnostics.push(value);
}

interface ReferenceAccumulator {
  resource: WorkflowMediaResource;
  role: WorkflowGenerationReferenceRole;
  explicitRole?: WorkflowGenerationReferenceRole;
  origin: GenerationReferenceOrigin;
  order: number;
  label?: string;
}

function addReference(
  references: Map<string, ReferenceAccumulator>,
  resource: WorkflowMediaResource,
  origin: GenerationReferenceOrigin,
  order: number,
  diagnostics: InputDiagnostic[],
  options: { role?: WorkflowGenerationReferenceRole; label?: string },
) {
  const key = resourceIdentity(resource);
  const existing = references.get(key);
  const role = options.role || resource.reference.role || 'reference';
  if (!existing) {
    references.set(key, {
      resource,
      role,
      explicitRole: options.role || resource.reference.role,
      origin,
      order,
      label: options.label,
    });
    return;
  }
  const nextExplicitRole = options.role || resource.reference.role;
  if (existing.explicitRole && nextExplicitRole && existing.explicitRole !== nextExplicitRole) {
    diagnostic(diagnostics, {
      code: 'ROLE_CONFLICT',
      severity: 'error',
      resourceId: existing.resource.resourceId,
      sourceId: existing.resource.sourceNodeId,
      message: `资源「${existing.resource.title}」同时声明了「${existing.explicitRole}」和「${nextExplicitRole}」两个输入角色。请只保留一个明确角色。`,
    });
  }
  if (!existing.explicitRole && nextExplicitRole) {
    existing.explicitRole = nextExplicitRole;
    existing.role = nextExplicitRole;
  }
  if (!existing.label && options.label) existing.label = options.label;
  if (existing.origin === 'mention' && origin !== 'mention') existing.origin = origin;
}

function dedupeResources(resources: ResolvedWorkflowResource[]): ResolvedWorkflowResource[] {
  const seen = new Set<string>();
  return resources.filter(resource => {
    const key = resourceIdentity(resource);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function legacySourceIds(refs: SeedanceReferences | undefined, resources: ResolvedWorkflowResource[]): string[] {
  if (!refs) return [];
  const candidates = new Set(resources.filter(isMediaResource).map(resource => resource.sourceNodeId));
  return [...new Set([...refs.imageRefs, ...refs.videoRefs, ...refs.audioRefs].filter(id => candidates.has(id)))];
}

function legacyReferenceValue(targetNode: WorkflowNode, options?: WorkflowInputResolutionOptions) {
  return options?.legacySeedanceRefs ?? targetNode.metadata.config?.seedanceRefs;
}

/** 把 Graph 引用解析成带来源身份的资源引用；旧 metadata 只在本模块内作为过渡输入。 */
export function resolveWorkflowResourceReferences(targetNode: WorkflowNode, nodes: WorkflowNode[], connections: WorkflowConnection[]) {
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  return connections
    .filter(connection => connection.toNodeId === targetNode.id && connection.fromNodeId !== targetNode.id)
    .flatMap(connection => {
      const sourceNode = nodesById.get(connection.fromNodeId);
      return sourceNode ? resolveNodeResources(sourceNode, connection).map(resource => resource.reference) : [];
    });
}

/**
 * 唯一的 Graph + Mention + Asset -> ResolvedNodeInputs 入口。
 * Graph 是默认候选；Mention/Asset 只补充来源、别名和排序，不再替 Provider 组装另一份引用数组。
 */
export function resolveWorkflowInputs(
  targetNode: WorkflowNode,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  options?: WorkflowInputResolutionOptions,
): ResolvedNodeInputs {
  const promptIntent = options?.promptIntent?.targetNodeId === targetNode.id ? options.promptIntent : undefined;
  const prompt = promptIntent?.text ?? targetNode.metadata.prompt ?? targetNode.metadata.content ?? '';
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const graphResources = connections
    .filter(connection => connection.toNodeId === targetNode.id && connection.fromNodeId !== targetNode.id)
    .flatMap(connection => {
      const sourceNode = nodesById.get(connection.fromNodeId);
      return sourceNode ? resolveNodeResources(sourceNode, connection) : [];
    });
  const diagnostics: InputDiagnostic[] = [];
  graphResources.filter(isMediaResource).forEach(resource => {
    if (!resource.available) diagnostic(diagnostics, {
      code: 'MISSING_RESOURCE',
      severity: 'warning',
      resourceId: resource.resourceId,
      sourceId: resource.sourceNodeId,
      message: `资源「${resource.title}」已声明但没有可执行媒体。`,
    });
  });

  const graphMedia = graphResources.filter(isMediaResource);
  const resources = dedupeResources([
    ...graphResources.filter(resource => resource.kind === 'text'),
    ...graphMedia,
  ]);
  const media = resources.filter(isMediaResource);
  const graphByNodeId = new Map<string, ResolvedWorkflowResource>();
  const graphByAssetId = new Map<string, ResolvedWorkflowResource>();
  const graphByIdentity = new Map<string, ResolvedWorkflowResource>();
  graphResources.forEach(resource => {
    if (!graphByNodeId.has(resource.sourceNodeId)) graphByNodeId.set(resource.sourceNodeId, resource);
    if (resource.locator.kind === 'asset' && !graphByAssetId.has(resource.locator.assetId)) graphByAssetId.set(resource.locator.assetId, resource);
    if (!graphByIdentity.has(resourceIdentity(resource))) graphByIdentity.set(resourceIdentity(resource), resource);
  });

  const assetById = new Map((options?.assets || []).map(asset => [asset.id, asset]));
  const references = new Map<string, ReferenceAccumulator>();
  graphMedia.forEach((resource, order) => {
    addReference(references, resource, mediaOrigin(resource), order, diagnostics, {});
  });

  const mentionResourceIds: string[] = [];
  const mentionIdentities = new Set<string>();
  const mentionInputs = promptIntent
    ? promptIntent.mentions
    : options?.mentions
    ? [...options.mentions]
    : extractDocumentMentions(targetNode.metadata.richTextDocument);
  const addMention = (mention: WorkflowMentionReferenceInput) => {
    let source = mention.id ? graphByNodeId.get(mention.id) || graphByIdentity.get(mention.id) : undefined;
    if (!source && mention.assetId) source = graphByAssetId.get(mention.assetId);
    if (!source && mention.assetId) {
      const asset = assetById.get(mention.assetId);
      if (asset) {
        source = assetResource(mention, asset);
        resources.push(source);
      }
    }
    if (!source || !isMediaResource(source)) {
      const sourceId = mention.id || mention.assetId;
      diagnostic(diagnostics, {
        code: 'UNRESOLVED_MENTION',
        severity: 'warning',
        sourceId,
        message: `提示词引用「${mention.label || sourceId || '未命名资源'}」没有对应的可达媒体资源。`,
      });
      return;
    }
    const identity = resourceIdentity(source);
    if (!mentionIdentities.has(identity)) {
      mentionIdentities.add(identity);
      mentionResourceIds.push(identity);
    }
    addReference(references, source, mediaOrigin(source), mentionResourceIds.length - 1, diagnostics, {
      role: mention.role,
      label: mention.label,
    });
  };

  mentionInputs.forEach(addMention);
  plainTextMentionInputs(prompt, media).forEach(addMention);

  const orderedResources = resources;
  const hasMentionSelection = mentionIdentities.size > 0;
  const resolvedReferences = [...references.values()]
    .filter(reference => reference.resource.available)
    .filter(reference => !hasMentionSelection || Boolean(reference.resource.reference.role) || mentionIdentities.has(resourceIdentity(reference.resource)))
    .sort((left, right) => left.order - right.order)
    .map(reference => ({
      resource: reference.resource,
      role: reference.role,
      declaredRole: reference.explicitRole,
      order: reference.order,
      origin: reference.origin,
      label: reference.label,
    } satisfies GenerationReference));
  const legacySourceNodeIds = legacySourceIds(legacyReferenceValue(targetNode, options), orderedResources);
  return {
    nodeId: targetNode.id,
    prompt,
    resources: orderedResources,
    texts: orderedResources.filter(resource => resource.kind === 'text'),
    images: orderedResources.filter(resource => resource.kind === 'image'),
    videos: orderedResources.filter(resource => resource.kind === 'video'),
    audios: orderedResources.filter(resource => resource.kind === 'audio'),
    references: resolvedReferences,
    diagnostics,
    mentionResourceIds,
    legacySourceNodeIds,
  };
}

function canonicalRole(reference: GenerationReference, index: number, mode: WorkflowGenerationMode, submode?: ProductModelMode): WorkflowGenerationReferenceRole {
  const { resource } = reference;
  const explicitRole = reference.declaredRole || resource.reference.role;
  if (submode === 'first-last-frame') {
    if (explicitRole === 'first_frame' && index === 0) return explicitRole;
    if (explicitRole === 'last_frame' && index === 1) return explicitRole;
    return index === 0 ? 'first_frame' : 'last_frame';
  }
  if (explicitRole) return explicitRole;
  const kind = resource.kind;
  if (mode === 'image') return 'reference';
  if (mode !== 'video') return kind === 'audio' ? 'source_audio' : kind === 'video' ? 'source_video' : 'reference';
  if (submode === 'image-to-video') return index === 0 ? 'first_frame' : 'reference';
  if (kind === 'video') return 'source_video';
  if (kind === 'audio') return 'source_audio';
  return 'reference';
}

function canonicalCapability(mode: WorkflowGenerationMode, submode: ProductModelMode | undefined, references: WorkflowMediaResource[]): WorkflowGenerationCapability {
  if (mode === 'text') return 'text-generate';
  if (mode === 'audio') return 'audio-generate';
  if (mode === 'image') return submode === 'image-to-image' || references.length > 0 ? 'image-edit' : 'text-to-image';
  if (submode === 'first-last-frame') return 'first-last-frame';
  if (submode === 'video-extension') return 'video-extension';
  if (submode === 'reference-to-video') return 'reference-to-video';
  if (submode === 'image-to-video') return 'image-to-video';
  return references.length > 0 ? (references.some(resource => resource.kind !== 'image') || references.filter(resource => resource.kind === 'image').length > 1 ? 'reference-to-video' : 'image-to-video') : 'text-to-video';
}

function defaultGenerationSubmode(mode: WorkflowGenerationMode, references: WorkflowMediaResource[]): ProductModelMode | undefined {
  if (mode === 'image') return references.length > 0 ? 'image-to-image' : 'text-to-image';
  if (mode !== 'video') return undefined;
  if (references.length === 0) return 'text-to-video';
  return references.some(resource => resource.kind !== 'image') || references.filter(resource => resource.kind === 'image').length > 1
    ? 'reference-to-video'
    : 'image-to-video';
}

/**
 * 把 ResolvedNodeInputs 冻结为 Provider 无关的 canonical 输入。
 * 进入本函数后，Provider 层不需要也不允许重新读取 Canvas 状态。
 */
export function buildCanonicalGenerationInput(input: {
  targetNode: WorkflowNode;
  inputs: ResolvedNodeInputs;
  prompt: string;
  mode: WorkflowGenerationMode;
  submode?: ProductModelMode;
  selectedSourceNodeIds?: readonly string[];
  parameters?: Partial<CanonicalGenerationParameters>;
}): CanonicalGenerationInput {
  const selectedSourceNodeIds = input.selectedSourceNodeIds?.length ? input.selectedSourceNodeIds : input.inputs.legacySourceNodeIds;
  const selectedIds = selectedSourceNodeIds.length ? new Set(selectedSourceNodeIds) : null;
  const selectedOrder = selectedIds ? new Map(selectedSourceNodeIds.map((id, index) => [id, index])) : null;
  let candidates = input.inputs.references
    .filter(reference => reference.resource.available)
    .filter(reference => !selectedIds || selectedIds.has(reference.resource.sourceNodeId) || selectedIds.has(reference.resource.reference.sourceId));

  if (!selectedIds && input.inputs.mentionResourceIds.length > 0 && input.inputs.mentionResourceIds.length === candidates.length && !candidates.some(reference => reference.resource.reference.role)) {
    const mentionOrder = new Map(input.inputs.mentionResourceIds.map((id, index) => [id, index]));
    candidates = [...candidates].sort((left, right) => (mentionOrder.get(resourceIdentity(left.resource)) ?? Number.MAX_SAFE_INTEGER) - (mentionOrder.get(resourceIdentity(right.resource)) ?? Number.MAX_SAFE_INTEGER));
  }
  if (selectedOrder) {
    candidates = [...candidates].sort((left, right) => (selectedOrder.get(left.resource.sourceNodeId) ?? Number.MAX_SAFE_INTEGER) - (selectedOrder.get(right.resource.sourceNodeId) ?? Number.MAX_SAFE_INTEGER));
  }

  const generationSubmode = input.submode || defaultGenerationSubmode(input.mode, candidates.map(reference => reference.resource));
  if (input.mode === 'text' || generationSubmode === 'text-to-video' || generationSubmode === 'text-to-image') candidates = [];
  else if (generationSubmode === 'image-to-video' || generationSubmode === 'first-last-frame') candidates = candidates.filter(reference => reference.resource.kind === 'image');

  const references = candidates.map((reference, order) => ({
    ...reference,
    role: canonicalRole(reference, order, input.mode, generationSubmode),
    order,
  } satisfies CanonicalGenerationReference));
  return {
    nodeId: input.targetNode.id,
    capability: canonicalCapability(input.mode, generationSubmode, references.map(reference => reference.resource)),
    prompt: input.prompt,
    textInputs: input.inputs.texts,
    references,
    parameters: {
      modelId: input.parameters?.modelId || input.targetNode.metadata.config?.modelId,
      generationSubmode,
      ...input.parameters,
    },
    diagnostics: [...input.inputs.diagnostics],
  };
}
