import { nanoid } from 'nanoid';
import { getUpstreamData } from '../components/workflow/ops';
import { CAMERA_MOVEMENTS, createWorkflowNode, STYLE_PRESETS } from '../components/workflow/constants';
import { createWorkflowVideoPoster, discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, releaseWorkflowMediaRecord, type WorkflowMediaRecord } from '../components/workflow/media';
import { filterSeedanceReferences, filterWorkflowInputIds, sortReferencesByOrder } from '../components/workflow/references';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { WorkflowGenerationMode, WorkflowNode, WorkflowProject } from '../components/workflow/types';
import type { ModelPreference, UserApiKey } from '../types';
import { resolveModelSelection } from '../utils/modelRefs';
import { executeUnifiedIgnition, generateTextWithProvider, SeedanceSubmissionUnknownError, type UnifiedIgnitionInput, type UnifiedIgnitionResult } from './aiGateway';
import { getGenerationCapability } from './generationCapabilities';
import { runPreflight } from './promptPreflight';
import { getProductModel } from './productModelCatalog';
import { usePromptHistoryStore } from '../stores/usePromptHistoryStore';
import { reserveApiUsage, updateApiUsage } from '../utils/usageMonitor';

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
const isAbort = (error: unknown) => Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
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
  if (project) void publish(active.runtime, patchInitiator(project, nodeId, { status: 'idle', error: undefined, progress: undefined, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined }));
  return true;
}

export async function runWorkflowGeneration(project: WorkflowProject, nodeId: string, runtime: WorkflowGenerationRuntime): Promise<WorkflowProject> {
  const initialNode = project.nodes.find(node => node.id === nodeId);
  if (!initialNode) return project;
  if (initialNode.type === 'script') return publish(runtime, patchInitiator(canonical(runtime, project), nodeId, { status: 'error', error: '脚本节点请双击打开编辑器进行拆解和批量生成', progress: undefined }));
  const mode = modeFor(initialNode);
  if (mode === 'audio') {
    return publish(runtime, patchInitiator(canonical(runtime, project), nodeId, { status: 'error', error: '音频生成暂未支持', progress: undefined }));
  }

  cancelWorkflowGeneration(project.id, nodeId);
  const key = requestKey(project.id, nodeId);
  const requestId = nanoid();
  const controller = new AbortController();
  activeRequests.set(key, { requestId, controller, runtime });
  let current = patchInitiator(canonical(runtime, project), nodeId, { status: 'loading', error: undefined, progress: 0, generationRequestId: requestId, generationStartedAt: Date.now(), generationMessage: undefined });
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
    const productModel = mode === 'text' ? undefined : getProductModel(modelRef);
    if (mode !== 'text' && productModel?.capability !== mode) {
      throw new Error(`Workflow ${mode === 'video' ? '视频' : '图片'}生成仅支持平台预设产品模型，请重新选择模型。`);
    }
    const selectionRef = productModel?.id || modelRef;
    const resolved = resolveModelSelection(selectionRef, runtime.userApiKeys, mode);
    if (!resolved) throw new Error(`未找到可用于${mode === 'video' ? '视频' : mode === 'text' ? '文本' : '图片'}生成的 API Key。`);

    const source = canonical(runtime, current);
    const upstream = getUpstreamData(initiating, source.nodes, source.connections);
    const mentionedIds = filterWorkflowInputIds(initiating.metadata.mentionedNodeIds || [], initiating.id, source.connections);
    const relatedIds = mentionedIds;
    const related = relatedIds.map(id => source.nodes.find(node => node.id === id)).filter((node): node is WorkflowNode => Boolean(node));
    const mediaLabels = mode === 'text' ? related.filter(node => node.type === 'image' || node.type === 'video' || node.type === 'audio').map(node => `[参考媒体: ${node.title} (${node.type})]`) : [];
    const stylePreset = config.styleId ? STYLE_PRESETS.find(s => s.id === config.styleId) : undefined;
    const cameraPrefix = config.camera ? [config.camera.camera, config.camera.lens, config.camera.focalLength, config.camera.aperture].filter(Boolean).join(', ') : '';
    const movement = mode === 'video' && config.cameraMovement ? CAMERA_MOVEMENTS.find(m => m.id === config.cameraMovement) : undefined;
    const movementKeyword = movement?.promptKeyword || (mode === 'video' ? config.customMovement : '');
    const promptPrefix = [stylePreset?.promptPrefix, cameraPrefix, movementKeyword].filter(Boolean).join(', ');
    const prompt = [promptPrefix, initiating.metadata.prompt, initiating.metadata.content, ...upstream.textContents, ...mediaLabels]
      .map(value => value?.trim()).filter(Boolean).join('\n\n');
    if (!prompt) throw new Error('请填写提示词，或连接一个包含文本的上游节点。');

    usePromptHistoryStore.getState().record({
        prompt,
        mode: mode === 'video' ? 'video' : mode === 'text' ? 'text' : 'image',
        source: 'workflow',
    });

    const preflight = await runPreflight(prompt, selectionRef, runtime.userApiKeys, mode, {
      optimize: Boolean(config.enhancePrompt),
      localComplianceCheck: config.realPersonCheck !== false,
    });
    const effectivePrompt = preflight.optimizedPrompt;
    if (preflight.complianceWarnings.length > 0) {
      current = patchInitiator(canonical(runtime, current), nodeId, { status: 'error', error: `合规警告：检测到敏感关键词 ${preflight.complianceWarnings.join(', ')}，请修改提示词后重试。`, generationRequestId: requestId });
      await publish(runtime, current);
      throw new Error(`合规校验未通过：${preflight.complianceWarnings.join(', ')}`);
    }

    const capability = getGenerationCapability(runtime.userApiKeys, mode, selectionRef);
    const mediaSources = [...new Map(related.filter(node => node.type === 'image' || node.type === 'video' || node.type === 'audio').map(node => [node.id, node])).values()];
    const autoReferences = (await Promise.all(mediaSources.map(async node => {
      if (!capability.supportsReferences.includes(node.type as 'image' | 'video' | 'audio')) return null;
      const href = await resolveMediaHref(node, runtime, temporaryUrls);
      return href ? { type: node.type as 'image' | 'video' | 'audio', href, mimeType: node.metadata.mimeType, label: node.title, sourceName: node.title, elementId: node.id, slotRole: node.type === 'video' ? 'reference_video' as const : node.type === 'audio' ? 'reference_audio' as const : 'reference_image' as const } : null;
    }))).filter(Boolean) as NonNullable<UnifiedIgnitionInput['references']>;

    const seedanceRefs = filterSeedanceReferences(config.seedanceRefs, initiating.id, source.connections);
    const seedanceRefIds = [
      ...seedanceRefs.imageRefs,
      ...seedanceRefs.videoRefs,
      ...seedanceRefs.audioRefs,
    ];
    const seedanceReferences = seedanceRefIds.length > 0 ? (await Promise.all(seedanceRefIds.map(async id => {
      const node = source.nodes.find(n => n.id === id);
      if (!node) return null;
      const href = await resolveMediaHref(node, runtime, temporaryUrls);
      return href ? { type: node.type as 'image' | 'video' | 'audio', href, mimeType: node.metadata.mimeType, label: node.title, sourceName: node.title, elementId: node.id, slotRole: node.type === 'video' ? 'reference_video' as const : node.type === 'audio' ? 'reference_audio' as const : 'reference_image' as const } : null;
    }))).filter(Boolean) as NonNullable<UnifiedIgnitionInput['references']> : [];

    const seenIds = new Set<string>();
    const deduped = [...seedanceReferences, ...autoReferences].filter(ref => {
      if (!ref.elementId) return true;
      if (seenIds.has(ref.elementId)) return false;
      seenIds.add(ref.elementId);
      return true;
    });
    // 按 PromptBar 参考图 chip 面板的拖拽顺序重排 Provider 引用，决定首帧/尾帧等角色分配
    let references = sortReferencesByOrder(deduped, ref => ref.elementId || '', initiating.metadata.imageReferenceOrder);
    if (mode === 'video' && config.submode) {
      const imageReferences = references.filter(reference => reference.type === 'image');
      if (config.submode === 'image-to-video' && imageReferences.length < 1) throw new Error('图生视频至少需要引用 1 张图片。');
      if (config.submode === 'reference-to-video' && references.length < 1) throw new Error('全能参考至少需要引用 1 个媒体节点。');
      if (config.submode === 'first-last-frame' && imageReferences.length < 2) throw new Error('首尾帧模式需要按顺序引用 2 张图片。');
      let imageIndex = 0;
      references = references.map(reference => {
        if (reference.type !== 'image') return reference;
        const index = imageIndex++;
        if (config.submode === 'image-to-video' && index === 0) return { ...reference, slotRole: 'first_frame' };
        if (config.submode === 'first-last-frame') return { ...reference, slotRole: index === 0 ? 'first_frame' : index === 1 ? 'last_frame' : 'reference_image' };
        return { ...reference, slotRole: 'reference_image' };
      });
    }

    const createId = runtime.createId || nanoid;
    const count = mode === 'text' ? 1 : Math.max(1, Math.min(4, config.count || 1));
    const batched = count > 1;
    const batchId = batched ? createId() : undefined;
    const previousStorageKey = initiating.metadata.storageKey;

    for (let index = 0; index < count; index += 1) {
      if (!stillActive()) throw abortError();
      current = patchInitiator(canonical(runtime, current), nodeId, { status: 'loading', progress: Math.round(index / count * 90), generationRequestId: requestId, generationStartedAt: Date.now(), generationMessage: undefined, error: undefined });
      await publish(runtime, current);

      if (mode === 'text') {
        const content = await (runtime.executeText || generateTextWithProvider)(effectivePrompt, resolved.model, resolved.key, { signal: controller.signal });
        if (!stillActive()) throw abortError();
        if (batched) {
          const resultNode = createWorkflowNode(createId(), 'text', { x: initiating.position.x + initiating.width + 80, y: initiating.position.y + index * 48 }, { content, status: 'success' });
          resultNode.title = '生成文本';
          preparedNodes.push(resultNode);
          if (!stillActive()) throw abortError();
          preparedConnections.push({ id: createId(), fromNodeId: nodeId, toNodeId: resultNode.id });
        } else {
          const latest = canonical(runtime, current);
          current = {
            ...latest,
            nodes: latest.nodes.map(node => node.id === nodeId
              ? { ...node, type: 'text', metadata: { ...node.metadata, content, status: 'loading' as const, error: undefined, progress: 100 } }
              : node),
          };
        }
        if (!stillActive()) throw abortError();
        const dataUrl = await (runtime.encodeDataUrl || toDataUrl)(new Blob([content], { type: 'text/plain' })).catch(() => '');
        if (!stillActive()) throw abortError();
        preparedHistory.push({ name: '生成文本', dataUrl, mimeType: 'text/plain', width: 0, height: 0, prompt: effectivePrompt, mediaType: undefined });
        continue;
      }

      const usage = runtime.executeMedia ? null : await reserveApiUsage({ key: resolved.key, productModelId: selectionRef, upstreamModelId: resolved.model, type: mode === 'video' ? 'video' : 'image', durationSec: config.durationSec, count: 1 });
      let result: UnifiedIgnitionResult;
      try {
        const provider = (runtime.executeMedia || executeUnifiedIgnition)({
          elementId: nodeId, prompt: effectivePrompt, modelId: resolved.model, apiKeyPayload: resolved.key,
          productModelId: selectionRef,
          generationSubmode: config.submode,
          aspectRatio: config.aspectRatio as UnifiedIgnitionInput['aspectRatio'], durationSec: config.durationSec,
          resolution: config.resolution, quality: config.quality, generateAudio: config.generateAudio, watermark: config.watermark,
          webSearch: config.webSearch, realPersonCheck: config.realPersonCheck, references,
          signal: controller.signal,
          onProgress: (progress, message) => {
            if (!stillActive()) return;
            current = patchInitiator(canonical(runtime, current), nodeId, { status: 'loading', progress: Math.max(0, Math.min(99, progress)), generationRequestId: requestId, generationMessage: message, generationStartedAt: current.nodes.find(node => node.id === nodeId)?.metadata.generationStartedAt || Date.now() });
            void publish(runtime, current);
          },
        });
        result = await raceAbort(provider, controller.signal);
      } catch (error) {
        const isSeedance = resolved.model.toLowerCase().includes('seedance');
        if (usage) await updateApiUsage(usage.id, {
          status: error instanceof SeedanceSubmissionUnknownError || (isSeedance && isAbort(error)) ? 'submission_unknown' : isAbort(error) ? 'canceled' : 'failed',
          billableState: 'unknown',
          error: error instanceof Error ? error.message : '生成失败',
        });
        throw error;
      }
      if (controller.signal.aborted) throw abortError();
      if (!result.ok) {
        const errorMessage = 'errorMessage' in result ? result.errorMessage : '生成失败';
        if (usage) await updateApiUsage(usage.id, { status: 'failed', billableState: 'unknown', error: errorMessage });
        throw new Error(errorMessage);
      }
      if (usage) await updateApiUsage(usage.id, { status: 'succeeded', billableState: usage.estimatedCost === undefined ? 'unknown' : 'estimated' });
      if (!stillActive()) throw abortError();
      const { blob, record } = await mediaResult(result, mode, runtime);
      if (!stillActive()) {
        await discardWorkflowMediaRecord(record.storageKey);
        throw abortError();
      }

      if (batched) {
        const resultNode = createWorkflowNode(createId(), mode, { x: initiating.position.x + initiating.width + 80, y: initiating.position.y + index * 48 }, { ...record, href: undefined, status: 'success' });
        resultNode.title = mode === 'video' ? '生成视频' : '生成图片';
        preparedNodes.push(resultNode);
        if (!stillActive()) throw abortError();
        preparedConnections.push({ id: createId(), fromNodeId: nodeId, toNodeId: resultNode.id });
      } else {
        const size = fitWorkflowMediaSize(mode, record.naturalWidth, record.naturalHeight);
        const center = { x: initiating.position.x + initiating.width / 2, y: initiating.position.y + initiating.height / 2 };
        const latest = canonical(runtime, current);
        current = {
          ...latest,
          nodes: latest.nodes.map(node => node.id === nodeId
            ? {
                ...node,
                type: mode,
                position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: { ...node.metadata, ...record, href: undefined, status: 'loading' as const, error: undefined, progress: 100 },
              }
            : node),
        };
        if (previousStorageKey && previousStorageKey !== record.storageKey) {
          await discardWorkflowMediaRecord(previousStorageKey);
        }
        // 新生成结果在 commit success 之前必须留在 pendingReferences 里保活：
        // 非批量路径会把新 storageKey 提前写进 `current`（节点状态仍是 loading），
        // 而 store 的 updateProject 与 InfiniteWorkflow 的 nodes effect 都会触发
        // 异步 pruneWorkflowMedia。RunningHub 这类慢速轮询路径上，progress 回调
        // 会反复 publish 带 new storageKey 的 loading 节点，每次都触发一次 prune。
        // 若在此处提前 release，new key 既脱离 pending 保护、又可能在 canonicalReferences
        // 重建之前被某次 prune 命中，导致刚存入 IDB 的结果被删，画布读不到图片。
        // 因此 release 推迟到 commit success 之后（见下方非批量分支收尾处）。
      }

      if (!stillActive()) throw abortError();
      const historySize = { width: record.naturalWidth || 320, height: record.naturalHeight || 180 };
      const historyBlob = mode === 'video' ? await (runtime.createVideoPoster || createWorkflowVideoPoster)(blob).catch(() => null) : blob;
      if (!stillActive()) throw abortError();
      const dataUrl = historyBlob ? await (runtime.encodeDataUrl || toDataUrl)(historyBlob).catch(() => '') : '';
      if (!stillActive()) throw abortError();
      preparedHistory.push({ name: mode === 'video' ? '生成视频' : '生成图片', dataUrl, mimeType: mode === 'video' ? 'image/jpeg' : record.mimeType, ...historySize, prompt: effectivePrompt, mediaType: mode });
    }

    if (batchId) preparedNodes.forEach((node, index) => { node.batchId = batchId; node.batchIndex = index; });

    if (!stillActive()) throw abortError();
    if (batched) {
      const latest = canonical(runtime, current);
      current = {
        ...latest,
        nodes: [...latest.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: 'success' as const, error: undefined, progress: 100, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined } } : node), ...preparedNodes],
        connections: [...latest.connections, ...preparedConnections],
      };
    } else {
      current = patchInitiator(current, nodeId, { status: 'success' as const, error: undefined, progress: 100, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined });
    }
    activeRequests.delete(key);
    await publish(runtime, current);
    committed = true;
    preparedNodes.forEach(node => { if (node.metadata.storageKey) releaseWorkflowMediaRecord(node.metadata.storageKey); });
    // 非批量路径的结果直接替换了原节点（不在 preparedNodes 里），需在此补一次 release，
    // 与批量路径在 commit 后释放 pending 引用的时机对齐。
    if (!batched) {
      const committedNode = current.nodes.find(node => node.id === nodeId);
      if (committedNode?.metadata.storageKey) releaseWorkflowMediaRecord(committedNode.metadata.storageKey);
    }
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
      ? { status: 'idle', error: undefined, progress: undefined, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined }
      : { status: 'error', error: error instanceof Error ? error.message : '生成失败，请重试。', progress: undefined, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined });
    return publish(runtime, current);
  } finally {
    temporaryUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
