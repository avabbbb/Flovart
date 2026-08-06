import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import { cropWorkflowImage, discardWorkflowMediaRecord, fitWorkflowMediaSize, ingestWorkflowMedia, loadWorkflowMediaBlob, releaseWorkflowMediaRecord, workflowBlobToDataUrl, workflowDataUrlToBlob, type WorkflowCropRect, type WorkflowMediaRecord } from '../components/workflow/media';
import { workflowMediaStorage } from '../components/workflow/storage';
import { beginWorkflowOperationTake, completeWorkflowOperationTake, createWorkflowOperationInputBinding, createWorkflowOperationNode, workflowOperationInputConnections } from '../components/workflow/operations';
import { parseWorkflowOperationParameters } from '../components/workflow/operationRegistry';
import type { WorkflowNode, WorkflowOperationCapabilityId, WorkflowProject } from '../components/workflow/types';
import { runImageAgentWithProvider, type ImageToolResult } from './aiGateway';
import { loadRuntimeArtifactBlob } from './runtimeArtifacts';
import { resolveRouteMappingForSubmit } from './routeMapping';
import type { WorkflowImageToolOutcome, WorkflowImageToolRuntime } from './workflowImageTools';

export interface WorkflowImageOperationRuntime extends WorkflowImageToolRuntime {
  executeCrop?: (blob: Blob, crop: WorkflowCropRect) => Promise<Blob>;
}

interface StartedImageOperation {
  source: WorkflowNode;
  operationId: string;
  takeId: string;
  createId: () => string;
}

function requireSource(runtime: WorkflowImageOperationRuntime, projectId: string, nodeId: string) {
  const project = runtime.getProject();
  const source = project?.id === projectId ? project.nodes.find(node => node.id === nodeId) : undefined;
  if (!project || !source || source.type !== 'image') throw new Error('图片节点不存在或已被删除');
  if (!source.metadata.storageKey && !source.metadata.href && !source.metadata.artifactRef?.taskId) throw new Error('图片节点还没有可用媒体');
  return { project, source };
}

function requireOperation(runtime: WorkflowImageOperationRuntime, projectId: string, operationNodeId: string) {
  const project = runtime.getProject();
  const operation = project?.id === projectId ? project.nodes.find(node => node.id === operationNodeId) : undefined;
  if (!project || !operation || operation.type !== 'operation' || !operation.metadata.operation) throw new Error('Operation 节点不存在或已被删除');
  const sourceNodeId = operation.metadata.operation.recipe.inputBindings.find(binding => binding.role === 'source_image')?.sourceNodeId;
  const source = project.nodes.find(node => node.id === sourceNodeId);
  if (!source || source.type !== 'image') throw new Error('Operation 的源图片绑定不存在');
  return { project, operation, source };
}

async function loadSourceBlob(source: WorkflowNode, runtime: WorkflowImageOperationRuntime) {
  if (source.metadata.storageKey) {
    const blob = await (runtime.loadMedia || workflowMediaStorage.get)(source.metadata.storageKey);
    if (blob) return blob;
  }
  if (source.metadata.artifactRef?.taskId) return loadRuntimeArtifactBlob(source.metadata.artifactRef.taskId, source.metadata.artifactRef.mimeType);
  return loadWorkflowMediaBlob(undefined, source.metadata.href);
}

async function startImageOperation(
  runtime: WorkflowImageOperationRuntime,
  projectId: string,
  sourceNodeId: string,
  capabilityId: WorkflowOperationCapabilityId,
  parameters: Record<string, unknown>,
  routeId?: string,
): Promise<StartedImageOperation> {
  const { project, source } = requireSource(runtime, projectId, sourceNodeId);
  const createId = runtime.createId || nanoid;
  const operation = await createWorkflowOperationNode({
    id: createId(),
    capabilityId,
    position: { x: source.position.x + source.width + 64, y: source.position.y + Math.max(0, (source.height - 156) / 2) },
    prompt: '',
    parameters,
    productModelId: source.metadata.config?.modelId,
    inputBindings: [createWorkflowOperationInputBinding(createId(), source.id, 'source_image', 0)],
  });
  const started = await beginWorkflowOperationTake(operation, { id: createId(), snapshotId: createId(), routeId });
  const next: WorkflowProject = {
    ...project,
    nodes: [...project.nodes, started.node],
    connections: [...project.connections, ...workflowOperationInputConnections(started.node)],
    selectedNodeIds: [started.node.id],
    draftVersion: (project.draftVersion || 1) + 1,
  };
  await runtime.onProjectChange(next);
  return { source, operationId: started.node.id, takeId: started.take.id, createId };
}

async function restartImageOperation(
  runtime: WorkflowImageOperationRuntime,
  projectId: string,
  operationNodeId: string,
  routeId?: string,
): Promise<StartedImageOperation> {
  const { project, operation, source } = requireOperation(runtime, projectId, operationNodeId);
  const createId = runtime.createId || nanoid;
  const started = await beginWorkflowOperationTake(operation, { id: createId(), snapshotId: createId(), routeId });
  const next: WorkflowProject = {
    ...project,
    nodes: project.nodes.map(node => node.id === operation.id ? started.node : node),
    selectedNodeIds: [operation.id],
    draftVersion: (project.draftVersion || 1) + 1,
  };
  await runtime.onProjectChange(next);
  return { source, operationId: operation.id, takeId: started.take.id, createId };
}

async function ingestBlob(blob: Blob, name: string, runtime: WorkflowImageOperationRuntime) {
  return (runtime.ingestMedia || ingestWorkflowMedia)(new File([blob], name, { type: blob.type || 'image/png', lastModified: Date.now() }));
}

async function ingestDataUrl(result: ImageToolResult, runtime: WorkflowImageOperationRuntime) {
  const dataUrl = result.dataUrl.startsWith('data:') ? result.dataUrl : `data:${result.mimeType};base64,${result.dataUrl}`;
  return ingestBlob(await workflowDataUrlToBlob(dataUrl), 'upscale.png', runtime);
}

async function commitImageOperation(
  runtime: WorkflowImageOperationRuntime,
  projectId: string,
  started: StartedImageOperation,
  record: WorkflowMediaRecord,
  title: string,
): Promise<WorkflowImageToolOutcome> {
  const project = runtime.getProject();
  const operation = project?.id === projectId ? project.nodes.find(node => node.id === started.operationId) : undefined;
  if (!project || !operation) {
    await discardWorkflowMediaRecord(record.storageKey);
    return { status: 'stale', project: project || null };
  }
  const size = fitWorkflowMediaSize('image', record.naturalWidth || started.source.metadata.naturalWidth, record.naturalHeight || started.source.metadata.naturalHeight);
  const output = {
    ...createWorkflowNode(started.createId(), 'image', { x: operation.position.x + operation.width + 64, y: operation.position.y + Math.max(0, (operation.height - size.height) / 2) }, {
      ...record,
      href: undefined,
      name: title,
      status: 'success' as const,
      config: started.source.metadata.config,
      sourceOperationNodeId: operation.id,
      operationTakeId: started.takeId,
    }),
    ...size,
    title,
  };
  const completed = completeWorkflowOperationTake(operation, started.takeId, [output.id]);
  const next: WorkflowProject = {
    ...project,
    nodes: [...project.nodes.map(node => node.id === operation.id ? completed : node), output],
    connections: [...project.connections, { id: started.createId(), fromNodeId: operation.id, toNodeId: output.id, kind: 'operation-output' }],
    selectedNodeIds: [operation.id],
    draftVersion: (project.draftVersion || 1) + 1,
  };
  await runtime.onProjectChange(next);
  releaseWorkflowMediaRecord(record.storageKey);
  return { status: 'committed', project: next };
}

async function failImageOperation(runtime: WorkflowImageOperationRuntime, projectId: string, started: StartedImageOperation, error: unknown) {
  const project = runtime.getProject();
  const operation = project?.id === projectId ? project.nodes.find(node => node.id === started.operationId) : undefined;
  if (!project || !operation) return;
  const message = error instanceof Error ? error.message : '图片处理失败';
  const failed = completeWorkflowOperationTake(operation, started.takeId, [], { error: message });
  await runtime.onProjectChange({ ...project, nodes: project.nodes.map(node => node.id === operation.id ? failed : node) });
}

export async function runWorkflowCropOperation(
  projectId: string,
  sourceNodeId: string,
  crop: WorkflowCropRect,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const started = await startImageOperation(runtime, projectId, sourceNodeId, 'image.crop@1', { ...crop });
  return executeCropOperation(projectId, started, crop, runtime);
}

async function executeCropOperation(
  projectId: string,
  started: StartedImageOperation,
  crop: WorkflowCropRect,
  runtime: WorkflowImageOperationRuntime,
) {
  let record: WorkflowMediaRecord | undefined;
  try {
    const sourceBlob = await loadSourceBlob(started.source, runtime);
    const cropped = await (runtime.executeCrop || cropWorkflowImage)(sourceBlob, crop);
    record = await ingestBlob(cropped, `crop-${started.source.metadata.name || 'image.png'}`, runtime);
    return await commitImageOperation(runtime, projectId, started, record, '图片裁剪');
  } catch (error) {
    if (record) await discardWorkflowMediaRecord(record.storageKey);
    await failImageOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowUpscaleOperation(
  projectId: string,
  sourceNodeId: string,
  options: { targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' },
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { source } = requireSource(runtime, projectId, sourceNodeId);
  const modelId = source.metadata.config?.modelId;
  if (!modelId) throw new Error('请先在 PromptBar 明确选择图片产品模型。');
  const resolved = await resolveRouteMappingForSubmit(
    { kind: 'product-mode', productModelId: modelId, mode: 'image-to-image' },
    runtime.userApiKeys,
    runtime.confirmRouteFallback,
  );
  const started = await startImageOperation(runtime, projectId, sourceNodeId, 'image.upscale@1', options, resolved.routeId);
  return executeUpscaleOperation(projectId, started, options, resolved.routeId, resolved.key, runtime);
}

async function executeUpscaleOperation(
  projectId: string,
  started: StartedImageOperation,
  options: { targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' },
  routeId: string,
  key: Parameters<typeof runImageAgentWithProvider>[3],
  runtime: WorkflowImageOperationRuntime,
) {
  let record: WorkflowMediaRecord | undefined;
  try {
    const blob = await loadSourceBlob(started.source, runtime);
    const input = { href: await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob), mimeType: started.source.metadata.mimeType || blob.type || 'image/png' };
    const result = await (runtime.executeAgent || runImageAgentWithProvider)(input, 'upscale', routeId, key, options);
    record = await ingestDataUrl(result, runtime);
    return await commitImageOperation(runtime, projectId, started, record, '高清放大');
  } catch (error) {
    if (record) await discardWorkflowMediaRecord(record.storageKey);
    await failImageOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function rerunWorkflowImageOperation(
  projectId: string,
  operationNodeId: string,
  runtime: WorkflowImageOperationRuntime,
): Promise<WorkflowImageToolOutcome> {
  const { operation, source } = requireOperation(runtime, projectId, operationNodeId);
  const record = operation.metadata.operation!;
  if (record.capabilityId === 'image.crop@1') {
    const crop = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as unknown as WorkflowCropRect;
    return executeCropOperation(projectId, await restartImageOperation(runtime, projectId, operationNodeId), crop, runtime);
  }
  if (record.capabilityId === 'image.upscale@1') {
    const options = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { targetLongEdge: number; algorithm: 'high' | 'bilinear' | 'nearest' };
    const modelId = record.recipe.productModelId || source.metadata.config?.modelId;
    if (!modelId) throw new Error('请先在 PromptBar 明确选择图片产品模型。');
    const resolved = await resolveRouteMappingForSubmit(
      { kind: 'product-mode', productModelId: modelId, mode: 'image-to-image' },
      runtime.userApiKeys,
      runtime.confirmRouteFallback,
    );
    return executeUpscaleOperation(projectId, await restartImageOperation(runtime, projectId, operationNodeId, resolved.routeId), options, resolved.routeId, resolved.key, runtime);
  }
  throw new Error('该 Operation 不是可重跑的图片处理步骤');
}
