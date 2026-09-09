import { nanoid } from 'nanoid';
import { CAMERA_MOVEMENTS, createWorkflowNode, STYLE_PRESETS } from '../components/workflow/constants';
import { buildCanonicalGenerationInput, resolveWorkflowInputs, type CanonicalGenerationInput, type WorkflowAssetReferenceInput } from '../components/workflow/inputResolver';
import { promptIntentFromNode, type PromptIntent } from '../components/workflow/promptIntent';
import { createWorkflowVideoPoster, discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, isWorkflowMediaKeyReferenced, releaseWorkflowMediaRecord, workflowDataUrlToBlob, type WorkflowMediaRecord } from '../components/workflow/media';
import type { WorkflowGenerationMode, WorkflowNode, WorkflowProject } from '../components/workflow/types';
import type { ProductModelMode, UserApiKey } from '../types';
import { executeUnifiedIgnition, generateTextWithProvider, SeedanceSubmissionUnknownError, type UnifiedIgnitionInput, type UnifiedIgnitionResult } from './aiGateway';
import { getGenerationCapability } from './generationCapabilities';
import { runPreflight } from './promptPreflight';
import { getProductModel, getRoutedImageModes, getRoutedVideoModes } from './productModelCatalog';
import { usePromptHistoryStore } from '../stores/usePromptHistoryStore';
import { refundApiUsage, reserveApiUsage, updateApiUsage } from '../utils/usageMonitor';
import { resolveRouteMappingForSubmit, type RouteFallbackResolution } from './routeMapping';
import { requireWorkflowResourceHref, type CreativeHostResourceLocator } from './workflowResourceResolver';
import { beginWorkflowOperationTake, completeWorkflowOperationTake } from '../components/workflow/operations';
import { validateWorkflowOperationOutputs } from '../components/workflow/operationRegistry';
import type { ProviderMaterializedReference } from './providerGenerationAdapter';
import { resolveProviderGenerationExtension } from './userScriptProviderAdapter';

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
  confirmRouteFallback?: (resolution: RouteFallbackResolution) => boolean | Promise<boolean>;
  executeMedia?: (input: UnifiedIgnitionInput) => Promise<UnifiedIgnitionResult>;
  executeText?: typeof generateTextWithProvider;
  runId?: string;
  onCanonicalInput?: (input: CanonicalGenerationInput) => void;
 /** 可由 PromptBar/Agent 传入；未提供时从当前 Draft 节点生成同一稳定意图投影。 */
 promptIntent?: PromptIntent;
  /** 刷新后恢复已提交的视频任务；只传给支持 resume 的 Provider adapter。 */
  resumeProviderTaskId?: string;
 getProject?: () => WorkflowProject | null;
  onProjectChange?: (project: WorkflowProject) => void | Promise<void>;
  saveHistory?: (payload: WorkflowHistoryPayload) => void | Promise<void>;
  createId?: () => string;
  assets?: readonly WorkflowAssetReferenceInput[];
  loadMedia?: (storageKey: string) => Promise<Blob | null>;
  loadCreativeHostResource?: (locator: CreativeHostResourceLocator) => Promise<Blob | null>;
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

function modeFor(node: WorkflowNode): WorkflowGenerationMode {
  if (node.type === 'config') return node.metadata.config?.mode || 'image';
  if (node.type === 'text') return node.metadata.config?.mode || 'text';
  if (node.type === 'video') return node.metadata.config?.mode || 'video';
  if (node.type === 'audio') return 'audio';
  return node.metadata.config?.mode || 'image';
}

async function materializeCanonicalReferences(
  input: CanonicalGenerationInput,
  runtime: WorkflowGenerationRuntime,
  temporaryUrls: string[],
  allowArtifactReference: boolean,
): Promise<ProviderMaterializedReference[]> {
  return Promise.all(input.references.map(async ({ resource, role, label, order }) => {
    const kind = resource.kind as 'image' | 'video' | 'audio';
    const href = await requireWorkflowResourceHref(resource, { loadMedia: runtime.loadMedia, loadCreativeHostResource: runtime.loadCreativeHostResource }, temporaryUrls, { allowArtifactReference });
    return {
      resourceId: resource.resourceId,
      type: kind,
      href,
      artifactRef: resource.artifactRef,
      mimeType: resource.mimeType,
      label: label || resource.title,
      sourceName: resource.title,
      elementId: resource.sourceNodeId,
      role,
      order,
    };
  }));
}

function patchInitiator(project: WorkflowProject, nodeId: string, metadata: Record<string, unknown>): WorkflowProject {
  return { ...project, nodes: project.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...metadata } } : node) };
}

async function publish(runtime: WorkflowGenerationRuntime, project: WorkflowProject) {
  const result = runtime.onProjectChange?.(project);
  await result;
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

async function mediaResult(result: Extract<UnifiedIgnitionResult, { ok: true }>, mode: 'image' | 'video', runtime: WorkflowGenerationRuntime) {
  try {
    const blob = /^data:/i.test(result.mediaUrl)
      ? await workflowDataUrlToBlob(result.mediaUrl)
      : await (runtime.fetchMedia || (href => fetch(href).then(response => {
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
  const isImageOperation = initialNode.type === 'operation' && initialNode.metadata.operation?.capabilityId === 'image.generate@1';
  if (initialNode.type === 'operation' && !isImageOperation) {
    return publish(runtime, patchInitiator(canonical(runtime, project), nodeId, { status: 'error', error: '该 Operation 需要对应的图片处理执行器', progress: undefined }));
  }
  if (initialNode.type === 'script') return publish(runtime, patchInitiator(canonical(runtime, project), nodeId, { status: 'error', error: '脚本节点请双击打开编辑器进行拆解和批量生成', progress: undefined }));
  const mode = modeFor(initialNode);
  if (mode === 'audio') {
    return publish(runtime, patchInitiator(canonical(runtime, project), nodeId, { status: 'error', error: '音频生成暂未支持', progress: undefined }));
  }

  cancelWorkflowGeneration(project.id, nodeId);
  const key = requestKey(project.id, nodeId);
  const requestId = runtime.runId || nanoid();
  const controller = new AbortController();
  activeRequests.set(key, { requestId, controller, runtime });
  let current = patchInitiator(canonical(runtime, project), nodeId, { status: 'loading', error: undefined, progress: 0, generationRequestId: requestId, generationStartedAt: Date.now(), generationMessage: undefined });
  await publish(runtime, current);
  const temporaryUrls: string[] = [];
  const preparedNodes: WorkflowNode[] = [];
  const preparedConnections: WorkflowProject['connections'] = [];
  const preparedHistory: WorkflowHistoryPayload[] = [];
  let committed = false;
  let operationTakeId: string | undefined;

  const stillActive = () => {
    if (activeRequests.get(key)?.requestId !== requestId || controller.signal.aborted) return false;
    return canonical(runtime, current).nodes.some(node => node.id === nodeId && node.metadata.generationRequestId === requestId);
  };
  try {
    const initiating = canonical(runtime, current).nodes.find(node => node.id === nodeId) || initialNode;
    const config = initiating.metadata.config || { mode };
    const modelRef = config.modelId || '';
    if (mode !== 'text' && !modelRef) {
      throw new Error(`请先在 PromptBar 明确选择${mode === 'video' ? '视频' : '图片'}产品模型。`);
    }
    const productModel = mode === 'text' ? undefined : getProductModel(modelRef);
    if (mode !== 'text' && productModel?.capability !== mode) {
      throw new Error(`Workflow ${mode === 'video' ? '视频' : '图片'}生成仅支持平台预设产品模型，请重新选择模型。`);
    }
    const selectionRef = productModel?.id || modelRef;
    const source = canonical(runtime, current);
    const promptIntent = runtime.promptIntent?.targetNodeId === initiating.id
      ? runtime.promptIntent
      : promptIntentFromNode(initiating, 'generate');
    const resolvedInputs = resolveWorkflowInputs(initiating, source.nodes, source.connections, { assets: runtime.assets, promptIntent });
    let productMode: ProductModelMode = (config.submode as ProductModelMode | undefined)
      || (mode === 'video' ? 'text-to-video' : 'text-to-image');
    // 未显式选择 submode 时，只从同一份 ResolvedNodeInputs 推导输入模式。
    if (!config.submode && productModel) {
      const earlyMedia = resolvedInputs.references.map(reference => reference.resource);
      if (mode === 'image' && earlyMedia.some(resource => resource.kind === 'image') && productModel.capabilities.modes.includes('image-to-image')) {
        productMode = 'image-to-image';
      } else if (mode === 'video' && earlyMedia.length > 0) {
        const imageCount = earlyMedia.filter(resource => resource.kind === 'image').length;
        const needsGeneralReference = earlyMedia.some(resource => resource.kind === 'video' || resource.kind === 'audio') || imageCount > 1;
        if (needsGeneralReference && productModel.capabilities.modes.includes('reference-to-video')) productMode = 'reference-to-video';
        else if (imageCount > 0 && productModel.capabilities.modes.includes('image-to-video')) productMode = 'image-to-video';
      }
    }
    const resolved = await resolveRouteMappingForSubmit(
      mode === 'text'
        ? { kind: 'runtime-capability', capability: 'agent-text' }
        : { kind: 'product-mode', productModelId: selectionRef, mode: productMode },
      runtime.userApiKeys,
      runtime.confirmRouteFallback,
    );
    const providerExtension = resolveProviderGenerationExtension(resolved.key);
    if (providerExtension.kind === 'official' && mode === 'video' && productModel && config.submode) {
      const routedModes = getRoutedVideoModes(productModel.id, resolved.key.provider, resolved.routeId);
      if (!routedModes.includes(config.submode as ProductModelMode)) {
        const label = config.submode === 'first-last-frame' ? '首尾帧' : config.submode === 'reference-to-video' ? '全能参考' : config.submode === 'image-to-video' ? '图生视频' : '文生视频';
        throw new Error(`当前 API 线路不支持${label}，请更换生成方式或重新映射支持该能力的 Provider。`);
      }
    }
    if (providerExtension.kind === 'official' && mode === 'image' && productModel && config.submode) {
      const routedModes = getRoutedImageModes(productModel.id, resolved.key.provider, resolved.routeId);
      if (!routedModes.includes(config.submode as ProductModelMode)) {
        const label = config.submode === 'image-to-image' ? '图生图' : '文生图';
        throw new Error(`当前 API 线路不支持${label}，请更换生成方式或重新映射支持该能力的 Provider。`);
      }
    }

    const mediaLabels = mode === 'text'
      ? resolvedInputs.resources.filter(resource => resource.kind !== 'text').map(resource => `[参考媒体: ${resource.title} (${resource.kind})]`)
      : [];
    const stylePreset = config.styleId ? STYLE_PRESETS.find(s => s.id === config.styleId) : undefined;
    const cameraPrefix = config.camera ? [config.camera.camera, config.camera.lens, config.camera.focalLength, config.camera.aperture].filter(Boolean).join(', ') : '';
    const movement = mode === 'video' && config.cameraMovement ? CAMERA_MOVEMENTS.find(m => m.id === config.cameraMovement) : undefined;
    const movementKeyword = movement?.promptKeyword || (mode === 'video' ? config.customMovement : '');
    const promptPrefix = [stylePreset?.promptPrefix, cameraPrefix, movementKeyword].filter(Boolean).join(', ');
    const prompt = [promptPrefix, resolvedInputs.prompt, ...resolvedInputs.texts.map(resource => resource.text), ...mediaLabels]
      .map(value => value?.trim()).filter(Boolean).join('\n\n');
    if (!prompt) throw new Error('请填写提示词，或连接一个包含文本的上游节点。');

    usePromptHistoryStore.getState().record({
        prompt,
        mode: mode === 'video' ? 'video' : mode === 'text' ? 'text' : 'image',
        source: 'workflow',
    });

    const preflight = await runPreflight(prompt, resolved.routeId, runtime.userApiKeys, mode, {
      optimize: Boolean(config.enhancePrompt),
      localComplianceCheck: config.realPersonCheck !== false,
      confirmRouteFallback: runtime.confirmRouteFallback,
    });
    const effectivePrompt = preflight.optimizedPrompt;
    if (preflight.complianceWarnings.length > 0) {
      current = patchInitiator(canonical(runtime, current), nodeId, { status: 'error', error: `合规警告：检测到敏感关键词 ${preflight.complianceWarnings.join(', ')}，请修改提示词后重试。`, generationRequestId: requestId });
      await publish(runtime, current);
      throw new Error(`合规校验未通过：${preflight.complianceWarnings.join(', ')}`);
    }

    const capability = getGenerationCapability(runtime.userApiKeys, mode, selectionRef);
    let effectiveAspectRatio = config.aspectRatio as UnifiedIgnitionInput['aspectRatio'];
    if (config.preserveReferenceAspectRatio && resolvedInputs.references.some(reference => reference.resource.kind === 'image' && reference.resource.available)) {
      const firstImageReference = resolvedInputs.references.find(reference => reference.resource.kind === 'image' && reference.resource.available);
      if (firstImageReference) {
        const refNode = source.nodes.find(node => node.id === firstImageReference.resource.sourceNodeId);
        const naturalWidth = refNode?.metadata.naturalWidth;
        const naturalHeight = refNode?.metadata.naturalHeight;
        if (naturalWidth && naturalHeight && naturalHeight > 0) {
          const targetRatio = naturalWidth / naturalHeight;
          const candidates = (capability.aspectRatios || []).filter(ratio => ratio !== 'adaptive');
          const matched = candidates.length > 0
            ? candidates.reduce<{ ratio: string; diff: number }>((best, ratio) => {
                const [w, h] = ratio.split(':').map(Number);
                if (!w || !h) return best;
                const diff = Math.abs(w / h - targetRatio);
                return diff < best.diff ? { ratio, diff } : best;
              }, { ratio: candidates[0], diff: Infinity }).ratio
            : undefined;
          if (matched) effectiveAspectRatio = matched as UnifiedIgnitionInput['aspectRatio'];
        }
      }
    }
    const canonicalInput = buildCanonicalGenerationInput({
      targetNode: initiating,
      inputs: resolvedInputs,
      prompt: effectivePrompt,
      mode,
      submode: productMode,
      parameters: {
        modelId: selectionRef,
        aspectRatio: effectiveAspectRatio,
        durationSec: config.durationSec,
        resolution: config.resolution,
        quality: config.quality,
        generateAudio: config.generateAudio,
        watermark: config.watermark,
      },
    });
    const inputError = canonicalInput.diagnostics.find(item => item.severity === 'error');
    if (inputError) throw new Error(inputError.message);
    runtime.onCanonicalInput?.(canonicalInput);
    const providerContext = {
      provider: resolved.key.provider,
      routeId: resolved.routeId,
      productModelId: selectionRef,
    };
    if (mode !== 'text') {
      const providerValidation = providerExtension.generation.validate(canonicalInput, providerContext);
      if (!providerValidation.ok) throw new Error(providerValidation.errors[0]?.message || '当前 AI 服务不支持该生成输入。');
    }
    const materializedReferences = await materializeCanonicalReferences(canonicalInput, runtime, temporaryUrls, Boolean(resolved.key.runtimeManaged));
    const providerRequest = providerExtension.generation.serialize(canonicalInput, materializedReferences, providerContext);
    const generationSubmode = providerRequest.generationSubmode;
    const references = providerRequest.references;

    const createId = runtime.createId || nanoid;
    if (isImageOperation) {
      const latest = canonical(runtime, current);
      const operation = latest.nodes.find(node => node.id === nodeId);
      if (!operation) throw new Error('图片生成 Operation 已不存在');
      const started = await beginWorkflowOperationTake(operation, {
        id: createId(),
        snapshotId: createId(),
        renderedPrompt: effectivePrompt,
        routeId: resolved.routeId,
      });
      operationTakeId = started.take.id;
      current = { ...latest, nodes: latest.nodes.map(node => node.id === nodeId ? started.node : node) };
      await publish(runtime, current);
    }
    const count = mode === 'text' ? 1 : Math.max(1, Math.min(4, config.count || 1));
    const batched = count > 1;
    const batchId = batched ? createId() : undefined;
    const previousStorageKey = initiating.metadata.storageKey;

    for (let index = 0; index < count; index += 1) {
      if (!stillActive()) throw abortError();
      current = patchInitiator(canonical(runtime, current), nodeId, { status: 'loading', progress: Math.round(index / count * 90), generationRequestId: requestId, generationStartedAt: Date.now(), generationMessage: undefined, error: undefined });
      await publish(runtime, current);

      if (mode === 'text') {
        const content = await (runtime.executeText || generateTextWithProvider)(effectivePrompt, resolved.routeId, resolved.key, { signal: controller.signal });
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

      const usage = runtime.executeMedia ? null : await reserveApiUsage({ key: resolved.key, productModelId: selectionRef, routeId: resolved.routeId, type: mode === 'video' ? 'video' : 'image', durationSec: config.durationSec, count: 1, resolution: config.resolution, quality: config.quality });
      let usageReconciled = false;
      if (usage) {
        current = patchInitiator(canonical(runtime, current), nodeId, {
          generationUsageRecordId: usage.id,
          generationEstimatedCost: usage.estimatedCost,
          generationCurrency: usage.currency,
          generationBillableState: usage.billableState,
        });
        await publish(runtime, current);
      }
      let result: UnifiedIgnitionResult;
      try {
        const provider = (runtime.executeMedia || executeUnifiedIgnition)({
          elementId: nodeId, prompt: effectivePrompt, modelId: resolved.routeId, apiKeyPayload: resolved.key,
          productModelId: providerRequest.productModelId,
          generationCapability: providerRequest.capability,
          generationSubmode,
          aspectRatio: providerRequest.aspectRatio as UnifiedIgnitionInput['aspectRatio'], durationSec: providerRequest.durationSec,
          resolution: providerRequest.resolution, quality: providerRequest.quality, generateAudio: providerRequest.generateAudio, watermark: providerRequest.watermark,
          webSearch: config.webSearch, realPersonCheck: config.realPersonCheck, references,
         canonicalInput,
         materializedReferences,
         signal: controller.signal,
          resumeProviderTaskId: runtime.resumeProviderTaskId,
          onProgress: (progress, message) => {
            if (!stillActive()) return;
            current = patchInitiator(canonical(runtime, current), nodeId, { status: 'loading', progress: Math.max(0, Math.min(99, progress)), generationRequestId: requestId, generationMessage: message, generationStartedAt: current.nodes.find(node => node.id === nodeId)?.metadata.generationStartedAt || Date.now() });
             void publish(runtime, current);
           },
          onProviderTaskLifecycle: async event => {
            if (!usage) return;
            if (event.phase === 'submitted') {
              await updateApiUsage(usage.id, { status: 'queued', providerTaskId: event.providerTaskId, submitTime: event.submittedAt });
              current = patchInitiator(canonical(runtime, current), nodeId, { generationProviderTaskId: event.providerTaskId, generationMessage: '任务已提交，等待供应商处理' });
            } else if (event.phase === 'running') {
              await updateApiUsage(usage.id, { status: 'running', providerTaskId: event.providerTaskId, startTime: Date.now() });
              current = patchInitiator(canonical(runtime, current), nodeId, { generationProviderTaskId: event.providerTaskId, generationMessage: event.remoteStatus || '供应商正在生成' });
            } else if (event.phase === 'cancelled') {
              if (event.canceled) {
                await refundApiUsage(usage.id, '供应商已确认取消');
                current = patchInitiator(canonical(runtime, current), nodeId, { generationBillableState: 'refunded', generationMessage: '供应商已确认取消' });
              } else {
                await updateApiUsage(usage.id, { status: 'submission_unknown', billableState: 'unknown', providerTaskId: event.providerTaskId, error: event.message });
                current = patchInitiator(canonical(runtime, current), nodeId, { generationBillableState: 'unknown', generationMessage: event.upstreamStillRunning ? '已停止本地等待；上游可能仍在运行并计费' : event.message });
              }
            } else {
              usageReconciled = true;
              const currency = event.currency === 'USD' || event.currency === 'CNY' ? event.currency : undefined;
              await updateApiUsage(usage.id, {
                status: event.status === 'succeeded' ? 'succeeded' : event.status === 'cancelled' ? 'canceled' : event.status === 'failed' || event.status === 'expired' ? 'failed' : 'polling_unknown',
                billableState: event.amount !== undefined ? 'actual' : 'unknown',
                actualCost: event.amount,
                actualTokens: event.totalTokens,
                currency,
                finishTime: Date.now(),
              });
              current = patchInitiator(canonical(runtime, current), nodeId, {
                generationActualCost: event.amount,
                generationActualTokens: event.totalTokens,
                generationCurrency: currency || usage.currency,
                generationBillableState: event.amount !== undefined ? 'actual' : 'unknown',
              });
            }
            await publish(runtime, current);
          },
        });
        result = await raceAbort(provider, controller.signal);
      } catch (error) {
        const isSeedance = resolved.routeId.toLowerCase().includes('seedance');
        if (usage) await updateApiUsage(usage.id, {
          status: error instanceof SeedanceSubmissionUnknownError || (isSeedance && isAbort(error)) ? 'submission_unknown' : isAbort(error) ? 'canceled' : 'failed',
          ...(usageReconciled ? {} : { billableState: 'unknown' as const }),
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
      if (usage) await updateApiUsage(usage.id, { status: 'succeeded' });
      if (!stillActive()) throw abortError();
      const { blob, record } = await mediaResult(result, mode, runtime);
      if (!stillActive()) {
        await discardWorkflowMediaRecord(record.storageKey);
        throw abortError();
      }

      if (batched) {
        const resultNode = {
          ...createWorkflowNode(createId(), mode, { x: initiating.position.x + initiating.width + 80, y: initiating.position.y + index * 48 }, {
            ...record,
            href: undefined,
            status: 'success',
            config: initiating.metadata.config,
            sourceOperationNodeId: isImageOperation ? nodeId : undefined,
            operationTakeId: isImageOperation ? operationTakeId : undefined,
            operationOutputRole: isImageOperation ? 'result_image' : undefined,
          }),
          ...fitWorkflowMediaSize(mode, record.naturalWidth, record.naturalHeight),
        };
        resultNode.title = mode === 'video' ? '生成视频' : '生成图片';
        preparedNodes.push(resultNode);
        if (!stillActive()) throw abortError();
        preparedConnections.push({
          id: createId(), fromNodeId: nodeId, toNodeId: resultNode.id,
          kind: isImageOperation ? 'operation-output' : 'data',
          role: isImageOperation ? 'result_image' : undefined,
          order: isImageOperation ? index : undefined,
        });
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
                metadata: {
                  ...node.metadata,
                  ...record,
                  href: undefined,
                  status: 'loading' as const,
                  error: undefined,
                  progress: 100,
                  ...(operationTakeId ? { operationTakeId, sourceOperationNodeId: nodeId } : {}),
                },
              }
            : node),
        };
        if (previousStorageKey && previousStorageKey !== record.storageKey) {
          // 旧图可能同时被隐藏输入、克隆节点或撤销历史引用（storageKey 无引用计数），
          // 只有确认无任何其它持有者时才物理删除，否则交给 prune 按可达性回收。
          const latestProject = canonical(runtime, current);
          if (!isWorkflowMediaKeyReferenced(previousStorageKey, [latestProject])) {
            await discardWorkflowMediaRecord(previousStorageKey);
          }
        }
        // 新生成结果在 commit success 之前必须留在 pendingReferences 里保活：
        // 非批量路径会把新 storageKey 提前写进 `current`（节点状态仍是 loading），
        // 而 store 的 updateProject 与 InfiniteWorkflow 的 nodes effect 都会触发
        // 异步 pruneWorkflowMedia。RunningHub 这类慢速轮询路径上，progress 回调
        // 会反复 publish 带 new storageKey 的 loading 节点，每次都触发一次 prune。
        // 若在此处提前 release，new key 既脱离 pending 保护、又可能在 canonicalReferences
            // 重建之前被某次 prune 命中，导致刚存入 IDB 的结果被删，工作流读不到图片。
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
    if (operationTakeId) {
      const operation = current.nodes.find(node => node.id === nodeId);
      if (operation) {
        // 批量输出 = 新建结果节点；单张输出 = 原位替换后的节点自身
        const outputNodeIds = preparedNodes.length > 0 ? preparedNodes.map(node => node.id) : [nodeId];
        validateWorkflowOperationOutputs('image.generate@1', outputNodeIds.map(() => ({ role: 'result_image' as const, nodeType: 'image' as const })));
        const completed = completeWorkflowOperationTake(operation, operationTakeId, outputNodeIds, {
          providerTaskId: operation.metadata.generationProviderTaskId,
          usageRecordId: operation.metadata.generationUsageRecordId,
        });
        current = { ...current, nodes: current.nodes.map(node => node.id === nodeId ? completed : node) };
      }
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
    let latest = canonical(runtime, current);
    if (operationTakeId) {
      const operation = latest.nodes.find(node => node.id === nodeId);
      if (operation) {
        const completed = completeWorkflowOperationTake(operation, operationTakeId, [], {
          canceled: isAbort(error),
          error: isAbort(error) ? '生成已停止' : error instanceof Error ? error.message : '生成失败，请重试。',
          providerTaskId: operation.metadata.generationProviderTaskId,
          usageRecordId: operation.metadata.generationUsageRecordId,
        });
        latest = { ...latest, nodes: latest.nodes.map(node => node.id === nodeId ? completed : node) };
      }
    }
    current = patchInitiator(latest, nodeId, isAbort(error)
      ? { status: 'idle', error: undefined, progress: undefined, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined }
      : { status: 'error', error: error instanceof Error ? error.message : '生成失败，请重试。', progress: undefined, generationRequestId: undefined, generationStartedAt: undefined, generationMessage: undefined });
    return publish(runtime, current);
  } finally {
    temporaryUrls.forEach(url => URL.revokeObjectURL(url));
  }
}
