import { checkReferenceCount, describeReferenceFix, getReferenceConstraints, suggestReferenceCandidates, type ReferenceKind } from './referenceConstraints';
import { alignPromptReferences } from '../components/workflow/promptReferenceAlignment';
import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import { buildWorkflowPromptDocument, workflowPromptMentionAttrs } from '../components/workflow/promptDocument';
import { createPromptIntent, type PromptIntent } from '../components/workflow/promptIntent';
import { reorderReferenceOperations } from '../components/workflow/references';
import { validateReferenceRegion } from '../components/workflow/referenceRegion';
import { isReferencePurpose, REFERENCE_PURPOSES, type WorkflowReferencePurpose } from '../components/workflow/referencePurpose';
import { buildNodeRefIndex, extractNodeRefs, isNodeRefMiss, resolveNodeRef, type NodeRefIndex } from '../components/workflow/nodeRefResolver';
import type {
  WorkflowConnection,
  WorkflowDocumentOperation,
  WorkflowGenerationConfig,
  WorkflowGenerationReferenceRole,
  WorkflowNode,
  WorkflowReferenceRegion,
  WorkflowShotMeta,
} from '../components/workflow/types';
import type { ProductModelMode, UserApiKey } from '../types';
import {
  explainReferenceCompatibility,
  getEffectiveProductModelCapabilities,
  getEffectiveReferenceLimits,
  getProductModel,
  getProductModels,
  getResolvableImageModes,
  getResolvableVideoModes,
  getRoutedImageModes,
  getRoutedVideoModes,
  IMAGE_MODE_ORDER,
  resolveProductModelRoute,
  VIDEO_MODE_ORDER,
  type ProductModelDefinition,
} from './productModelCatalog';
import { resolveWorkflowDefaultModel } from './workflowPromptPolicy';
import { describeModelCost } from './modelCostTier';

/**
 * Agent 工具 v2：iris_generate / iris_models_list 的纯规划逻辑。
 * 只调用模型目录（productModelCatalog / workflowPromptPolicy）的导出函数；
 * 写画布由 dispatcher 以一个原子 ChangeSet 提交，运行交给同一个 WorkflowExecutor。
 */

export type GenerateMode = 'image' | 'video';

export interface GenerateDiagnostic {
  code: string;
  message: string;
}

export class WorkflowGenerateError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkflowGenerateError';
  }
}

const REFERENCE_ROLES = new Set<WorkflowGenerationReferenceRole>(['first_frame', 'last_frame', 'reference', 'character', 'style', 'mask', 'source_video', 'source_audio']);
const MEDIA_TYPES = new Set(['image', 'video', 'audio']);
const PARAM_KEYS = ['aspectRatio', 'resolution', 'quality', 'count', 'durationSec', 'generateAudio', 'watermark', 'preserveReferenceAspectRatio', 'webSearch', 'realPersonCheck'] as const;
const ADVANCED_PARAM_KEYS = new Set(['seed', 'cameraMovement', 'customMovement', 'styleId', 'enhancePrompt', 'operationParameters']);

export interface GenerateReference {
  nodeId: string;
  role?: WorkflowGenerationReferenceRole;
  /** 带区域的引用（仅图片）：{x,y,w,h} 0-1 归一化，可选 mask；执行前裁剪，不建中间节点。 */
  region?: WorkflowReferenceRegion;
  /** 参考用途（主体 / 风格 / 背景…）：编进发给模型的参考说明，并显示在 inspect 里。 */
  purpose?: WorkflowReferencePurpose;
  /** 显式顺序（1 起）：给了就按它排 chip / 连线顺序，没给的按出现顺序排在后面。 */
  order?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export function parseGenerateReferences(value: unknown): GenerateReference[] {
  if (value === undefined || value === null) return [];
  let raw = value;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try { raw = trimmed.startsWith('[') ? JSON.parse(trimmed) : trimmed.split(','); } catch { throw new WorkflowGenerateError('BAD_REQUEST', 'references 不是合法的 JSON 数组'); }
  }
  if (!Array.isArray(raw)) throw new WorkflowGenerateError('BAD_REQUEST', 'references 必须是数组：[{"nodeId":"img-1","role":"first_frame"}] 或节点 id 列表');
  const seen = new Set<string>();
  return raw.flatMap((item, index) => {
    const nodeId = typeof item === 'string' ? item.trim() : isRecord(item) ? text(item.nodeId || item.id) : '';
    if (!nodeId) throw new WorkflowGenerateError('BAD_REQUEST', `references[${index}] 缺少 nodeId`);
    const role = isRecord(item) && item.role !== undefined ? String(item.role) : undefined;
    if (role && !REFERENCE_ROLES.has(role as WorkflowGenerationReferenceRole)) {
      throw new WorkflowGenerateError('BAD_REQUEST', `references[${index}].role 不支持：${role}；可用 ${[...REFERENCE_ROLES].join('/')}`);
    }
    const regionCheck = isRecord(item) ? validateReferenceRegion(item.region) : {};
    if (regionCheck.error) throw new WorkflowGenerateError('BAD_REQUEST', `references[${index}].${regionCheck.error}`);
    const purpose = isRecord(item) && item.purpose !== undefined && item.purpose !== null ? String(item.purpose) : undefined;
    if (purpose && !isReferencePurpose(purpose)) {
      throw new WorkflowGenerateError('BAD_REQUEST', `references[${index}].purpose 不支持：${purpose}；可用 ${REFERENCE_PURPOSES.join('/')}`);
    }
    const order = isRecord(item) && item.order !== undefined && item.order !== null ? Number(item.order) : undefined;
    if (order !== undefined && (!Number.isFinite(order) || order < 0)) throw new WorkflowGenerateError('BAD_REQUEST', `references[${index}].order 必须是非负数字`);
    if (seen.has(nodeId)) return [];
    seen.add(nodeId);
    return [{
      nodeId,
      ...(role ? { role: role as WorkflowGenerationReferenceRole } : {}),
      ...(regionCheck.region ? { region: regionCheck.region } : {}),
      ...(purpose ? { purpose: purpose as WorkflowReferencePurpose } : {}),
      ...(order !== undefined ? { order } : {}),
    }];
  }).map((reference, index) => ({ reference, index }))
    // 显式 order 优先（稳定排序），没给 order 的保持原顺序排在后面。
    .sort((left, right) => (left.reference.order ?? Number.MAX_SAFE_INTEGER) - (right.reference.order ?? Number.MAX_SAFE_INTEGER) || left.index - right.index)
    .map(item => item.reference);
}

const MEDIA_NODE_TYPES = new Set(['image', 'video', 'audio']);

/**
 * 生成节点当前的参考（按连线顺序 = chip 顺序）：可见的图片/视频/音频上游，带 Prompt Bar chip 上保存的 role / region / purpose。
 * 隐藏的输入节点（运行时保留原图的内部节点）不算。
 */
export function currentGenerateReferences(target: WorkflowNode, nodes: readonly WorkflowNode[], connections: readonly WorkflowConnection[]): GenerateReference[] {
  const mentionAttrs = new Map<string, Record<string, unknown>>();
  const walk = (value: unknown) => {
    if (!isRecord(value)) return;
    if (value.type === 'mediaMention' && isRecord(value.attrs) && typeof value.attrs.id === 'string' && !mentionAttrs.has(value.attrs.id)) mentionAttrs.set(value.attrs.id, value.attrs);
    if (Array.isArray(value.content)) value.content.forEach(walk);
  };
  walk(target.metadata.richTextDocument);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  return connections.flatMap(connection => {
    if (connection.toNodeId !== target.id || seen.has(connection.fromNodeId)) return [];
    const source = byId.get(connection.fromNodeId);
    if (!source || source.isVisible === false || !MEDIA_NODE_TYPES.has(source.type)) return [];
    seen.add(source.id);
    const attrs = mentionAttrs.get(source.id) || {};
    const role = typeof attrs.role === 'string' && REFERENCE_ROLES.has(attrs.role as WorkflowGenerationReferenceRole) ? attrs.role as WorkflowGenerationReferenceRole : undefined;
    const region = validateReferenceRegion(attrs.region ?? undefined).region;
    return [{
      nodeId: source.id,
      ...(role ? { role } : {}),
      ...(region && source.type === 'image' ? { region } : {}),
      ...(isReferencePurpose(attrs.purpose) ? { purpose: attrs.purpose } : {}),
    }];
  });
}

/** 生成节点的媒体模式：image / video 节点或图片生成 Operation；其它一律拒绝（文本备注、脚本、音频）。 */
export function generateModeOf(node: WorkflowNode): GenerateMode | null {
  if (node.metadata.operation) return node.metadata.operation.capabilityId === 'image.generate@1' ? 'image' : null;
  if (node.type === 'image' || node.type === 'video') return node.type as GenerateMode;
  return null;
}

/** 按引用自动推导生成方式（与 PromptBar 的可选模式同一套名字）。 */
export function inferGenerateSubmode(mode: GenerateMode, references: Array<{ kind: string; role?: WorkflowGenerationReferenceRole }>): ProductModelMode {
  const images = references.filter(reference => reference.kind === 'image');
  const videos = references.filter(reference => reference.kind === 'video');
  const audios = references.filter(reference => reference.kind === 'audio');
  if (mode === 'image') return images.length ? 'image-to-image' : 'text-to-image';
  if (references.some(reference => reference.role === 'last_frame')) return 'first-last-frame';
  if (!images.length && !videos.length && !audios.length) return 'text-to-video';
  if (videos.length || audios.length || images.length > 1) return 'reference-to-video';
  return 'image-to-video';
}

const modeOrder = (mode: GenerateMode) => (mode === 'image' ? IMAGE_MODE_ORDER : VIDEO_MODE_ORDER);

function routedModes(model: ProductModelDefinition, keys: UserApiKey[]): ProductModelMode[] {
  return model.capability === 'video' ? getResolvableVideoModes(model.id, keys) : getResolvableImageModes(model.id, keys);
}

/** models_list 的单项：产品模型能力 + 当前 Key 下真正能发出去的模式。 */
export function describeProductModel(model: ProductModelDefinition, keys: UserApiKey[], defaultModelId?: string) {
  const configuredModes = routedModes(model, keys);
  const caps = model.capabilities;
  const modeDetails = model.capabilities.modes.map(mode => {
    const route = resolveProductModelRoute(model.id, mode, keys);
    const context = route ? { provider: route.key.provider, routeId: route.routeId } : undefined;
    const limits = getEffectiveReferenceLimits(model.id, mode, context);
    const constraints = getReferenceConstraints(model.id, mode, context);
    return {
      mode,
      configured: configuredModes.includes(mode),
      maxReferences: limits,
      minReferences: constraints ? { image: constraints.perKind.image.min, video: constraints.perKind.video.min, audio: constraints.perKind.audio.min } : { image: 0, video: 0, audio: 0 },
      minTotalReferences: constraints?.minTotal ?? 0,
      maxTotalReferences: constraints?.maxTotal ?? 0,
      requires: constraints?.requires ?? [],
    };
  });
  return {
    id: model.id,
    name: model.name,
    company: model.company,
    capability: model.capability,
    source: model.id.startsWith('rh:') ? 'runninghub-doc' : 'static',
    available: configuredModes.length > 0,
    isDefault: model.id === defaultModelId,
    modes: modeDetails,
    maxImageReferences: caps.maxImageReferences,
    maxVideoReferences: caps.maxVideoReferences,
    maxAudioReferences: caps.maxAudioReferences,
    counts: caps.counts,
    aspectRatios: caps.aspectRatios,
    resolutions: caps.resolutions,
    durations: caps.durations,
    qualities: caps.qualities,
    audioControl: caps.audioControl,
    // P2-F：费用档位（cheap/standard/premium）+ 用户计价规则里的真实单价区间（有才给）。
    ...describeModelCost(model.id, keys),
  };
}

export function listWorkflowModels(args: Record<string, unknown>, keys: UserApiKey[]) {
  const capabilities: GenerateMode[] = args.mode === 'image' || args.mode === 'video' ? [args.mode] : ['image', 'video'];
  if (args.mode !== undefined && args.mode !== 'image' && args.mode !== 'video' && args.mode !== 'all') {
    throw new WorkflowGenerateError('BAD_REQUEST', 'mode 只能是 image / video / all');
  }
  const submode = text(args.submode) as ProductModelMode | '';
  const referenceKinds = Array.isArray(args.referenceKinds) ? args.referenceKinds.map(String).filter(kind => MEDIA_TYPES.has(kind)) as Array<'image' | 'video' | 'audio'> : [];
  const includeUnavailable = args.includeUnavailable === true;
  const defaults = Object.fromEntries(capabilities.map(capability => [capability, resolveWorkflowDefaultModel({
    mode: capability,
    modelIds: getProductModels(capability).map(model => model.id),
    userApiKeys: keys,
  })]));
  const all = capabilities.flatMap(capability => getProductModels(capability).map(model => describeProductModel(model, keys, defaults[capability])));
  const matching = all.filter(model => {
    if (submode && !model.modes.some(item => item.mode === submode)) return false;
    if (submode && referenceKinds.length && explainReferenceCompatibility(model.id, submode, referenceKinds)) return false;
    return true;
  });
  const available = matching.filter(model => model.available);
  const models = includeUnavailable || !available.length ? matching : available;
  return {
    models,
    defaultModelIds: defaults,
    costTierNote: 'costTier 是模型在同家族里的档位（cheap 省钱 / standard / premium 高质量），不是价格；priceRange 是用户计价规则里的真实单价。没指定模型时，先给用户一个省钱档和一个质量档的选择。',
    configured: keys.length > 0,
    ...(available.length ? {} : { note: keys.length ? '当前 API Key 下没有能运行这些条件的模型；列出的是全部候选（available=false），需要用户在设置里配置线路。' : '还没有配置任何 AI 服务 API Key：列出的是全部候选，运行前需要用户在设置里添加 Key。' }),
  };
}

export interface GeneratePlanInput {
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
  args: Record<string, unknown>;
  mutationId: string;
  keys: UserApiKey[];
  /** 新建节点的落位；dispatcher 传 autoPlaceWorkflowNode */
  place: (node: WorkflowNode, upstreamIds: string[]) => { x: number; y: number };
  createId?: () => string;
}

export interface GeneratePlan {
  nodeId: string;
  created: boolean;
  mode: GenerateMode;
  operations: WorkflowDocumentOperation[];
  prompt: string;
  model: { modelId?: string; submode: ProductModelMode; routeId?: string; provider?: string; source?: string };
  references: Array<{ nodeId: string; label: string; kind: string; order: number; role?: WorkflowGenerationReferenceRole; region?: WorkflowReferenceRegion; purpose?: WorkflowReferencePurpose; mentioned: boolean }>;
  promptIntent: PromptIntent;
  diagnostics: GenerateDiagnostic[];
  /** 写入前节点已有的参考（可见媒体上游，按 chip 顺序）；新建节点为空。 */
  priorReferenceIds: string[];
  /** references 的来源：caller=调用方显式给出；inherited=没传 references，沿用节点已有参考；none=新建且没有参考。 */
  referenceSource: 'caller' | 'inherited' | 'none';
  /** 显式 references 漏掉了节点已有的参考（且没给 dropReferences=true）：写入照常，但拒绝 run=true。 */
  droppedReferenceIds: string[];
  /** prompt 引用了但原本没连线、本次自动连上的节点（P0-2）。 */
  autoLinked: string[];
}

function stableNodeId(mutationId: string) {
  let hash = 2166136261;
  for (const char of mutationId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return 'gen-' + hash.toString(36);
}

/** 当前这组参考能直接用的 (modelId, mode)：已配置线路的在前，按线路 schema 校验。 */
function referenceCandidatesFor(mode: GenerateMode, kinds: ReferenceKind[], keys: UserApiKey[]) {
  return suggestReferenceCandidates(mode, kinds, {
    routeContextOf: (modelId, candidateMode) => {
      const route = resolveProductModelRoute(modelId, candidateMode, keys);
      return route ? { provider: route.key.provider, routeId: route.routeId } : undefined;
    },
    isConfigured: (modelId, candidateMode) => Boolean(resolveProductModelRoute(modelId, candidateMode, keys)),
    limit: 8,
  });
}

function compatibleModels(mode: GenerateMode, submode: ProductModelMode, kinds: Array<'image' | 'video' | 'audio'>, keys: UserApiKey[]) {
  return getProductModels(mode)
    .filter(model => model.capabilities.modes.includes(submode))
    .filter(model => !explainReferenceCompatibility(model.id, submode, kinds))
    .map(model => ({ id: model.id, name: model.name, configured: routedModes(model, keys).includes(submode) }))
    .sort((left, right) => Number(right.configured) - Number(left.configured));
}

/**
 * 规划一次生成：复用或新建一个生成节点，把 references 连成参考（顺序 = chip 顺序），
 * prompt 编成带 @chip 的 Prompt Bar 文档，按引用推导生成方式并校验模型能力。
 * 不兼容时抛结构化错误（带可用模型列表），绝不静默降级或换模型。
 */
/** 把区域写进对应节点的 mediaMention attrs（Prompt Bar chip 与运行时都读这里）。原地修改新建的文档。 */
function attachMentionRegions(document: unknown, regionById: Map<string, WorkflowReferenceRegion>) {
  const walk = (value: unknown) => {
    if (!isRecord(value)) return;
    if (value.type === 'mediaMention' && isRecord(value.attrs) && typeof value.attrs.id === 'string' && regionById.has(value.attrs.id)) {
      value.attrs = { ...value.attrs, region: regionById.get(value.attrs.id) };
    }
    if (Array.isArray(value.content)) value.content.forEach(walk);
  };
  walk(document);
}

/** 把 role / purpose 写进对应 chip 的 attrs（Prompt Bar 与运行时都读这里）。原地修改新建的文档。 */
function attachMentionAttrs(document: unknown, attrsById: Map<string, Record<string, unknown>>) {
  const walk = (value: unknown) => {
    if (!isRecord(value)) return;
    if (value.type === 'mediaMention' && isRecord(value.attrs) && typeof value.attrs.id === 'string') {
      const extra = attrsById.get(value.attrs.id);
      if (extra && Object.keys(extra).length) value.attrs = { ...value.attrs, ...extra };
    }
    if (Array.isArray(value.content)) value.content.forEach(walk);
  };
  walk(document);
}

/** nodeId / references 支持节点 id、锚点编号 A01/S01/P01/T01、shot:N、节点名；重名报 AMBIGUOUS_NODE_NAME。 */
function resolveRefOrThrow(ref: string, index: NodeRefIndex, label: string): string {
  const result = resolveNodeRef(ref, index);
  if (!isNodeRefMiss(result)) return result.nodeId;
  if (result.code === 'AMBIGUOUS_NODE_NAME') {
    throw new WorkflowGenerateError('AMBIGUOUS_NODE_NAME', `${label}「${ref}」匹配到多个节点，请改用节点 id 或锚点编号：${result.candidates.map(item => item.nodeId + (item.code ? '(' + item.code + ')' : '')).join('、')}`, { candidates: result.candidates });
  }
  throw new WorkflowGenerateError('NOT_FOUND', `${label}不存在：${ref}`);
}

export function planWorkflowGenerate(input: GeneratePlanInput): GeneratePlan {
  const { args, keys } = input;
  const diagnostics: GenerateDiagnostic[] = [];
  const refIndex = buildNodeRefIndex(input.nodes);
  const rawPrompt = typeof args.prompt === 'string' ? args.prompt : '';
  if (!rawPrompt.trim()) throw new WorkflowGenerateError('BAD_REQUEST', 'prompt 不能为空：提示词直接写进生成节点的 Prompt Bar');
  // 提示词里的 @A01 / @shot:3 / @"节点名" 先改写成 @ref:<id>，后续按 @ref 统一处理。
  const extracted = extractNodeRefs(rawPrompt, refIndex);
  if (extracted.ambiguous.length) {
    const first = extracted.ambiguous[0];
    throw new WorkflowGenerateError('AMBIGUOUS_NODE_NAME', `prompt 里的 ${first.ref} 匹配到多个节点，请改用 @ref:<id> 或锚点编号：${first.candidates.map(item => item.nodeId).join('、')}`, { candidates: first.candidates });
  }
  if (extracted.unresolved.length) {
    diagnostics.push({ code: 'UNKNOWN_NODE_REF', message: `${extracted.unresolved.join('、')} 没有对应的节点，已保留为文字。` });
  }
  let prompt = extracted.text;
  const requestedRef = text(args.nodeId);
  const requestedId = requestedRef ? resolveRefOrThrow(requestedRef, refIndex, '节点') : '';
  let target: WorkflowNode | undefined;
  let created = false;
  let mode: GenerateMode;
  if (requestedId) {
    target = input.nodes.find(node => node.id === requestedId);
    if (!target) throw new WorkflowGenerateError('NOT_FOUND', '节点不存在：' + requestedId);
    if (target.type === 'text') throw new WorkflowGenerateError('NOTE_IS_ANNOTATION', '文本节点是备注，不参与生成；请对 image/video 生成节点调用 iris_generate，或省略 nodeId 新建一个。');
    const targetMode = generateModeOf(target);
    if (!targetMode) throw new WorkflowGenerateError('UNSUPPORTED_TARGET', `节点 ${requestedId}（${target.type}）不是图片/视频生成节点。`);
    if (args.type !== undefined && args.type !== targetMode) throw new WorkflowGenerateError('BAD_REQUEST', `nodeId 指向 ${targetMode} 节点，与 type=${String(args.type)} 不一致`);
    mode = targetMode;
  } else {
    if (args.type !== 'image' && args.type !== 'video') {
      throw new WorkflowGenerateError('BAD_REQUEST', args.type === 'text'
        ? '文本节点是备注，不能当提示词或生成节点；生成请用 type=image/video，写备注请用 iris_note_write。'
        : '新建生成节点需要 type=image 或 video（或给 nodeId 复用已有生成节点）。');
    }
    mode = args.type;
    created = true;
  }
  const nodeId = target?.id || stableNodeId(input.mutationId);

  const seenReferences = new Set<string>();
  // P0-A：复用节点且没传 references 时沿用节点已有参考（连线 + chip 上的 role/region/purpose），
  // 以前这里只看本次参数，改提示词会把参考静默丢掉、推导成 text-to-image，下一次运行白花钱。
  const referencesGiven = args.references !== undefined && args.references !== null;
  const priorReferences = target ? currentGenerateReferences(target, input.nodes, input.connections) : [];
  const priorReferenceIds = priorReferences.map(reference => reference.nodeId);
  const callerReferences: GenerateReference[] = parseGenerateReferences(args.references).flatMap(reference => {
    const resolved = resolveRefOrThrow(reference.nodeId, refIndex, '参考节点');
    if (seenReferences.has(resolved)) return [];
    seenReferences.add(resolved);
    // 调用方没写的 role / region / purpose 沿用 chip 上已有的值。
    const prior = priorReferences.find(item => item.nodeId === resolved);
    return [{ ...(prior ? { ...(prior.role ? { role: prior.role } : {}), ...(prior.region ? { region: prior.region } : {}), ...(prior.purpose ? { purpose: prior.purpose } : {}) } : {}), ...reference, nodeId: resolved }];
  });
  const inherited = !referencesGiven && priorReferences.length > 0;
  const explicitReferences: GenerateReference[] = referencesGiven ? callerReferences : priorReferences.filter(reference => {
    if (seenReferences.has(reference.nodeId)) return false;
    seenReferences.add(reference.nodeId);
    return true;
  });
  if (inherited) {
    diagnostics.push({ code: 'REFERENCES_INHERITED', message: `没传 references：沿用节点已有的 ${priorReferences.length} 个参考（${priorReferenceIds.join('、')}），顺序不变。要改参考请显式传 references。` });
  }
  // P0-2：prompt 里的 @ref（@A01 / @shot:N / @"名字" 已先改写为 @ref）与连线必须一致——没连线的按策略自动补进 references 或拒绝。
  const linkPolicy = args.linkPolicy === 'reject' ? 'reject' : 'auto';
  const alignment = alignPromptReferences({
    text: prompt,
    targetNodeId: nodeId,
    nodes: input.nodes,
    connections: input.connections,
    referenceIds: explicitReferences.map(reference => reference.nodeId),
    policy: linkPolicy,
  });
  if (alignment.ok === false) throw new WorkflowGenerateError(alignment.code, alignment.message, alignment.details);
  prompt = alignment.text;
  const references: GenerateReference[] = [
    ...explicitReferences,
    ...alignment.autoLinked.filter(id => !seenReferences.has(id)).map(nodeId => ({ nodeId })),
  ];
  // 显式 references 没列出节点已有的参考：dropReferences=true 时断开这些连线（可撤销），否则写入但不让运行。
  const keptIds = new Set(references.map(reference => reference.nodeId));
  const omittedIds = referencesGiven ? priorReferenceIds.filter(id => !keptIds.has(id)) : [];
  const dropReferences = args.dropReferences === true || args.dropReferences === 'true';
  const droppedReferenceIds = dropReferences ? [] : omittedIds;
  if (droppedReferenceIds.length) {
    diagnostics.push({ code: 'REFERENCES_DROPPED', message: `references 没包含节点已有的参考 ${droppedReferenceIds.join('、')}：它们不会参与生成，但连线还在。确认要去掉就加 dropReferences=true（会断开连线），要保留就把它们写进 references；在此之前不会运行。` });
  }
  const referenceNodes = references.map(reference => {
    const node = input.nodes.find(item => item.id === reference.nodeId);
    if (!node) throw new WorkflowGenerateError('NOT_FOUND', '参考节点不存在：' + reference.nodeId);
    if (node.id === nodeId) throw new WorkflowGenerateError('BAD_REQUEST', '不能把生成节点自己当参考');
    if (node.type === 'text') throw new WorkflowGenerateError('NOTE_IS_ANNOTATION', `节点 ${node.id} 是备注，不能当参考；把需要的文字直接写进 prompt。`);
    if (!MEDIA_TYPES.has(node.type)) throw new WorkflowGenerateError('BAD_REQUEST', `参考节点 ${node.id}（${node.type}）不是图片/视频/音频`);
    if (reference.region && node.type !== 'image') throw new WorkflowGenerateError('BAD_REQUEST', `region 只能用于图片参考；${node.id} 是 ${node.type}`);
    return { ...reference, node, kind: node.type as 'image' | 'video' | 'audio' };
  });
  if (mode === 'image' && referenceNodes.some(reference => reference.kind !== 'image')) {
    throw new WorkflowGenerateError('MODE_UNSUPPORTED', '图片生成只接收图片参考；视频/音频参考请用 type=video 的生成节点。');
  }

  const requestedSubmode = text(args.submode) as ProductModelMode | '';
  if (requestedSubmode && !modeOrder(mode).includes(requestedSubmode)) {
    throw new WorkflowGenerateError('BAD_REQUEST', `${mode} 节点的 submode 只能是 ${modeOrder(mode).join(' / ')}`);
  }
  const submode = requestedSubmode || inferGenerateSubmode(mode, referenceNodes);
  if (referenceNodes.length && (submode === 'text-to-image' || submode === 'text-to-video')) {
    // 文生模式在运行时会丢掉全部参考（inputResolver 对 text-to-* 清空 references）：不让参考被静默丢弃。
    throw new WorkflowGenerateError('SUBMODE_REFERENCE_MISMATCH', `submode=${submode} 会忽略全部 ${referenceNodes.length} 个参考（${referenceNodes.map(reference => reference.node.id).join('、')}）。去掉 submode 让系统按参考推导，或传 references: [] 加 dropReferences=true 明确改成文生。`, {
      submode,
      referenceIds: referenceNodes.map(reference => reference.node.id),
      suggestedSubmode: inferGenerateSubmode(mode, referenceNodes),
    });
  }
  const kinds = referenceNodes.map(reference => reference.kind);

  // 模型：显式给定 > 节点已有模型 > 与 PromptBar 相同的默认策略
  const currentModelId = target?.metadata.config?.modelId || (target?.metadata.operation?.recipe.productModelId as string | undefined);
  const requestedModelId = text(args.modelId);
  let model = requestedModelId ? getProductModel(requestedModelId) : undefined;
  if (requestedModelId && (!model || model.capability !== mode)) {
    throw new WorkflowGenerateError('MODEL_NOT_FOUND', `没有可用于${mode === 'image' ? '图片' : '视频'}生成的模型：${requestedModelId}。先调用 iris_models_list。`, {
      compatibleModels: compatibleModels(mode, submode, kinds, keys),
    });
  }
  if (!model && currentModelId) {
    const current = getProductModel(currentModelId);
    if (current && current.capability === mode && current.capabilities.modes.includes(submode)) model = current;
  }
  if (!model) {
    const preferred = resolveWorkflowDefaultModel({ mode, modelIds: getProductModels(mode).filter(item => item.capabilities.modes.includes(submode)).map(item => item.id), userApiKeys: keys });
    model = preferred ? getProductModel(preferred) : undefined;
    if (!model) {
      const fallback = compatibleModels(mode, submode, kinds, keys)[0];
      model = fallback ? getProductModel(fallback.id) : undefined;
      if (model) diagnostics.push({ code: 'MODEL_NOT_CONFIGURED', message: `当前没有已配置线路的模型支持 ${submode}；暂按 ${model.name} 写入节点，运行前需要用户在设置里配置 API Key。` });
    }
  }
  if (!model) {
    throw new WorkflowGenerateError('MODE_UNSUPPORTED', `没有任何模型支持 ${submode}${kinds.length ? '（参考：' + kinds.join('、') + '）' : ''}。`, { compatibleModels: [] });
  }
  if (!model.capabilities.modes.includes(submode)) {
    throw new WorkflowGenerateError('MODE_UNSUPPORTED', `${model.name} 不支持 ${submode}（支持：${model.capabilities.modes.join('、')}）。不要盲试，换下面列出的模型或去掉不兼容的参考。`, {
      modelId: model.id,
      submode,
      candidates: referenceCandidatesFor(mode, kinds as ReferenceKind[], keys).map(({ modelId, mode: candidateMode }) => ({ modelId, mode: candidateMode })),
      compatibleModels: compatibleModels(mode, submode, kinds, keys),
    });
  }
  const route = resolveProductModelRoute(model.id, submode, keys);
  const routeContext = route ? { provider: route.key.provider, routeId: route.routeId } : undefined;
  if (route) {
    const routed = mode === 'video'
      ? getRoutedVideoModes(model.id, route.key.provider, route.routeId)
      : getRoutedImageModes(model.id, route.key.provider, route.routeId);
    if (!routed.includes(submode)) {
      throw new WorkflowGenerateError('MODE_UNSUPPORTED', `${model.name} 当前线路不支持 ${submode}（线路支持：${routed.join('、') || '无'}）。`, {
        modelId: model.id,
        submode,
        compatibleModels: compatibleModels(mode, submode, kinds, keys),
      });
    }
  } else if (!diagnostics.some(item => item.code === 'MODEL_NOT_CONFIGURED')) {
    diagnostics.push({ code: 'MODEL_NOT_CONFIGURED', message: `${model.name} 的 ${submode} 还没有配置线路，运行前需要用户在设置里添加对应 API Key。` });
  }
  const countViolation = checkReferenceCount(model.id, submode, kinds as ReferenceKind[], routeContext);
  if (countViolation) {
    const candidates = referenceCandidatesFor(mode, kinds as ReferenceKind[], keys);
    throw new WorkflowGenerateError('REFERENCE_COUNT_OUT_OF_RANGE', `${model.name}（${submode}）：${countViolation.message}。${describeReferenceFix(countViolation, candidates)}`, {
      modelId: model.id,
      mode: submode,
      kind: countViolation.kind,
      min: countViolation.min,
      max: countViolation.max,
      got: countViolation.got,
      candidates: candidates.map(({ modelId, mode: candidateMode }) => ({ modelId, mode: candidateMode })),
      compatibleModels: compatibleModels(mode, submode, kinds, keys),
    });
  }
  const referenceProblem = explainReferenceCompatibility(model.id, submode, kinds, routeContext);
  if (referenceProblem) {
    throw new WorkflowGenerateError('REFERENCE_LIMIT', `${model.name}（${submode}）：${referenceProblem}。`, {
      modelId: model.id,
      submode,
      limits: getEffectiveReferenceLimits(model.id, submode, routeContext),
      compatibleModels: compatibleModels(mode, submode, kinds, keys),
    });
  }

  // 参数：只接收模型声明支持的值，不静默改写
  const capabilities = getEffectiveProductModelCapabilities(model.id, submode, routeContext) || model.capabilities;
  const params: Record<string, unknown> = {};
  const extra = isRecord(args.params) ? args.params : {};
  for (const key of PARAM_KEYS) {
    const value = args[key] !== undefined ? args[key] : extra[key];
    if (value !== undefined) params[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (ADVANCED_PARAM_KEYS.has(key)) params[key] = value;
    else if (!(PARAM_KEYS as readonly string[]).includes(key)) diagnostics.push({ code: 'PARAM_IGNORED', message: `params.${key} 不是生成参数，已忽略` });
  }
  if (params.count !== undefined) {
    const count = Number(params.count);
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new WorkflowGenerateError('BAD_REQUEST', 'count 只能是 1-4 的整数');
    if (capabilities.counts.length && !capabilities.counts.includes(count) && count !== 1) {
      throw new WorkflowGenerateError('PARAM_UNSUPPORTED', `${model.name} 每次只能生成 ${capabilities.counts.join('/')} 张`, { counts: capabilities.counts });
    }
    params.count = count;
  }
  if (typeof params.aspectRatio === 'string' && capabilities.aspectRatios.length && !capabilities.aspectRatios.includes(params.aspectRatio as never)) {
    throw new WorkflowGenerateError('PARAM_UNSUPPORTED', `${model.name} 不支持比例 ${params.aspectRatio}`, { aspectRatios: capabilities.aspectRatios });
  }
  if (typeof params.resolution === 'string' && capabilities.resolutions.length && !capabilities.resolutions.some(value => value.toLowerCase() === String(params.resolution).toLowerCase())) {
    throw new WorkflowGenerateError('PARAM_UNSUPPORTED', `${model.name} 不支持分辨率 ${params.resolution}`, { resolutions: capabilities.resolutions });
  }
  if (params.durationSec !== undefined) {
    const duration = Number(params.durationSec);
    if (mode !== 'video' || !Number.isFinite(duration)) throw new WorkflowGenerateError('BAD_REQUEST', 'durationSec 只用于视频生成，且必须是数字');
    if (capabilities.durations.length && !capabilities.durations.includes(duration)) {
      throw new WorkflowGenerateError('PARAM_UNSUPPORTED', `${model.name} 不支持时长 ${duration}s`, { durations: capabilities.durations });
    }
    params.durationSec = duration;
  }

  // 文档操作：新建/复用节点 → 补连线 → 按 references 排序 → 写 Prompt Bar（同一个 ChangeSet）
  const operations: WorkflowDocumentOperation[] = [];
  let nodes = [...input.nodes];
  let connections = [...input.connections];
  if (created) {
    const node = createWorkflowNode(nodeId, mode, { x: 0, y: 0 });
    if (typeof args.title === 'string' && args.title.trim()) node.title = args.title.trim();
    const x = args.x === undefined ? undefined : Number(args.x);
    const y = args.y === undefined ? undefined : Number(args.y);
    node.position = Number.isFinite(x) && Number.isFinite(y)
      ? { x: x as number, y: y as number }
      : input.place(node, referenceNodes.map(reference => reference.node.id));
    operations.push({ type: 'add_node', node });
    nodes = [...nodes, node];
  }
  const createId = input.createId || nanoid;
  if (dropReferences && omittedIds.length) {
    const omitted = new Set(omittedIds);
    const ids = connections.filter(connection => connection.toNodeId === nodeId && omitted.has(connection.fromNodeId)).map(connection => connection.id);
    if (ids.length) {
      operations.push({ type: 'delete_connections', ids });
      connections = connections.filter(connection => !ids.includes(connection.id));
    }
  }
  referenceNodes.forEach(reference => {
    if (connections.some(connection => connection.fromNodeId === reference.node.id && connection.toNodeId === nodeId)) return;
    const connection: WorkflowConnection = { id: 'conn-' + createId(), fromNodeId: reference.node.id, toNodeId: nodeId };
    operations.push({ type: 'connect_nodes', id: connection.id, fromNodeId: connection.fromNodeId, toNodeId: connection.toNodeId });
    connections = [...connections, connection];
  });
  if (referenceNodes.length > 1) {
    // 参考顺序 = chip 顺序 = 首尾帧顺序：已有连线顺序不同就断开重连（ChangeSet 可撤销）。
    const reorder = reorderReferenceOperations(connections, nodeId, referenceNodes.map(reference => reference.node.id), () => 'conn-' + createId());
    for (const op of reorder) {
      operations.push(op as WorkflowDocumentOperation);
      if (op.type === 'delete_connections') connections = connections.filter(connection => !op.ids.includes(connection.id));
      else connections = [...connections, { id: op.id, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId, kind: op.kind, role: op.role, order: op.order }];
    }
  }
  // 引用文本按连好线、排好序后的 chip 标签编成文档；全部 references 都进入 mention，确保它们参与生成。
  const document = buildWorkflowPromptDocument({
    text: prompt,
    targetNodeId: nodeId,
    nodes,
    connections,
    ensureMentionIds: referenceNodes.map(reference => reference.node.id),
  });
  const regionById = new Map(referenceNodes.filter(reference => reference.region).map(reference => [reference.node.id, reference.region!]));
  if (regionById.size) attachMentionRegions(document.richTextDocument, regionById);
  // role / purpose 也写进 chip：之后 node.run 或改提示词时不丢（以前 role 只在本次 promptIntent 里）。
  attachMentionAttrs(document.richTextDocument, new Map(referenceNodes.map(reference => [reference.node.id, {
    ...(reference.role ? { role: reference.role } : {}),
    ...(reference.purpose ? { purpose: reference.purpose } : {}),
  }])));
  if (document.unresolved.length) {
    diagnostics.push({ code: 'UNRESOLVED_MENTION', message: `@ref:${document.unresolved.join('、@ref:')} 不在 references 里，已保留为文字；要引用请加进 references。` });
  }
  const labels = new Map(workflowPromptMentionAttrs(nodeId, nodes, connections).map(item => [item.id, item]));
  const previousConfig = target?.metadata.config;
  const config: WorkflowGenerationConfig = {
    ...(previousConfig || {}),
    mode,
    modelId: model.id,
    submode,
    ...params,
  } as WorkflowGenerationConfig;
  const shot = isRecord(args.shot) ? args.shot as unknown as WorkflowShotMeta : undefined;
  operations.push({
    type: 'update_node',
    id: nodeId,
    metadata: { prompt: document.prompt, richTextDocument: document.richTextDocument, config },
    ...(shot ? { patch: { shot } } : {}),
  });

  // 预演一次，任何拒绝都在提交前报出来（例如连线规则）
  const preview = applyWorkflowOps({ projectId: 'plan', title: 'plan', nodes: [...input.nodes], connections: [...input.connections], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, operations);
  if (preview.rejections.length) {
    throw new WorkflowGenerateError('BAD_REQUEST', '写入失败：' + preview.rejections.map(item => item.reason).join('；'));
  }

  const roleById = new Map(referenceNodes.map(reference => [reference.node.id, reference.role]));
  const promptIntent = createPromptIntent({
    targetNodeId: nodeId,
    text: document.prompt,
    mentions: document.mentionIds.map(id => ({
      id,
      label: labels.get(id)?.label,
      elementType: labels.get(id)?.elementType,
      sourceType: 'connected',
      ...(roleById.get(id) ? { role: roleById.get(id) } : {}),
      ...(regionById.get(id) ? { region: regionById.get(id) } : {}),
    })),
    requestedAction: 'generate',
  });
  return {
    nodeId,
    created,
    mode,
    operations,
    prompt: document.prompt,
    model: {
      modelId: model.id,
      submode,
      ...(route ? { routeId: route.routeId, provider: String(route.key.provider) } : {}),
      source: model.id.startsWith('rh:') ? 'runninghub-doc' : 'static',
    },
    references: referenceNodes.map((reference, index) => ({
      nodeId: reference.node.id,
      label: labels.get(reference.node.id)?.label || reference.node.title,
      kind: reference.kind,
      order: index + 1,
      ...(reference.role ? { role: reference.role } : {}),
      ...(reference.region ? { region: reference.region } : {}),
      ...(reference.purpose ? { purpose: reference.purpose } : {}),
      mentioned: document.mentionIds.includes(reference.node.id),
    })),
    promptIntent,
    diagnostics,
    autoLinked: alignment.autoLinked,
    priorReferenceIds,
    referenceSource: referencesGiven ? 'caller' : inherited ? 'inherited' : 'none',
    droppedReferenceIds,
  };
}

export interface GenerateInvariantIssue {
  code: 'NODE_MISSING' | 'MODE_MISMATCH' | 'SUBMODE_MISMATCH' | 'MODEL_MISMATCH' | 'REFERENCES_LOST' | 'REFERENCE_NOT_IN_PROMPT' | 'REFERENCE_ORDER_MISMATCH' | 'SUBMODE_IGNORES_REFERENCES' | 'REFERENCES_DROPPED';
  message: string;
  details: Record<string, unknown>;
}

const mentionIdsOf = (document: unknown): string[] => {
  const ids: string[] = [];
  const walk = (value: unknown) => {
    if (!isRecord(value)) return;
    if (value.type === 'mediaMention' && isRecord(value.attrs) && typeof value.attrs.id === 'string' && !ids.includes(value.attrs.id)) ids.push(value.attrs.id);
    if (Array.isArray(value.content)) value.content.forEach(walk);
  };
  walk(document);
  return ids;
};

/**
 * 写入后的不变量（P0-A）：回读已提交的节点，核对 mode / submode / 模型 / 参考与计划一致，
 * 参考既在 Prompt Bar chip 里、连线顺序也与计划一致；调用方传了参考或节点原本有参考，结果却没有参考，一律报出来。
 * 有任何问题时 dispatcher 拒绝 run=true（写入已完成，可撤销），把结构化 details 交回调用方。
 */
export function checkGenerateInvariant(
  plan: Pick<GeneratePlan, 'nodeId' | 'mode' | 'model' | 'references' | 'priorReferenceIds' | 'referenceSource' | 'droppedReferenceIds'>,
  committed: { nodes: readonly WorkflowNode[]; connections: readonly WorkflowConnection[] },
  args: Record<string, unknown> = {},
): GenerateInvariantIssue[] {
  const issues: GenerateInvariantIssue[] = [];
  const node = committed.nodes.find(item => item.id === plan.nodeId);
  if (!node) return [{ code: 'NODE_MISSING', message: `写入后找不到生成节点 ${plan.nodeId}`, details: { nodeId: plan.nodeId } }];
  const config = node.metadata.config;
  const expectedIds = plan.references.map(reference => reference.nodeId);
  if (generateModeOf(node) !== plan.mode || (config?.mode && config.mode !== plan.mode)) {
    issues.push({ code: 'MODE_MISMATCH', message: `节点 ${node.id} 的模式是 ${config?.mode || node.type}，计划是 ${plan.mode}`, details: { expected: plan.mode, actual: config?.mode || node.type } });
  }
  if (config?.submode !== plan.model.submode) {
    issues.push({ code: 'SUBMODE_MISMATCH', message: `节点 ${node.id} 的生成方式是 ${String(config?.submode)}，计划是 ${plan.model.submode}`, details: { expected: plan.model.submode, actual: config?.submode ?? null } });
  }
  if (plan.model.modelId && config?.modelId !== plan.model.modelId) {
    issues.push({ code: 'MODEL_MISMATCH', message: `节点 ${node.id} 的模型是 ${String(config?.modelId)}，计划是 ${plan.model.modelId}`, details: { expected: plan.model.modelId, actual: config?.modelId ?? null } });
  }
  if (expectedIds.length && (plan.model.submode === 'text-to-image' || plan.model.submode === 'text-to-video')) {
    issues.push({ code: 'SUBMODE_IGNORES_REFERENCES', message: `${plan.model.submode} 会忽略全部参考`, details: { submode: plan.model.submode, referenceIds: expectedIds } });
  }
  const passedReferences = Array.isArray(args.references) ? args.references.length > 0 : typeof args.references === 'string' && args.references.trim().length > 0;
  const explicitlyCleared = (args.dropReferences === true || args.dropReferences === 'true') && plan.referenceSource === 'caller';
  if (!expectedIds.length && !explicitlyCleared && (passedReferences || plan.priorReferenceIds.length)) {
    issues.push({ code: 'REFERENCES_LOST', message: `调用方传了参考或节点原本有参考（${plan.priorReferenceIds.join('、') || '见 references 参数'}），写入后却没有任何参考`, details: { priorReferenceIds: plan.priorReferenceIds, submode: plan.model.submode } });
  }
  const mentioned = mentionIdsOf(node.metadata.richTextDocument);
  const notInPrompt = expectedIds.filter(id => !mentioned.includes(id));
  if (notInPrompt.length) {
    issues.push({ code: 'REFERENCE_NOT_IN_PROMPT', message: `参考 ${notInPrompt.join('、')} 没有出现在 Prompt Bar 的 chip 里，运行时不会被使用`, details: { missing: notInPrompt, mentioned } });
  }
  const linked = currentGenerateReferences(node, committed.nodes, committed.connections).map(reference => reference.nodeId).filter(id => expectedIds.includes(id));
  if (linked.join('|') !== expectedIds.join('|')) {
    issues.push({ code: 'REFERENCE_ORDER_MISMATCH', message: `连线顺序 ${linked.join(' → ') || '（无）'} 与计划的参考顺序 ${expectedIds.join(' → ')} 不一致`, details: { expected: expectedIds, actual: linked } });
  }
  if (plan.droppedReferenceIds.length) {
    issues.push({ code: 'REFERENCES_DROPPED', message: `节点已有的参考 ${plan.droppedReferenceIds.join('、')} 不在 references 里：加 dropReferences=true 断开，或把它们写回 references`, details: { droppedReferenceIds: plan.droppedReferenceIds } });
  }
  return issues;
}
