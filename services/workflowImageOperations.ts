import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  cropWorkflowImage,
  discardWorkflowMediaRecord,
  fitWorkflowMediaSize,
  ingestWorkflowMedia,
  loadWorkflowMediaBlob,
  releaseWorkflowMediaRecord,
  workflowBlobToDataUrl,
  workflowDataUrlToBlob,
  type WorkflowCropRect,
  type WorkflowMediaRecord,
} from '../components/workflow/media';
import { parseWorkflowOperationParameters, WORKFLOW_LAYER_STYLE_LABELS, type WorkflowLayerStyle } from '../components/workflow/operationRegistry';
import type { WorkflowNode, WorkflowOperationCapabilityId } from '../components/workflow/types';
import type { UserApiKey } from '../types';
import {
  editImageWithProvider,
  runImageAgentWithProvider,
  splitImageLayersWithProvider,
  type ImageToolResult,
} from './aiGateway';
import { splitGrid } from './gridSplitter';
import { transformImage } from './imageTransform';
import { resolveRouteMappingForSubmit, type RouteFallbackResolution } from './routeMapping';
import { buildOutpaintCanvas, type OutpaintDirection } from './outpaintCanvas';
import { vectorizeImageBlob, type VectorizePreset } from './vectorizeImage';
import { buildMoveObjectCanvas, type NormalizedPoint } from './moveObjectCanvas';
import {
  commitWorkflowOperation,
  failWorkflowOperation,
  loadWorkflowOperationSourceBlob,
  requireWorkflowMediaNode,
  requireWorkflowOperation,
  restartWorkflowOperation,
  startWorkflowOperation,
  type StartedWorkflowOperation,
  type WorkflowOperationOutcome,
  type WorkflowOperationRuntime,
} from './workflowOperationExecution';

export type WorkflowImageToolOutcome = WorkflowOperationOutcome;

export interface WorkflowImageOperationRuntime extends WorkflowOperationRuntime {
  userApiKeys: UserApiKey[];
  confirmRouteFallback?: (resolution: RouteFallbackResolution) => boolean | Promise<boolean>;
  encodeDataUrl?: (blob: Blob) => Promise<string>;
  executeAgent?: typeof runImageAgentWithProvider;
  executeEdit?: typeof editImageWithProvider;
  executeSplit?: typeof splitImageLayersWithProvider;
  executeCrop?: (blob: Blob, crop: WorkflowCropRect) => Promise<Blob>;
  executeRotate?: typeof transformImage;
  executeSplitGrid?: typeof splitGrid;
  executeOutpaintCanvas?: typeof buildOutpaintCanvas;
  executeVectorize?: typeof vectorizeImageBlob;
  executeMoveObjectCanvas?: typeof buildMoveObjectCanvas;
}

export type WorkflowImageEditVariant = 'edit' | 'outpaint' | 'mask' | 'annotate' | 'relight';
export interface WorkflowImageEditMask { nodeId?: string; href?: string; mimeType?: string }

async function dataUrlBlob(value: string, mimeType: string) {
  const dataUrl = value.startsWith('data:') ? value : `data:${mimeType};base64,${value}`;
  return workflowDataUrlToBlob(dataUrl);
}

const resultBlob = (result: ImageToolResult) => dataUrlBlob(result.dataUrl, result.mimeType);

async function imageInput(source: WorkflowNode, runtime: WorkflowImageOperationRuntime) {
  const blob = await loadWorkflowOperationSourceBlob(source, runtime);
  return {
    blob,
    input: {
      href: await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob),
      mimeType: source.metadata.mimeType || blob.type || 'image/png',
    },
  };
}

async function resolveImageRoute(runtime: WorkflowImageOperationRuntime, modelId?: string) {
  if (!modelId) throw new Error('请先在 PromptBar 明确选择图片产品模型。');
  return resolveRouteMappingForSubmit(
    { kind: 'product-mode', productModelId: modelId, mode: 'image-to-image' },
    runtime.userApiKeys,
    runtime.confirmRouteFallback,
  );
}

export async function runWorkflowCropOperation(
  projectId: string,
  sourceNodeId: string,
  crop: WorkflowCropRect,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.crop@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }],
    parameters: { ...crop },
  });
  return executeCropOperation(projectId, started, crop, runtime);
}

async function executeCropOperation(
  projectId: string,
  started: StartedWorkflowOperation,
  crop: WorkflowCropRect,
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const sourceBlob = await loadWorkflowOperationSourceBlob(source, runtime);
    const cropped = await (runtime.executeCrop || cropWorkflowImage)(sourceBlob, crop);
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: cropped,
      title: '图片裁剪',
      fileName: `crop-${source.metadata.name || 'image.png'}`,
      mimeType: cropped.type || source.metadata.mimeType || 'image/png',
      role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowUpscaleOperation(
  projectId: string,
  sourceNodeId: string,
  options: { targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' },
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.upscale@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }],
    parameters: options,
    productModelId: modelId,
    routeId: resolved.routeId,
  });
  return executeUpscaleOperation(projectId, started, options, resolved.routeId, resolved.key, runtime);
}

async function executeUpscaleOperation(
  projectId: string,
  started: StartedWorkflowOperation,
  options: { targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' },
  routeId: string,
  key: Parameters<typeof runImageAgentWithProvider>[3],
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const { input } = await imageInput(source, runtime);
    const result = await (runtime.executeAgent || runImageAgentWithProvider)(input, 'upscale', routeId, key, options);
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: await resultBlob(result), title: '高清放大', fileName: 'upscale.png', mimeType: result.mimeType, role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowRemoveBackgroundOperation(
  projectId: string,
  sourceNodeId: string,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.remove-background@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }],
    parameters: {}, productModelId: modelId, routeId: resolved.routeId,
  });
  return executeRemoveBackground(projectId, started, resolved.routeId, resolved.key, runtime);
}

async function executeRemoveBackground(
  projectId: string,
  started: StartedWorkflowOperation,
  routeId: string,
  key: Parameters<typeof runImageAgentWithProvider>[3],
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const { input } = await imageInput(started.sourceNodes[0], runtime);
    const result = await (runtime.executeAgent || runImageAgentWithProvider)(input, 'remove-background', routeId, key, {});
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: await resultBlob(result), title: '移除背景', fileName: 'remove-background.png', mimeType: result.mimeType, role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowSplitLayersOperation(
  projectId: string,
  sourceNodeId: string,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.split-layers@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }],
    parameters: {}, productModelId: modelId, routeId: resolved.routeId,
  });
  return executeSplitLayers(projectId, started, resolved.routeId, resolved.key, runtime);
}

async function executeSplitLayers(
  projectId: string,
  started: StartedWorkflowOperation,
  routeId: string,
  key: Parameters<typeof splitImageLayersWithProvider>[2],
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const { input } = await imageInput(started.sourceNodes[0], runtime);
    const layers = await (runtime.executeSplit || splitImageLayersWithProvider)(input, routeId, key);
    if (!layers.length) throw new Error('图层拆分没有返回可用结果');
    return await commitWorkflowOperation(runtime, projectId, started, await Promise.all(layers.map(async (layer, index) => ({
      blob: await dataUrlBlob(layer.dataUrl, 'image/png'),
      title: layer.name || `图层 ${index + 1}`,
      fileName: `${layer.name || `layer-${index + 1}`}.png`,
      mimeType: 'image/png',
      role: 'result_image' as const,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
    }))));
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

// 本地矢量化：imagetracerjs 在浏览器内描摹，结果为 SVG 图片节点，不消耗模型额度。
export async function runWorkflowVectorizeOperation(
  projectId: string,
  sourceNodeId: string,
  preset: VectorizePreset,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.vectorize@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }],
    parameters: { preset },
  });
  try {
    const source = started.sourceNodes[0];
    const svg = await (runtime.executeVectorize || vectorizeImageBlob)(await loadWorkflowOperationSourceBlob(source, runtime), preset);
    const baseName = (source.metadata.name || 'image').replace(/\.[^.]+$/, '');
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: svg, title: '矢量化', fileName: baseName + '.svg', mimeType: 'image/svg+xml', role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

async function createMaskNode(
  source: WorkflowNode,
  mask: WorkflowImageEditMask,
  runtime: WorkflowImageOperationRuntime,
): Promise<{ node: WorkflowNode; record?: WorkflowMediaRecord }> {
  if (mask.nodeId) {
    return { node: requireWorkflowMediaNode(runtime, runtime.getProject()?.id || '', mask.nodeId, 'image').node };
  }
  if (!mask.href) throw new Error('编辑蒙版缺少可用图片');
  const blob = await loadWorkflowMediaBlob(undefined, mask.href);
  const record = await (runtime.ingestMedia || ingestWorkflowMedia)(new File([blob], 'edit-mask.png', {
    type: mask.mimeType || blob.type || 'image/png', lastModified: Date.now(),
  }));
  const size = fitWorkflowMediaSize('image', record.naturalWidth, record.naturalHeight);
  const node = {
    ...createWorkflowNode((runtime.createId || nanoid)(), 'image', { x: source.position.x, y: source.position.y + source.height + 32 }, {
      ...record, href: undefined, name: record.name, status: 'success',
    }),
    ...size,
    title: '编辑蒙版',
  };
  return { node, record };
}

export async function runWorkflowImageEditOperation(
  projectId: string,
  sourceNodeId: string,
  prompt: string,
  variant: WorkflowImageEditVariant,
  mask: WorkflowImageEditMask | undefined,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const started = await startMaskedImageOperation(runtime, projectId, source, 'image.edit@1', mask, { variant }, prompt, modelId, resolved.routeId);
  return executeImageEdit(projectId, started, prompt, variant, resolved.routeId, resolved.key, runtime);
}

const OUTPAINT_DIRECTION_LABELS: Record<OutpaintDirection, string> = { left: '左侧', right: '右侧', top: '上方', bottom: '下方', all: '四周' };

// 真实扩图：先把源图放进更大的画布，再用“新区域透明、原图白色”的蒙版走局部重绘。
export async function runWorkflowOutpaintOperation(
  projectId: string,
  sourceNodeId: string,
  input: { direction: OutpaintDirection; amount: number; prompt: string },
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const padded = await (runtime.executeOutpaintCanvas || buildOutpaintCanvas)(await loadWorkflowOperationSourceBlob(source, runtime), input.direction, input.amount);
  const encode = runtime.encodeDataUrl || workflowBlobToDataUrl;
  const { layout } = padded;
  const prompt = [
    '把画面向' + OUTPAINT_DIRECTION_LABELS[input.direction] + '扩展到 ' + layout.width + 'x' + layout.height + '：原图位于 (' + layout.offsetX + ', ' + layout.offsetY + ')，尺寸 ' + layout.sourceWidth + 'x' + layout.sourceHeight + '。保持原图像素不变，只补全空白区域，延续原图的风格、光影、透视和内容。',
    input.prompt.trim(),
  ].filter(Boolean).join('\n\n');
  const started = await startMaskedImageOperation(runtime, projectId, source, 'image.edit@1', { href: await encode(padded.mask), mimeType: 'image/png' }, { variant: 'outpaint' }, prompt, modelId, resolved.routeId);
  return executeImageEdit(projectId, started, prompt, 'outpaint', resolved.routeId, resolved.key, runtime, { href: await encode(padded.image), mimeType: 'image/png' });
}

// 移动物体：选区像素贴到新位置，原选区 + 新位置边缘走局部重绘，补背景与光影。
export async function runWorkflowMoveObjectOperation(
  projectId: string,
  sourceNodeId: string,
  input: { points: NormalizedPoint[]; dx: number; dy: number; prompt: string },
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const prepared = await (runtime.executeMoveObjectCanvas || buildMoveObjectCanvas)(await loadWorkflowOperationSourceBlob(source, runtime), input.points, input.dx, input.dy);
  const encode = runtime.encodeDataUrl || workflowBlobToDataUrl;
  const prompt = [
    '图中的物体已被移动到新位置。请在遮罩区域内：把原位置的空缺用周围背景自然补全，不留残影；让新位置物体的边缘与环境融合，补上合理的投影、反射和光照。物体本身的外形、颜色和细节保持不变，遮罩外区域保持不变。',
    input.prompt.trim(),
  ].filter(Boolean).join('\n\n');
  const started = await startMaskedImageOperation(runtime, projectId, source, 'image.edit@1', { href: await encode(prepared.mask), mimeType: 'image/png' }, { variant: 'mask' }, prompt, modelId, resolved.routeId);
  return executeImageEdit(projectId, started, prompt, 'mask', resolved.routeId, resolved.key, runtime, { href: await encode(prepared.image), mimeType: 'image/png' });
}

/** 源图 + 可选蒙版的 Operation 启动：蒙版以独立图片节点进入图，启动失败时丢弃已导入的蒙版媒体。 */
async function startMaskedImageOperation(
  runtime: WorkflowImageOperationRuntime,
  projectId: string,
  source: WorkflowNode,
  capabilityId: Extract<WorkflowOperationCapabilityId, 'image.edit@1' | 'image.layer@1'>,
  mask: WorkflowImageEditMask | undefined,
  parameters: Record<string, unknown>,
  prompt: string,
  modelId: string | undefined,
  routeId: string,
): Promise<StartedWorkflowOperation> {
  const preparedMask = mask ? await createMaskNode(source, mask, runtime) : undefined;
  let started: StartedWorkflowOperation;
  try {
    started = await startWorkflowOperation({
      runtime, projectId, capabilityId,
      sources: [
        { nodeId: source.id, role: 'source_image' },
        ...(preparedMask ? [{ nodeId: preparedMask.node.id, role: 'mask_image' as const }] : []),
      ],
      additionalSourceNodes: preparedMask?.record ? [preparedMask.node] : undefined,
      parameters, prompt, productModelId: modelId, routeId,
      anchorNodeId: source.id,
    });
  } catch (error) {
    if (preparedMask?.record) await discardWorkflowMediaRecord(preparedMask.record.storageKey);
    throw error;
  }
  if (preparedMask?.record) releaseWorkflowMediaRecord(preparedMask.record.storageKey);
  return started;
}

const EDIT_TITLES: Record<WorkflowImageEditVariant, string> = {
  edit: '图片编辑', outpaint: '扩展画面', mask: '局部编辑', annotate: '标注编辑', relight: '重新打光',
};

async function executeImageEdit(
  projectId: string,
  started: StartedWorkflowOperation,
  prompt: string,
  variant: WorkflowImageEditVariant,
  routeId: string,
  key: Parameters<typeof editImageWithProvider>[3],
  runtime: WorkflowImageOperationRuntime,
  sourceOverride?: { href: string; mimeType: string },
) {
  try {
    const input = sourceOverride || (await imageInput(started.sourceNodes[0], runtime)).input;
    const maskSource = started.sourceNodes[1];
    const mask = maskSource ? (await imageInput(maskSource, runtime)).input : undefined;
    const result = await (runtime.executeEdit || editImageWithProvider)([input], prompt, routeId, key, mask ? { mask } : undefined);
    if (!result.newImageBase64) throw new Error(result.textResponse || '图片编辑没有返回可用结果');
    const mimeType = result.newImageMimeType || 'image/png';
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: await dataUrlBlob(result.newImageBase64, mimeType),
      title: EDIT_TITLES[variant], fileName: `${variant}.png`, mimeType, role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export interface WorkflowLayerParameters { style: WorkflowLayerStyle; count: number }

/** 叠加层 Prompt：用户意图 + 固定的透明叠加层约束（与原图同尺寸、对齐、叠加层外完全透明）。 */
export function composeWorkflowLayerPrompt(prompt: string, style: WorkflowLayerStyle): string {
  return [
    prompt.trim(),
    '只生成一层「' + WORKFLOW_LAYER_STYLE_LABELS[style] + '」叠加层：与原图同尺寸并对齐原图构图；叠加层以外区域完全透明（PNG Alpha），不要包含原图像素。',
  ].filter(Boolean).join('\n\n');
}

export async function runWorkflowLayerOperation(
  projectId: string,
  sourceNodeId: string,
  input: { prompt: string; style?: WorkflowLayerStyle; count?: number; mask?: WorkflowImageEditMask },
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  if (!input.prompt.trim()) throw new Error('叠加层需要描述要加什么');
  const parameters = parseWorkflowOperationParameters('image.layer@1', { style: input.style, count: input.count }) as unknown as WorkflowLayerParameters;
  const { node: source } = requireWorkflowMediaNode(runtime, projectId, sourceNodeId, 'image');
  const modelId = source.metadata.config?.modelId;
  const resolved = await resolveImageRoute(runtime, modelId);
  const started = await startMaskedImageOperation(runtime, projectId, source, 'image.layer@1', input.mask, { ...parameters }, input.prompt, modelId, resolved.routeId);
  return executeLayer(projectId, started, input.prompt, parameters, resolved.routeId, resolved.key, runtime);
}

async function executeLayer(
  projectId: string,
  started: StartedWorkflowOperation,
  prompt: string,
  parameters: WorkflowLayerParameters,
  routeId: string,
  key: Parameters<typeof editImageWithProvider>[3],
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const { input } = await imageInput(started.sourceNodes[0], runtime);
    const maskSource = started.sourceNodes[1];
    const mask = maskSource ? (await imageInput(maskSource, runtime)).input : undefined;
    const layerPrompt = composeWorkflowLayerPrompt(prompt, parameters.style);
    const execute = runtime.executeEdit || editImageWithProvider;
    // 顺序执行：不对同一付费端点并发打满限流；任一候选失败则整个 Take 失败，不提交半组结果。
    const outputs = [];
    for (let index = 0; index < parameters.count; index += 1) {
      const result = await execute([input], layerPrompt, routeId, key, mask ? { mask } : undefined);
      if (!result.newImageBase64) throw new Error(result.textResponse || '叠加层没有返回可用结果');
      const mimeType = result.newImageMimeType || 'image/png';
      outputs.push({
        blob: await dataUrlBlob(result.newImageBase64, mimeType),
        title: '叠加层 ' + (index + 1),
        fileName: 'layer-' + (index + 1) + '.png',
        mimeType,
        role: 'result_image' as const,
        column: index % 2,
        row: Math.floor(index / 2),
      });
    }
    return await commitWorkflowOperation(runtime, projectId, started, outputs);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowRotateOperation(
  projectId: string,
  sourceNodeId: string,
  action: 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v',
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.rotate@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }], parameters: { action },
  });
  return executeRotate(projectId, started, action, runtime);
}

async function executeRotate(
  projectId: string,
  started: StartedWorkflowOperation,
  action: 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v',
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const { blob } = await imageInput(source, runtime);
    const transformed = await (runtime.executeRotate || transformImage)(await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob), action);
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: transformed, title: '旋转镜像', fileName: `rotated-${source.metadata.name || 'image.png'}`,
      mimeType: transformed.type || 'image/png', role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowSplitGridOperation(
  projectId: string,
  sourceNodeId: string,
  parameters: { rows: number; cols: number },
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'image.split-grid@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_image' }], parameters,
  });
  return executeSplitGrid(projectId, started, parameters, runtime);
}

async function executeSplitGrid(
  projectId: string,
  started: StartedWorkflowOperation,
  parameters: { rows: number; cols: number },
  runtime: WorkflowImageOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const { blob } = await imageInput(source, runtime);
    const pieces = await (runtime.executeSplitGrid || splitGrid)(await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob), parameters.rows, parameters.cols);
    return await commitWorkflowOperation(runtime, projectId, started, pieces.map(piece => ({
      blob: piece.blob, title: `切分 ${piece.index + 1}`, fileName: `grid-${piece.index}-${source.metadata.name || 'image.png'}`,
      mimeType: piece.blob.type || 'image/png', role: 'result_image', column: piece.col, row: piece.row,
    })));
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function rerunWorkflowImageOperation(
  projectId: string,
  operationNodeId: string,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { operation, sourceNodes } = requireWorkflowOperation(runtime, projectId, operationNodeId);
  const record = operation.metadata.operation!;
  if (record.capabilityId === 'image.crop@1') {
    const crop = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as unknown as WorkflowCropRect;
    return executeCropOperation(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), crop, runtime);
  }
  if (record.capabilityId === 'image.upscale@1') {
    const options = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' };
    const modelId = record.recipe.productModelId || sourceNodes[0]?.metadata.config?.modelId;
    const resolved = await resolveImageRoute(runtime, modelId);
    return executeUpscaleOperation(
      projectId,
      await restartWorkflowOperation(runtime, projectId, operationNodeId, resolved.routeId),
      options,
      resolved.routeId,
      resolved.key,
      runtime,
    );
  }
  if (record.capabilityId === 'image.remove-background@1') {
    const modelId = record.recipe.productModelId || sourceNodes[0]?.metadata.config?.modelId;
    const resolved = await resolveImageRoute(runtime, modelId);
    return executeRemoveBackground(
      projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId, resolved.routeId), resolved.routeId, resolved.key, runtime,
    );
  }
  if (record.capabilityId === 'image.split-layers@1') {
    const modelId = record.recipe.productModelId || sourceNodes[0]?.metadata.config?.modelId;
    const resolved = await resolveImageRoute(runtime, modelId);
    return executeSplitLayers(
      projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId, resolved.routeId), resolved.routeId, resolved.key, runtime,
    );
  }
  if (record.capabilityId === 'image.edit@1') {
    const { variant } = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { variant: WorkflowImageEditVariant };
    const modelId = record.recipe.productModelId || sourceNodes[0]?.metadata.config?.modelId;
    const resolved = await resolveImageRoute(runtime, modelId);
    return executeImageEdit(
      projectId,
      await restartWorkflowOperation(runtime, projectId, operationNodeId, resolved.routeId),
      record.recipe.promptDocument.text,
      variant,
      resolved.routeId,
      resolved.key,
      runtime,
    );
  }
  if (record.capabilityId === 'image.layer@1') {
    const parameters = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as unknown as WorkflowLayerParameters;
    const modelId = record.recipe.productModelId || sourceNodes[0]?.metadata.config?.modelId;
    const resolved = await resolveImageRoute(runtime, modelId);
    return executeLayer(
      projectId,
      await restartWorkflowOperation(runtime, projectId, operationNodeId, resolved.routeId),
      record.recipe.promptDocument.text,
      parameters,
      resolved.routeId,
      resolved.key,
      runtime,
    );
  }
  if (record.capabilityId === 'image.rotate@1') {
    const { action } = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { action: 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v' };
    return executeRotate(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), action, runtime);
  }
  if (record.capabilityId === 'image.split-grid@1') {
    const parameters = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { rows: number; cols: number };
    return executeSplitGrid(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), parameters, runtime);
  }
  throw new Error('该 Operation 不是可重跑的图片处理步骤');
}
