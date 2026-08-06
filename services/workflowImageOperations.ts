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
import { parseWorkflowOperationParameters } from '../components/workflow/operationRegistry';
import type { WorkflowNode } from '../components/workflow/types';
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
  const preparedMask = mask ? await createMaskNode(source, mask, runtime) : undefined;
  let started: StartedWorkflowOperation;
  try {
    started = await startWorkflowOperation({
      runtime, projectId, capabilityId: 'image.edit@1',
      sources: [
        { nodeId: sourceNodeId, role: 'source_image' },
        ...(preparedMask ? [{ nodeId: preparedMask.node.id, role: 'mask_image' as const }] : []),
      ],
      additionalSourceNodes: preparedMask?.record ? [preparedMask.node] : undefined,
      parameters: { variant }, prompt, productModelId: modelId, routeId: resolved.routeId,
      anchorNodeId: sourceNodeId,
    });
  } catch (error) {
    if (preparedMask?.record) await discardWorkflowMediaRecord(preparedMask.record.storageKey);
    throw error;
  }
  if (preparedMask?.record) releaseWorkflowMediaRecord(preparedMask.record.storageKey);
  return executeImageEdit(projectId, started, prompt, variant, resolved.routeId, resolved.key, runtime);
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
) {
  try {
    const { input } = await imageInput(started.sourceNodes[0], runtime);
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
