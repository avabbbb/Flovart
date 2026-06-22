import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowVideoPoster, discardWorkflowMediaRecord, ingestWorkflowMedia, releaseWorkflowMediaRecord, type WorkflowMediaRecord } from '../components/workflow/media';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { WorkflowGenerationMode, WorkflowNode, WorkflowProject } from '../components/workflow/types';
import type { ModelPreference, UserApiKey } from '../types';
import { resolveModelSelection } from '../utils/modelRefs';
import { executeUnifiedIgnition, generateTextWithProvider, type UnifiedIgnitionInput, type UnifiedIgnitionResult } from './aiGateway';
import { getGenerationCapability } from './generationCapabilities';

export interface WorkflowHistoryPayload {
  name?: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
  prompt: string;
  mediaType?: 'image' | 'video';
}

export interface WorkflowGenerationRuntime {
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  executeMedia?: (input: UnifiedIgnitionInput) => Promise<UnifiedIgnitionResult>;
  executeText?: typeof generateTextWithProvider;
  getProject?: () => WorkflowProject | null;
  onProjectChange?: (project: WorkflowProject) => void | Promise<void>;
  saveHistory?: (payload: WorkflowHistoryPayload) => void | Promise<void>;
  createId?: () => string;
  loadMedia?: (storageKey: string) => Promise<Blob | null>;
  fetchMedia?: (href: string) => Promise<Blob>;
  ingestMedia?: (file: File) => Promise<WorkflowMediaRecord>;
  encodeDataUrl?: (blob: Blob) => Promise<string>;
  createVideoPoster?: (blob: Blob) => Promise<Blob | null>;
}

interface ActiveRequest {
  requestId: string;
  controller: AbortController;
  runtime: WorkflowGenerationRuntime;
}

const activeRequests = new Map<string, ActiveRequest>();
const requestKey = (projectId: string, nodeId: string) => `${projectId}:${nodeId}`;
const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
const abortError = () => new DOMException('生成已停止', 'AbortError');

const preferredModel = (preferences: ModelPreference, mode: WorkflowGenerationMode) => (
  mode === 'text' ? preferences.textModel : mode === 'video' ? preferences.videoModel : preferences.imageModel
);

function modeFor(node: WorkflowNode): WorkflowGenerationMode {
  if (node.type === 'config') return node.metadata.config?.mode || 'image';
  if (node.type === 'text') return node.metadata.config?.mode || 'text';
  if (node.type === 'video') return node.metadata.config?.mode || 'video';
  if (node.type === 'audio') return 'audio';
  return node.metadata.config?.mode || 'image';
}

function patchInitiator(project: WorkflowProject, nodeId: string, metadata: Record<string, unknown>): WorkflowProject {
  return { ...project, nodes: project.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...metadata } } : node) };
}

async function publish(runtime: WorkflowGenerationRuntime, project: WorkflowProject) {
  await runtime.onProjectChange?.(project);
  return project;
}

function canonical(runtime: WorkflowGenerationRuntime, fallback: WorkflowProject) {
  return runtime.getProject?.() || fallback;
}

async function toDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader === 'undefined') return '';
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('无法读取生成结果'));
    reader.readAsDataURL(blob);
  });
}

async function resolveMediaHref(node: WorkflowNode, runtime: WorkflowGenerationRuntime, cleanup: string[]) {
  if (node.metadata.storageKey) {
    const blob = await (runtime.loadMedia || workflowMediaStorage.get)(node.metadata.storageKey);
    if (!blob) return null;
    const href = URL.createObjectURL(blob);
    cleanup.push(href);
    return href;
  }
  return node.metadata.href || null;
}

async function mediaResult(result: Extract<UnifiedIgnitionResult, { ok: true }>, mode: 'image' | 'video', runtime: WorkflowGenerationRuntime) {
  try {
    const blob = await (runtime.fetchMedia || (href => fetch(href).then(response => {
      if (!response.ok) throw new Error('无法下载生成结果');
      return response.blob();
    })))(result.mediaUrl);
    const extension = mode === 'video' ? 'mp4' : 'png';
    const file = typeof File === 'undefined' ? Object.assign(blob, { name: `workflow-result.${extension}`, lastModified: Date.now() }) as File : new File([blob], `workflow-result.${extension}`, { type: result.mimeType || blob.type, lastModified: Date.now() });
    const record = await (runtime.ingestMedia || ingestWorkflowMedia)(file);
    return { blob, record };
  } finally {
    if (result.mediaUrl.startsWith('blob:')) URL.revokeObjectURL(result.mediaUrl);
  }
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject<T>(abortError());
  return Promise.race([promise, new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(abortError()), { once: true }))]);
}

export function cancelWorkflowGeneration(projectId: string, nodeId: string) {
  const key = requestKey(projectId, nodeId);
  const active = activeRequests.get(key);
  if (!active) return false;
  activeRequests.delete(key);
  active.controller.abort();
  const project = active.runtime.getProject?.();
  if (project) void publish(active.runtime, patchInitiator(project, nodeId, { status: 'idle', error: undefined, progress: undefined, generationRequestId: undefined }));
  return true;
}

export async function runWorkflowGeneration(project: WorkflowProject, nodeId: string, runtime: WorkflowGenerationRuntime): Promise<WorkflowProject> {
  const initialNode = project.nodes.find(node => node.id === nodeId);
  if (!initialNode) return project;
  const mode = modeFor(initialNode);
  if (mode === 'audio') {
    return publish(runtime, patchInitiator(canonical(runtime, project), nodeId, { status: 'error', error: '音频生成暂未支持', progress: undefined }));
  }

  cancelWorkflowGeneration(project.id, nodeId);
  const key = requestKey(project.id, nodeId);
  const requestId = nanoid();
  const controller = new AbortController();
  activeRequests.set(key, { requestId, controller, runtime });
  let current = patchInitiator(canonical(runtime, project), nodeId, { status: 'loading', error: undefined, progress: 0, generationRequestId: requestId });
  await publish(runtime, current);
  const temporaryUrls: string[] = [];
  const preparedNodes: WorkflowNode[] = [];
  const preparedConnections: WorkflowProject['connections'] = [];
  const preparedHistory: WorkflowHistoryPayload[] = [];
  let committed = false;

  const stillActive = () => {
    if (activeRequests.get(key)?.requestId !== requestId || controller.signal.aborted) return false;
    return canonical(runtime, current).nodes.some(node => node.id === nodeId && node.metadata.generationRequestId === requestId);
  };
  try {
    const initiating = canonical(runtime, current).nodes.find(node => node.id === nodeId) || initialNode;
    const config = initiating.metadata.config || { mode };
    const modelRef = config.modelId || preferredModel(runtime.modelPreference, mode);
    const resolved = resolveModelSelection(modelRef, runtime.userApiKeys, mode);
    if (!resolved) throw new Error(`未找到可用于${mode === 'video' ? '视频' : mode === 'text' ? '文本' : '图片'}生成的 API Key。`);

    const source = canonical(runtime, current);
    const incomingIds = source.connections.filter(connection => connection.toNodeId === nodeId).map(connection => connection.fromNodeId);
    const mentionedIds = initiating.metadata.mentionedNodeIds || [];
    const relatedIds = [...new Set([...incomingIds, ...mentionedIds])];
    const related = relatedIds.map(id => source.nodes.find(node => node.id === id)).filter((node): node is WorkflowNode => Boolean(node));
    const mediaLabels = mode === 'text' ? related.filter(node => node.type === 'image' || node.type === 'video' || node.type === 'audio').map(node => `[参考媒体: ${node.title} (${node.type})]`) : [];
    const prompt = [initiating.metadata.prompt, initiating.metadata.content, ...related.filter(node => node.type === 'text').map(node => node.metadata.content || node.metadata.prompt), ...mediaLabels]
      .map(value => value?.trim()).filter(Boolean).join('\n\n');
    if (!prompt) throw new Error('请填写提示词，或连接一个包含文本的上游节点。');

    const capability = getGenerationCapability(runtime.userApiKeys, mode, modelRef);
    const mediaSources = [...new Map([initiating, ...related].filter(node => node.type === 'image' || node.type === 'video' || node.type === 'audio').map(node => [node.id, node])).values()];
    const references = (await Promise.all(mediaSources.map(async node => {
      if (!capability.supportsReferences.includes(node.type as 'image' | 'video' | 'audio')) return null;
      const href = await resolveMediaHref(node, runtime, temporaryUrls);
      return href ? { type: node.type as 'image' | 'video' | 'audio', href, mimeType: node.metadata.mimeType, label: node.title, sourceName: node.title, elementId: node.id, slotRole: node.type === 'video' ? 'reference_video' as const : node.type === 'audio' ? 'reference_audio' as const : 'reference_image' as const } : null;
    }))).filter(Boolean) as NonNullable<UnifiedIgnitionInput['references']>;

    const createId = runtime.createId || nanoid;
    const count = mode === 'text' ? 1 : Math.max(1, Math.min(4, config.count || 1));
    for (let index = 0; index < count; index += 1) {
      if (!stillActive()) throw abortError();
      current = patchInitiator(canonical(runtime, current), nodeId, { status: 'loading', progress: Math.round(index / count * 90), generationRequestId: requestId });
      await publish(runtime, current);

      let resultNode: WorkflowNode;
      if (mode === 'text') {
        const content = await (runtime.executeText || generateTextWithProvider)(prompt, resolved.model, resolved.key, { signal: controller.signal });
        if (!stillActive()) throw abortError();
        resultNode = createWorkflowNode(createId(), 'text', { x: initiating.position.x + initiating.width + 80, y: initiating.position.y + index * 48 }, { content, status: 'success' });
        resultNode.title = '生成文本';
        preparedNodes.push(resultNode);
      } else {
        const provider = (runtime.executeMedia || executeUnifiedIgnition)({
          elementId: nodeId, prompt, modelId: resolved.model, apiKeyPayload: resolved.key,
          aspectRatio: config.aspectRatio as UnifiedIgnitionInput['aspectRatio'], durationSec: config.durationSec,
          resolution: config.resolution, generateAudio: config.generateAudio, watermark: config.watermark, references,
          signal: controller.signal,
          onProgress: progress => {
            if (!stillActive()) return;
            current = patchInitiator(canonical(runtime, current), nodeId, { status: 'loading', progress: Math.max(0, Math.min(99, progress)), generationRequestId: requestId });
            void publish(runtime, current);
          },
        });
        const result = await raceAbort(provider, controller.signal);
        if (!result.ok) throw new Error(result.errorMessage);
        if (!stillActive()) throw abortError();
        const { blob, record } = await mediaResult(result, mode, runtime);
        if (!stillActive()) {
          await discardWorkflowMediaRecord(record.storageKey);
          throw abortError();
        }
        resultNode = createWorkflowNode(createId(), mode, { x: initiating.position.x + initiating.width + 80, y: initiating.position.y + index * 48 }, { ...record, href: undefined, status: 'success' });
        resultNode.title = mode === 'video' ? '生成视频' : '生成图片';
        preparedNodes.push(resultNode);
        const size = { width: record.naturalWidth || resultNode.width, height: record.naturalHeight || resultNode.height };
        const historyBlob = mode === 'video' ? await (runtime.createVideoPoster || createWorkflowVideoPoster)(blob).catch(() => null) : blob;
        if (!stillActive()) throw abortError();
        const dataUrl = historyBlob ? await (runtime.encodeDataUrl || toDataUrl)(historyBlob).catch(() => '') : '';
        if (!stillActive()) throw abortError();
        preparedHistory.push({ name: resultNode.title, dataUrl, mimeType: mode === 'video' ? 'image/jpeg' : record.mimeType, ...size, prompt, mediaType: mode });
      }
      if (!stillActive()) throw abortError();
      preparedConnections.push({ id: createId(), fromNodeId: nodeId, toNodeId: resultNode.id });
    }

    if (!stillActive()) throw abortError();
    const latest = canonical(runtime, current);
    current = {
      ...latest,
      nodes: [...latest.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: 'success' as const, error: undefined, progress: 100, generationRequestId: undefined } } : node), ...preparedNodes],
      connections: [...latest.connections, ...preparedConnections],
    };
    activeRequests.delete(key);
    await publish(runtime, current);
    committed = true;
    preparedNodes.forEach(node => { if (node.metadata.storageKey) releaseWorkflowMediaRecord(node.metadata.storageKey); });
    if (runtime.saveHistory) for (const history of preparedHistory) {
      try { await runtime.saveHistory(history); }
      catch (error) { console.warn('[Workflow] Generation succeeded but history persistence failed.', error); }
    }
    return current;
  } catch (error) {
    const active = activeRequests.get(key);
    if (!committed) await Promise.all(preparedNodes.map(node => node.metadata.storageKey ? discardWorkflowMediaRecord(node.metadata.storageKey) : Promise.resolve()));
    if (active && active.requestId !== requestId) return canonical(runtime, current);
    if (activeRequests.get(key)?.requestId === requestId) activeRequests.delete(key);
    const latest = canonical(runtime, current);
    current = patchInitiator(latest, nodeId, isAbort(error)
      ? { status: 'idle', error: undefined, progress: undefined, generationRequestId: undefined }
      : { status: 'error', error: error instanceof Error ? error.message : '生成失败，请重试。', progress: undefined, generationRequestId: undefined });
    return publish(runtime, current);
  } finally {
    temporaryUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
