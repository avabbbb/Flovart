/**
 * Workflow Execution Engine
 * Topological sort → sequential node execution → data propagation
 */
import {
  EMPTY_WORKFLOW_VALUE,
  getPrimaryWorkflowValue,
  getWorkflowImageValue,
  getWorkflowVideoValue,
  getWorkflowTextContent,
  isWorkflowValueEmpty,
  summarizeWorkflowValue,
} from '../components/nodeflow/types';
import type {
  NodeConfig,
  NodeIOMap,
  NodeKind,
  PortValue,
  WorkflowEdge,
  WorkflowImageValue,
  WorkflowNode,
  WorkflowVideoValue,
  WorkflowValue,
} from '../components/nodeflow/types';
import { NODE_DEFS } from '../components/nodeflow/defs';
import { normalizeWorkflowEdges } from '../components/nodeflow/graph';
import type { AIProvider, UserApiKey } from '../types';
import { normalizeVideoTrim } from '../utils/videoEdit';

// ──── Data Types ────

export interface ExecutionContext {
  /** User's API keys (for LLM / ImageGen / Video / RunningHub calls) */
  apiKeys: UserApiKey[];
  /** Resolved prompt text from the prompt/loadImage nodes */
  inputPrompt?: string;
  /** Input images (dataURL) */
  inputImages?: string[];
  /** Input videos from canvas/storyboard */
  inputVideos?: Array<WorkflowVideoValue & { id?: string }>;
  /** Callback: place a workflow result on the canvas */
  onPlaceOnCanvas?: (value: WorkflowValue) => void | Promise<void>;
  /** Callback: save a workflow result into the asset library */
  onSaveToAssets?: (value: WorkflowValue, node: WorkflowNode) => void | Promise<void>;
  /** Callback: progress updates */
  onProgress?: (nodeId: string, status: string) => void;
  /** Callback: node completed */
  onNodeComplete?: (nodeId: string, outputs: NodeIOMap) => void;
  /** Callback: error */
  onError?: (nodeId: string, error: string) => void;
  /** AbortController signal for cancellation */
  signal?: AbortSignal;
  /** Retry policy for failed nodes */
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    backoffMultiplier: number;
  };
}

export interface ExecutionResult {
  success: boolean;
  nodeOutputs: Map<string, NodeIOMap>;
  errors: { nodeId: string; error: string }[];
  /** Total cost estimate in cents (if traceable) */
  estimatedCost?: number;
}

export type WorkflowExecutionScope = 'workflow' | 'node' | 'from-here';

export interface WorkflowExecutionPlan {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  includedNodeIds: Set<string>;
}

type SupportedVideoAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';

function textValue(text: string | null | undefined): WorkflowValue {
  return { kind: 'text', text: text ?? '' };
}

function imageValue(
  href: string,
  mimeType = 'image/png',
  width?: number,
  height?: number,
): WorkflowImageValue {
  return { kind: 'image', href, mimeType, width, height };
}

function videoValue(
  href: string,
  mimeType = 'video/mp4',
  width?: number,
  height?: number,
  posterHref?: string,
): WorkflowValue {
  return { kind: 'video', href, mimeType, width, height, posterHref };
}

function jsonValue(value: unknown): WorkflowValue {
  return { kind: 'json', value };
}

function detectMimeTypeFromHref(href: string, fallback: string): string {
  const dataUrlMatch = href.match(/^data:([^;]+);/);
  if (dataUrlMatch) return dataUrlMatch[1];
  return fallback;
}

function getTextInput(inputs: NodeIOMap, ...keys: string[]): string {
  for (const key of keys) {
    const text = getWorkflowTextContent(inputs[key]);
    if (text) return text;
  }
  return '';
}

function getPromptInput(node: WorkflowNode, inputs: NodeIOMap, ctx: ExecutionContext, ...keys: string[]): string {
  return getTextInput(inputs, ...keys) || node.config?.prompt || ctx.inputPrompt || '';
}

function getSupportedVideoAspectRatio(value?: string): SupportedVideoAspectRatio | undefined {
  return ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].includes(value || '')
    ? value as SupportedVideoAspectRatio
    : undefined;
}

function getImageInput(inputs: NodeIOMap, ...keys: string[]): WorkflowImageValue | null {
  for (const key of keys) {
    const value = getWorkflowImageValue(inputs[key]);
    if (value) return value;
  }
  return null;
}

function getVideoInput(inputs: NodeIOMap, ...keys: string[]): WorkflowVideoValue | null {
  for (const key of keys) {
    const value = getWorkflowVideoValue(inputs[key]);
    if (value) return value;
  }
  return null;
}

function getConfigImageMedia(config?: NodeConfig): WorkflowImageValue | null {
  if (config?.mediaKind !== 'image' || !config.mediaHref) return null;
  return imageValue(
    config.mediaHref,
    config.mediaMimeType || detectMimeTypeFromHref(config.mediaHref, 'image/png'),
    config.mediaWidth,
    config.mediaHeight,
  );
}

function getConfigVideoMedia(config?: NodeConfig): WorkflowVideoValue | null {
  if (config?.mediaKind !== 'video' || !config.mediaHref) return null;
  return {
    kind: 'video',
    href: config.mediaHref,
    mimeType: config.mediaMimeType || detectMimeTypeFromHref(config.mediaHref, 'video/mp4'),
    width: config.mediaWidth,
    height: config.mediaHeight,
    posterHref: config.mediaPosterHref,
    durationSec: config.mediaDurationSec,
    trimInSec: config.mediaTrimInSec,
    trimOutSec: config.mediaTrimOutSec,
  };
}

function pickFirstValue(...values: PortValue[]): PortValue {
  for (const value of values) {
    if (!isWorkflowValueEmpty(value)) return value ?? null;
  }
  return null;
}

// ──── Topological Sort ────

export function topologicalSort(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowNode[] {
  const normalizedEdges = normalizeWorkflowEdges(nodes, edges);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adjacency.set(n.id, []);
  }

  for (const e of normalizedEdges) {
    inDegree.set(e.toNode, (inDegree.get(e.toNode) || 0) + 1);
    adjacency.get(e.fromNode)?.push(e.toNode);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: WorkflowNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeMap.get(id);
    if (node) sorted.push(node);
    for (const next of adjacency.get(id) || []) {
      const d = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('工作流存在循环依赖，无法执行');
  }

  return sorted;
}

export function createExecutionPlan(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  scope: WorkflowExecutionScope,
  focusNodeId?: string,
): WorkflowExecutionPlan {
  const normalizedEdges = normalizeWorkflowEdges(nodes, edges);
  const allNodeIds = new Set(nodes.map((node) => node.id));
  if (scope === 'workflow' || !focusNodeId || !allNodeIds.has(focusNodeId)) {
    return {
      nodes: [...nodes],
      edges: normalizedEdges,
      includedNodeIds: allNodeIds,
    };
  }

  const incomingByNode = new Map<string, string[]>();
  const outgoingByNode = new Map<string, string[]>();
  for (const edge of normalizedEdges) {
    const incoming = incomingByNode.get(edge.toNode) ?? [];
    incoming.push(edge.fromNode);
    incomingByNode.set(edge.toNode, incoming);

    const outgoing = outgoingByNode.get(edge.fromNode) ?? [];
    outgoing.push(edge.toNode);
    outgoingByNode.set(edge.fromNode, outgoing);
  }

  const targetNodeIds = new Set<string>();
  const forwardQueue = [focusNodeId];
  while (forwardQueue.length > 0) {
    const current = forwardQueue.shift()!;
    if (targetNodeIds.has(current)) continue;
    targetNodeIds.add(current);
    if (scope !== 'from-here') continue;
    for (const nextNodeId of outgoingByNode.get(current) ?? []) {
      if (!targetNodeIds.has(nextNodeId)) {
        forwardQueue.push(nextNodeId);
      }
    }
  }

  const includedNodeIds = new Set<string>();
  const reverseQueue = [...targetNodeIds];
  while (reverseQueue.length > 0) {
    const current = reverseQueue.shift()!;
    if (includedNodeIds.has(current)) continue;
    includedNodeIds.add(current);
    for (const previousNodeId of incomingByNode.get(current) ?? []) {
      if (!includedNodeIds.has(previousNodeId)) {
        reverseQueue.push(previousNodeId);
      }
    }
  }

  return {
    nodes: nodes.filter((node) => includedNodeIds.has(node.id)),
    edges: normalizedEdges.filter((edge) => includedNodeIds.has(edge.fromNode) && includedNodeIds.has(edge.toNode)),
    includedNodeIds,
  };
}

// ──── Node Executors ────

function getApiKeyForProvider(ctx: ExecutionContext, provider: string): string {
  const key = ctx.apiKeys.find(
    (k) => (k.provider === provider || k.provider === 'custom') && k.key && k.status !== 'error',
  );
  if (!key?.key) throw new Error(`未配置 ${provider} 的 API Key`);
  return key.key;
}

function isUsableApiKey(apiKey: UserApiKey): boolean {
  return !!apiKey.key && apiKey.status !== 'error';
}

export function resolveNodeApiKey(
  apiKeys: UserApiKey[],
  config: { apiKeyRef?: string } | undefined,
  ...providers: AIProvider[]
): UserApiKey | undefined {
  if (config?.apiKeyRef) {
    return apiKeys.find((apiKey) => apiKey.id === config.apiKeyRef && isUsableApiKey(apiKey));
  }

  for (const provider of providers) {
    const providerDefaultKey = apiKeys.find(
      (apiKey) => apiKey.provider === provider && apiKey.isDefault && isUsableApiKey(apiKey),
    );
    if (providerDefaultKey) return providerDefaultKey;
  }

  for (const provider of providers) {
    const providerKey = apiKeys.find((apiKey) => apiKey.provider === provider && isUsableApiKey(apiKey));
    if (providerKey) return providerKey;
  }

  return apiKeys.find((apiKey) => apiKey.isDefault && isUsableApiKey(apiKey));
}

async function executeLLM(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const key = resolveNodeApiKey(
    ctx.apiKeys,
    node.config,
    (node.config?.provider as AIProvider) || 'google',
    'openai',
    'anthropic',
    'deepseek',
  );
  if (!key) {
    throw new Error(node.config?.apiKeyRef ? '未找到节点绑定的 API Key' : '未找到可用的 LLM API Key');
  }

  const systemPrompt = node.config?.systemPrompt || 'You are a helpful assistant.';
  const inputText = getPromptInput(node, inputs, ctx, 'text', 'input');
  const model = node.config?.model || 'gemini-3-flash-preview';
  const temperature = node.config?.temperature ?? 0.7;
  const maxTokens = node.config?.maxTokens ?? 4096;

  const { generateTextWithProvider } = await import('../services/aiGateway');
  const text = await generateTextWithProvider(inputText, model, key, {
    systemPrompt,
    temperature,
    maxTokens,
    signal: ctx.signal,
  });
  return { text: textValue(text) };
}

async function executeImageGen(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const prompt = getTextInput(inputs, 'text', 'input') || node.config?.prompt || '';
  const refImage = getImageInput(inputs, 'image', 'input') || getConfigImageMedia(node.config);
  if (!prompt.trim()) {
    return { image: refImage };
  }
  const provider = (node.config?.provider as AIProvider) || 'google';
  const model = node.config?.model || (provider === 'openrouter' ? 'google/gemini-3.1-flash-image-preview' : provider === 'openai' ? 'gpt-image-1' : 'gemini-3.1-flash-image-preview');
  const key = resolveNodeApiKey(ctx.apiKeys, node.config, provider);
  if (!key) {
    throw new Error(node.config?.apiKeyRef ? '未找到节点绑定的 API Key' : `未找到 ${provider} 的 API Key`);
  }

  if (provider === 'google' || provider === 'openai' || provider === 'openrouter' || provider === 'custom' || key.provider === 'google' || key.provider === 'openai' || key.provider === 'openrouter' || key.provider === 'custom') {
    const { generateImageWithProvider } = await import('../services/aiGateway');
    const result = await generateImageWithProvider(
      prompt,
      model,
      key,
      refImage ? [{ href: refImage.href, mimeType: refImage.mimeType }] : [],
    );

    if (result?.newImageBase64 && result?.newImageMimeType) {
      return {
        image: imageValue(
          `data:${result.newImageMimeType};base64,${result.newImageBase64}`,
          result.newImageMimeType,
        ),
      };
    }

    return {
      image: null,
      text: textValue(result?.textResponse || ''),
    };
  }

  // RunningHub-based image gen
  if (provider === 'runningHub' || key.provider === 'runningHub') {
    const { rhRunTask, rhUploadDataUrl } = await import('../services/runningHubService');
    const payload: Record<string, unknown> = {
      prompt,
      resolution: node.config?.rhResolution || '2k',
    };
    if (node.config?.rhAspectRatio) payload.aspectRatio = node.config.rhAspectRatio;
    if (refImage) {
      const uploadedUrl = await rhUploadDataUrl(key.key, refImage.href);
      payload.imageUrls = [uploadedUrl];
    }
    const endpoint = node.config?.rhEndpoint || 'rhart-image-n-pro-official/edit';
    const result = await rhRunTask(key.key, endpoint, payload as any, (status) => {
      ctx.onProgress?.(node.id, `RunningHub: ${status}`);
    });
    const imageUrl = result.results?.[0]?.url || null;
    // Fetch and convert to dataURL
    if (imageUrl) {
      const imgRes = await fetch(imageUrl);
      const blob = await imgRes.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
      return { image: imageValue(dataUrl, blob.type || 'image/png') };
    }
    return { image: null };
  }

  throw new Error(`不支持的图片生成 Provider: ${provider}`);
}

async function executeVideoGen(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const prompt = getTextInput(inputs, 'text', 'input') || node.config?.prompt || '';
  const firstFrame = getImageInput(inputs, 'image', 'input') || getConfigImageMedia(node.config);
  const localVideo = getConfigVideoMedia(node.config);
  if (!prompt.trim()) {
    return { video: localVideo };
  }
  const provider = (node.config?.provider as AIProvider) || 'google';
  const model = node.config?.model || (provider === 'minimax' ? 'video-01' : 'veo-3.1-generate-preview');
  const key = resolveNodeApiKey(ctx.apiKeys, node.config, provider, 'google', 'minimax', 'keling');
  if (!key) {
    throw new Error(node.config?.apiKeyRef ? '未找到节点绑定的 API Key' : '未找到视频生成的 API Key');
  }

  const { generateVideoWithProvider } = await import('../services/aiGateway');
  const result = await generateVideoWithProvider(
    prompt,
    model,
    key,
    {
      onProgress: (status) => ctx.onProgress?.(node.id, status),
      aspectRatio: getSupportedVideoAspectRatio(node.config?.aspectRatio),
      references: firstFrame ? [{ href: firstFrame.href, mimeType: firstFrame.mimeType }] : [],
    },
  );
  if (result?.videoBlob) {
    const videoUrl = URL.createObjectURL(result.videoBlob);
    return { video: videoValue(videoUrl, result.videoBlob.type || 'video/mp4') };
  }
  return { video: null };
}

function executeVideoEdit(
  node: WorkflowNode,
  inputs: NodeIOMap,
): NodeIOMap {
  const sourceVideo = getVideoInput(inputs, 'video', 'input', 'result');
  if (!sourceVideo) return { video: null };

  const mode = node.config?.videoEditMode || 'trim';
  if (mode === 'replacePoster') {
    const posterImage = getImageInput(inputs, 'image');
    return {
      video: {
        ...sourceVideo,
        posterHref: posterImage?.href || sourceVideo.posterHref,
        sourceVideoId: sourceVideo.sourceVideoId,
      },
    };
  }

  const normalizedTrim = normalizeVideoTrim({
    durationSec: sourceVideo.durationSec,
    trimInSec: node.config?.trimInSec ?? sourceVideo.trimInSec,
    trimOutSec: node.config?.trimOutSec ?? sourceVideo.trimOutSec,
  });

  return {
    video: {
      ...sourceVideo,
      trimInSec: normalizedTrim.trimInSec,
      trimOutSec: normalizedTrim.trimOutSec,
      sourceVideoId: sourceVideo.sourceVideoId,
    },
  };
}

async function executeRunningHub(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const key = resolveNodeApiKey(ctx.apiKeys, node.config, 'runningHub');
  if (!key) {
    throw new Error(node.config?.apiKeyRef ? '未找到节点绑定的 API Key' : '未配置 RunningHub API Key');
  }

  const { rhRunTask, rhUploadDataUrl } = await import('../services/runningHubService');
  const endpoint = node.config?.rhEndpoint || 'rhart-image-n-pro-official/edit';

  const payload: Record<string, unknown> = {
    prompt: getTextInput(inputs, 'text', 'input'),
    resolution: node.config?.rhResolution || '2k',
  };
  if (node.config?.rhAspectRatio) payload.aspectRatio = node.config.rhAspectRatio;
  const inputImage = getImageInput(inputs, 'image', 'input');
  if (inputImage) {
    const url = await rhUploadDataUrl(key.key, inputImage.href);
    payload.imageUrls = [url];
  }

  const result = await rhRunTask(key.key, endpoint, payload as any, (status) => {
    ctx.onProgress?.(node.id, `RunningHub: ${status}`);
  });

  // Return all results
  const imageResult = result.results?.find((r) => r.outputType === 'png' || r.outputType === 'jpg');
  const videoResult = result.results?.find((r) => r.outputType === 'mp4');
  const textResult = result.results?.find((r) => r.text);

  if (imageResult) {
    const imgRes = await fetch(imageResult.url);
    const blob = await imgRes.blob();
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
    const image = imageValue(dataUrl, blob.type || 'image/png');
    return { result: image, image };
  }
  if (videoResult) {
    const video = videoValue(videoResult.url, 'video/mp4');
    return { result: video, video };
  }
  if (textResult) {
    const text = textValue(textResult.text);
    return { result: text, output: text };
  }

  return { result: null };
}

async function executeHttpRequest(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const url = node.config?.httpUrl;
  if (!url) throw new Error('HTTP 节点未配置 URL');

  const method = node.config?.httpMethod || 'POST';
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (node.config?.httpHeaders) {
    try {
      headers = { ...headers, ...JSON.parse(node.config.httpHeaders) };
    } catch {
      // ignore bad JSON
    }
  }

  // Interpolate body template with input values
  let body = node.config?.httpBodyTemplate || '';
  body = body.replace(/\{\{input\}\}/g, getTextInput(inputs, 'input', 'text'));
  body = body.replace(/\{\{image\}\}/g, getImageInput(inputs, 'image', 'input')?.href || '');

  const res = await fetch(url, {
    method,
    headers,
    body: method !== 'GET' ? body : undefined,
    signal: ctx.signal,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const responseText = await res.text();

  // Extract result via JSONPath if configured
  if (node.config?.httpResultPath) {
    try {
      const json = JSON.parse(responseText);
      const path = node.config.httpResultPath.split('.');
      let value: unknown = json;
      for (const key of path) {
        if (value && typeof value === 'object') {
          value = (value as Record<string, unknown>)[key];
        }
      }
      const normalized = typeof value === 'string' ? textValue(value) : jsonValue(value);
      return { output: normalized, result: normalized };
    } catch {
      const text = textValue(responseText);
      return { output: text, result: text };
    }
  }

  try {
    const json = JSON.parse(responseText);
    const normalized = jsonValue(json);
    return { output: normalized, result: normalized };
  } catch {
    const text = textValue(responseText);
    return { output: text, result: text };
  }
}

function executeTemplate(
  node: WorkflowNode,
  inputs: NodeIOMap,
): NodeIOMap {
  let text = node.config?.templateText || '';
  text = text.replace(/\{\{var1\}\}/g, getTextInput(inputs, 'var1'));
  text = text.replace(/\{\{var2\}\}/g, getTextInput(inputs, 'var2'));
  text = text.replace(/\{\{input\}\}/g, getTextInput(inputs, 'input', 'text'));
  return { text: textValue(text) };
}

function executeCondition(
  node: WorkflowNode,
  inputs: NodeIOMap,
): NodeIOMap {
  const inputValue = pickFirstValue(inputs.input, inputs.text, inputs.result);
  const input = getWorkflowTextContent(inputValue);
  const rules: ConditionRule[] = node.config?.conditionRules as ConditionRule[] | undefined || [];

  let result: boolean;

  if (rules.length > 0) {
    // Advanced multi-rule evaluation
    result = evaluateConditionRules(rules, input, inputs);
  } else {
    // Legacy single-expression mode (backward compat)
    const expr = node.config?.conditionExpr || '';
    result = evaluateLegacyCondition(expr, input);
  }

  return {
    true: result ? inputValue : null,
    false: result ? null : inputValue,
  };
}

// ──── Condition Rule Types & Evaluator ─────

export interface ConditionRule {
  field: string; // port key or 'input'
  operator: 'contains' | 'not_contains' | 'equals' | 'not_equals'
           | 'regex' | 'gt' | 'lt' | 'gte' | 'lte'
           | 'empty' | 'not_empty' | 'json_path_truthy';
  value: string;
  logicGroup?: 'and' | 'or';
}

function evaluateConditionRules(rules: ConditionRule[], input: string, allInputs: NodeIOMap): boolean {
  if (rules.length === 0) return true;

  let groupResult = evaluateSingleRule(rules[0], input, allInputs);

  for (let i = 1; i < rules.length; i++) {
    const rule = rules[i];
    const ruleResult = evaluateSingleRule(rule, input, allInputs);
    const logic = rule.logicGroup || 'and';
    groupResult = logic === 'or' ? (groupResult || ruleResult) : (groupResult && ruleResult);
  }

  return groupResult;
}

function evaluateSingleRule(rule: ConditionRule, input: string, allInputs: NodeIOMap): boolean {
  const fieldValue = rule.field === 'input'
    ? input
    : getWorkflowTextContent(allInputs[rule.field]) || input;
  const v = rule.value || '';

  switch (rule.operator) {
    case 'contains': return fieldValue.includes(v);
    case 'not_contains': return !fieldValue.includes(v);
    case 'equals': return fieldValue === v;
    case 'not_equals': return fieldValue !== v;
    case 'regex': {
      try { return new RegExp(v).test(fieldValue); }
      catch { return false; }
    }
    case 'gt': return parseFloat(fieldValue) > parseFloat(v);
    case 'lt': return parseFloat(fieldValue) < parseFloat(v);
    case 'gte': return parseFloat(fieldValue) >= parseFloat(v);
    case 'lte': return parseFloat(fieldValue) <= parseFloat(v);
    case 'empty': return !fieldValue.trim();
    case 'not_empty': return !!fieldValue.trim();
    case 'json_path_truthy': {
      try {
        const json = JSON.parse(fieldValue);
        const path = v.split('.');
        let val: unknown = json;
        for (const key of path) {
          if (val && typeof val === 'object') val = (val as Record<string, unknown>)[key];
          else { val = undefined; break; }
        }
        return !!val;
      } catch { return false; }
    }
    default: return !!fieldValue.trim();
  }
}

function evaluateLegacyCondition(expr: string, input: string): boolean {
  if (expr.includes('contains')) {
    const match = expr.match(/contains\s+['"](.+?)['"]/);
    if (match) return input.includes(match[1]);
  } else if (expr.includes('empty')) {
    return !input.trim();
  } else if (expr.includes('length>')) {
    const match = expr.match(/length>\s*(\d+)/);
    if (match) return input.length > parseInt(match[1]);
  }
  return !!input.trim();
}

// ──── Switch Node ─────

interface SwitchCase {
  label: string;
  rules: ConditionRule[];
}

function executeSwitch(
  node: WorkflowNode,
  inputs: NodeIOMap,
): NodeIOMap {
  const inputValue = pickFirstValue(inputs.input, inputs.text, inputs.result);
  const input = getWorkflowTextContent(inputValue);
  const cases: SwitchCase[] = (node.config?.cases as SwitchCase[]) || [];
  const outputs: NodeIOMap = {};

  // Initialize all outputs to null
  for (let i = 0; i < Math.max(cases.length, 4); i++) {
    outputs[`out_${i}`] = null;
  }
  outputs['default'] = null;

  // Find first matching case
  let matched = false;
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (c.rules.length === 0 || evaluateConditionRules(c.rules, input, inputs)) {
      outputs[`out_${i}`] = inputValue;
      matched = true;
      break;
    }
  }

  if (!matched) {
    outputs['default'] = inputValue;
  }

  return outputs;
}

// ──── Upscale / Post-Processing Nodes ─────

async function executeUpscale(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const image = getImageInput(inputs, 'image', 'input');
  if (!image) return { image: null };

  const scale = (node.config?.scale as number) || 2;
  const model = (node.config?.model as string) || 'RealESRGAN_x4plus';

  // Use RunningHub workflow for upscaling if API key available
  const rhKey = ctx.apiKeys.find(k => k.provider === 'runningHub' as AIProvider);
  if (rhKey) {
    const workflowId = (node.config?.workflowId as string) || '';
    if (workflowId) {
      // Delegate to RunningHub upscale workflow
      const rhNode: WorkflowNode = {
        ...node,
        kind: 'runningHub' as NodeKind,
        config: { ...node.config, workflowId, nodeConfigs: { image: image.href, scale: String(scale), model } },
      };
      return executeRunningHub(rhNode, inputs, ctx);
    }
  }

  // Fallback: pass through with metadata annotation
  return { image, scale: textValue(String(scale)), model: textValue(model) };
}

async function executeFaceRestore(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const image = getImageInput(inputs, 'image', 'input');
  if (!image) return { image: null };

  const model = (node.config?.model as string) || 'CodeFormer';
  const fidelity = (node.config?.fidelity as number) || 0.5;

  const rhKey = ctx.apiKeys.find(k => k.provider === 'runningHub' as AIProvider);
  if (rhKey) {
    const workflowId = (node.config?.workflowId as string) || '';
    if (workflowId) {
      const rhNode: WorkflowNode = {
        ...node,
        kind: 'runningHub' as NodeKind,
        config: { ...node.config, workflowId, nodeConfigs: { image: image.href, model, fidelity: String(fidelity) } },
      };
      return executeRunningHub(rhNode, inputs, ctx);
    }
  }

  return { image, model: textValue(model), fidelity: textValue(String(fidelity)) };
}

async function executeBgRemove(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const image = getImageInput(inputs, 'image', 'input');
  if (!image) return { image: null };

  const rhKey = ctx.apiKeys.find(k => k.provider === 'runningHub' as AIProvider);
  if (rhKey) {
    const workflowId = (node.config?.workflowId as string) || '';
    if (workflowId) {
      const rhNode: WorkflowNode = {
        ...node,
        kind: 'runningHub' as NodeKind,
        config: { ...node.config, workflowId, nodeConfigs: { image: image.href } },
      };
      return executeRunningHub(rhNode, inputs, ctx);
    }
  }

  return { image };
}

function executeMerge(
  _node: WorkflowNode,
  inputs: NodeIOMap,
): NodeIOMap {
  const a = getTextInput(inputs, 'a');
  const b = getTextInput(inputs, 'b');
  return { output: textValue([a, b].filter(Boolean).join('\n---\n')) };
}

// ──── Main Executor ────

async function executeNode(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  switch (node.kind) {
    case 'prompt':
      return { text: textValue(node.config?.prompt || ctx.inputPrompt || getTextInput(inputs, 'text', 'input')) };
    case 'loadImage':
      return {
        image: ctx.inputImages?.[0]
          ? imageValue(ctx.inputImages[0], detectMimeTypeFromHref(ctx.inputImages[0], 'image/png'))
          : pickFirstValue(inputs.image, inputs.input),
      };
    case 'loadVideo': {
      const selectedVideo = node.config?.videoSourceId
        ? ctx.inputVideos?.find((video) => video.id === node.config?.videoSourceId)
        : ctx.inputVideos?.[0];
      return {
        video: selectedVideo
          ? {
              kind: 'video',
              href: selectedVideo.href,
              mimeType: selectedVideo.mimeType,
              width: selectedVideo.width,
              height: selectedVideo.height,
              posterHref: selectedVideo.posterHref,
              durationSec: selectedVideo.durationSec,
              trimInSec: selectedVideo.trimInSec,
              trimOutSec: selectedVideo.trimOutSec,
              sourceVideoId: selectedVideo.id,
            }
          : pickFirstValue(inputs.video, inputs.input),
      };
    }
    case 'enhancer':
    case 'llm':
      return executeLLM(node, inputs, ctx);
    case 'generator':
      if (node.config?.generationMode === 'video') {
        return executeVideoGen(node, inputs, ctx);
      }
      return executeImageGen(node, inputs, ctx);
    case 'imageGen':
      return executeImageGen(node, inputs, ctx);
    case 'videoGen':
      return executeVideoGen(node, inputs, ctx);
    case 'videoEdit':
      return executeVideoEdit(node, inputs);
    case 'runningHub':
      return executeRunningHub(node, inputs, ctx);
    case 'httpRequest':
      return executeHttpRequest(node, inputs, ctx);
    case 'template':
      return executeTemplate(node, inputs);
    case 'condition':
      return executeCondition(node, inputs);
    case 'switch':
      return executeSwitch(node, inputs);
    case 'upscale':
      return executeUpscale(node, inputs, ctx);
    case 'faceRestore':
      return executeFaceRestore(node, inputs, ctx);
    case 'bgRemove':
      return executeBgRemove(node, inputs, ctx);
    case 'merge':
      return executeMerge(node, inputs);
    case 'preview':
    case 'saveToCanvas':
      // Pass-through; side effects handled after execution
      return { result: pickFirstValue(inputs.result, inputs.image, inputs.video, inputs.text, inputs.input) };
    case 'saveToAssets': {
      const result = pickFirstValue(inputs.result, inputs.image, inputs.video, inputs.text, inputs.input);
      if (!result) return { result: null };
      if (result.kind !== 'image') {
        throw new Error('Save To Assets 目前仅支持图片输出');
      }
      return { result };
    }
    default:
      return {};
  }
}

function getNodeTimeoutMs(config?: NodeConfig): number | undefined {
  const timeoutMs = config?.timeoutMs;
  return typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : undefined;
}

async function executeNodeWithTimeout(
  node: WorkflowNode,
  inputs: NodeIOMap,
  ctx: ExecutionContext,
): Promise<NodeIOMap> {
  const timeoutMs = getNodeTimeoutMs(node.config);
  if (!timeoutMs) {
    return executeNode(node, inputs, ctx);
  }

  const controller = new AbortController();
  const parentSignal = ctx.signal;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutError = new Error(`Node timed out after ${timeoutMs}ms`);
  const timeoutPromise = new Promise<NodeIOMap>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      executeNode(node, inputs, { ...ctx, signal: controller.signal }).catch((error) => {
        if (timedOut) throw timeoutError;
        throw error;
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

/**
 * Execute an entire workflow graph.
 * Supports: conditional path skipping, retry with exponential backoff.
 */
export async function executeWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  ctx: ExecutionContext,
): Promise<ExecutionResult> {
  const normalizedEdges = normalizeWorkflowEdges(nodes, edges);
  const sorted = topologicalSort(nodes, normalizedEdges);
  const nodeOutputs = new Map<string, NodeIOMap>();
  const errors: { nodeId: string; error: string }[] = [];
  const skippedNodes = new Set<string>();

  // Build reverse mapping: nodeId → upstream condition/switch ports that feed it
  const conditionalParents = new Map<string, { fromNode: string; fromPort: string }[]>();
  for (const edge of normalizedEdges) {
    const sourceNode = nodes.find(n => n.id === edge.fromNode);
    if (sourceNode && (sourceNode.kind === 'condition' || sourceNode.kind === 'switch')) {
      const arr = conditionalParents.get(edge.toNode) || [];
      arr.push({ fromNode: edge.fromNode, fromPort: edge.fromPort });
      conditionalParents.set(edge.toNode, arr);
    }
  }

  for (const node of sorted) {
    if (ctx.signal?.aborted) {
      errors.push({ nodeId: node.id, error: '已取消' });
      break;
    }

    // Skip nodes on unreachable conditional paths
    if (skippedNodes.has(node.id)) {
      nodeOutputs.set(node.id, {});
      ctx.onProgress?.(node.id, 'skipped');
      continue;
    }

    // Check if all incoming conditional edges are null → skip this node
    const condParents = conditionalParents.get(node.id);
    if (condParents && condParents.length > 0) {
      const allNull = condParents.every(({ fromNode, fromPort }) => {
        const outputs = nodeOutputs.get(fromNode);
        return !outputs || isWorkflowValueEmpty(outputs[fromPort]);
      });
      if (allNull) {
        skippedNodes.add(node.id);
        // Propagate: mark all downstream nodes fed only by this node as skipped
        propagateSkip(node.id, nodes, normalizedEdges, skippedNodes, conditionalParents);
        nodeOutputs.set(node.id, {});
        ctx.onProgress?.(node.id, 'skipped');
        continue;
      }
    }

    const pinnedOutputs = node.config?.pinnedOutputs;
    if (pinnedOutputs && Object.keys(pinnedOutputs).length > 0) {
      nodeOutputs.set(node.id, pinnedOutputs);
      ctx.onProgress?.(node.id, 'pinned');
      ctx.onNodeComplete?.(node.id, pinnedOutputs);

      if ((node.kind === 'saveToCanvas' || node.kind === 'preview') && ctx.onPlaceOnCanvas) {
        const primary = getPrimaryWorkflowValue(pinnedOutputs);
        if (primary) {
          await ctx.onPlaceOnCanvas(primary);
        }
      }
      if (node.kind === 'saveToAssets' && ctx.onSaveToAssets) {
        const primary = getPrimaryWorkflowValue(pinnedOutputs);
        if (primary?.kind === 'image') {
          await ctx.onSaveToAssets(primary, node);
        }
      }
      continue;
    }

    ctx.onProgress?.(node.id, 'running');

    // Collect inputs from connected edges
    const inputs: NodeIOMap = {};
    const incomingEdges = normalizedEdges.filter((e) => e.toNode === node.id);
    for (const edge of incomingEdges) {
      const sourceOutputs = nodeOutputs.get(edge.fromNode);
      if (sourceOutputs) {
        const value = sourceOutputs[edge.fromPort];
        if (value !== undefined) {
          inputs[edge.toPort] = value;
        }
      }
    }

    // Execute with retry
    const maxRetries = node.config?.retryCount ?? ctx.retryPolicy?.maxRetries ?? 0;
    const baseBackoff = ctx.retryPolicy?.backoffMs ?? 2000;
    const multiplier = ctx.retryPolicy?.backoffMultiplier ?? 2;
    let lastError: string | undefined;
    let outputs: NodeIOMap | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseBackoff * Math.pow(multiplier, attempt - 1);
        ctx.onProgress?.(node.id, `retry ${attempt}/${maxRetries} (${delay}ms)`);
        await new Promise(r => setTimeout(r, delay));
      }
      try {
        outputs = await executeNodeWithTimeout(node, inputs, ctx);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === maxRetries) break;
      }
    }

    if (lastError || !outputs) {
      const errMsg = lastError || 'Unknown error';
      errors.push({ nodeId: node.id, error: errMsg });
      ctx.onError?.(node.id, errMsg);
      nodeOutputs.set(node.id, {});
    } else {
      nodeOutputs.set(node.id, outputs);
      ctx.onNodeComplete?.(node.id, outputs);

      // Handle saveToCanvas / preview side effects
      if ((node.kind === 'saveToCanvas' || node.kind === 'preview') && ctx.onPlaceOnCanvas) {
        const result = getPrimaryWorkflowValue(outputs);
        if (!isWorkflowValueEmpty(result)) {
          await ctx.onPlaceOnCanvas(result as WorkflowValue);
        }
      }
      if (node.kind === 'saveToAssets' && ctx.onSaveToAssets) {
        const result = getPrimaryWorkflowValue(outputs);
        if (result?.kind === 'image') {
          await ctx.onSaveToAssets(result, node);
        }
      }
    }
  }

  return {
    success: errors.length === 0,
    nodeOutputs,
    errors,
  };
}

/** Propagate skip status downstream from a skipped node */
function propagateSkip(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  skippedNodes: Set<string>,
  conditionalParents: Map<string, { fromNode: string; fromPort: string }[]>,
): void {
  const downstream = edges.filter(e => e.fromNode === nodeId).map(e => e.toNode);
  for (const downId of downstream) {
    if (skippedNodes.has(downId)) continue;
    // Only skip if ALL incoming edges come from skipped nodes
    const allInputsSkipped = edges
      .filter(e => e.toNode === downId)
      .every(e => skippedNodes.has(e.fromNode));
    if (allInputsSkipped) {
      skippedNodes.add(downId);
      propagateSkip(downId, nodes, edges, skippedNodes, conditionalParents);
    }
  }
}
