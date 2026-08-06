import { cropWorkflowImage, workflowBlobToDataUrl, workflowDataUrlToBlob, type WorkflowCropRect } from '../components/workflow/media';
import { parseWorkflowOperationParameters } from '../components/workflow/operationRegistry';
import { runImageAgentWithProvider, type ImageToolResult } from './aiGateway';
import { resolveRouteMappingForSubmit } from './routeMapping';
import type { WorkflowImageToolOutcome, WorkflowImageToolRuntime } from './workflowImageTools';
import {
  commitWorkflowOperation,
  failWorkflowOperation,
  loadWorkflowOperationSourceBlob,
  requireWorkflowMediaNode,
  requireWorkflowOperation,
  restartWorkflowOperation,
  startWorkflowOperation,
  type StartedWorkflowOperation,
  type WorkflowOperationRuntime,
} from './workflowOperationExecution';

export interface WorkflowImageOperationRuntime extends WorkflowImageToolRuntime, WorkflowOperationRuntime {
  executeCrop?: (blob: Blob, crop: WorkflowCropRect) => Promise<Blob>;
}

async function resultBlob(result: ImageToolResult) {
  const dataUrl = result.dataUrl.startsWith('data:') ? result.dataUrl : `data:${result.mimeType};base64,${result.dataUrl}`;
  return workflowDataUrlToBlob(dataUrl);
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
  if (!modelId) throw new Error('请先在 PromptBar 明确选择图片产品模型。');
  const resolved = await resolveRouteMappingForSubmit(
    { kind: 'product-mode', productModelId: modelId, mode: 'image-to-image' },
    runtime.userApiKeys,
    runtime.confirmRouteFallback,
  );
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
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const input = { href: await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob), mimeType: source.metadata.mimeType || blob.type || 'image/png' };
    const result = await (runtime.executeAgent || runImageAgentWithProvider)(input, 'upscale', routeId, key, options);
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: await resultBlob(result), title: '高清放大', fileName: 'upscale.png', mimeType: result.mimeType, role: 'result_image',
    }]);
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
    if (!modelId) throw new Error('请先在 PromptBar 明确选择图片产品模型。');
    const resolved = await resolveRouteMappingForSubmit(
      { kind: 'product-mode', productModelId: modelId, mode: 'image-to-image' },
      runtime.userApiKeys,
      runtime.confirmRouteFallback,
    );
    return executeUpscaleOperation(
      projectId,
      await restartWorkflowOperation(runtime, projectId, operationNodeId, resolved.routeId),
      options,
      resolved.routeId,
      resolved.key,
      runtime,
    );
  }
  throw new Error('该 Operation 不是可重跑的图片处理步骤');
}
