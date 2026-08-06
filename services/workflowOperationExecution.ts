import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  discardWorkflowMediaRecord,
  fitWorkflowMediaSize,
  ingestWorkflowMedia,
  loadWorkflowMediaBlob,
  releaseWorkflowMediaRecord,
  type WorkflowMediaRecord,
} from '../components/workflow/media';
import {
  getWorkflowOperationCapability,
  validateWorkflowOperationInputBindings,
  validateWorkflowOperationOutputs,
} from '../components/workflow/operationRegistry';
import {
  beginWorkflowOperationTake,
  completeWorkflowOperationTake,
  createWorkflowOperationInputBinding,
  createWorkflowOperationNode,
  workflowOperationInputConnections,
} from '../components/workflow/operations';
import { workflowMediaStorage } from '../components/workflow/storage';
import type {
  WorkflowNode,
  WorkflowOperationCapabilityId,
  WorkflowOperationInputRole,
  WorkflowOperationOutputRole,
  WorkflowProject,
} from '../components/workflow/types';
import { loadRuntimeArtifactBlob } from './runtimeArtifacts';

export interface WorkflowOperationRuntime {
  getProject: () => WorkflowProject | null;
  onProjectChange: (project: WorkflowProject) => void | Promise<void>;
  createId?: () => string;
  loadMedia?: (storageKey: string) => Promise<Blob | null>;
  ingestMedia?: (file: File) => Promise<WorkflowMediaRecord>;
}

export type WorkflowOperationOutcome =
  | { status: 'committed'; project: WorkflowProject }
  | { status: 'stale'; project: WorkflowProject | null };

export interface StartedWorkflowOperation {
  sourceNodes: WorkflowNode[];
  operationId: string;
  takeId: string;
  createId: () => string;
}

export interface WorkflowOperationBlobOutput {
  blob: Blob;
  title: string;
  role: WorkflowOperationOutputRole;
  mimeType?: string;
  fileName?: string;
}

function requireProject(runtime: WorkflowOperationRuntime, projectId: string): WorkflowProject {
  const project = runtime.getProject();
  if (!project || project.id !== projectId) throw new Error('项目已切换或删除');
  return project;
}

export function requireWorkflowMediaNode(
  runtime: WorkflowOperationRuntime,
  projectId: string,
  nodeId: string,
  nodeType: 'image' | 'video' | 'audio',
): { project: WorkflowProject; node: WorkflowNode } {
  const project = requireProject(runtime, projectId);
  const node = project.nodes.find(item => item.id === nodeId);
  if (!node || node.type !== nodeType) throw new Error(`${nodeType} 节点不存在或已被删除`);
  if (!node.metadata.storageKey && !node.metadata.href && !node.metadata.artifactRef?.taskId) {
    throw new Error('节点还没有可用媒体，请先生成或选择媒体。');
  }
  return { project, node };
}

export function requireWorkflowOperation(
  runtime: WorkflowOperationRuntime,
  projectId: string,
  operationNodeId: string,
): { project: WorkflowProject; operation: WorkflowNode; sourceNodes: WorkflowNode[] } {
  const project = requireProject(runtime, projectId);
  const operation = project.nodes.find(node => node.id === operationNodeId);
  if (!operation || operation.type !== 'operation' || !operation.metadata.operation) {
    throw new Error('Operation 节点不存在或已被删除');
  }
  const sourceNodes = operation.metadata.operation.recipe.inputBindings.map(binding => {
    const source = project.nodes.find(node => node.id === binding.sourceNodeId);
    if (!source) throw new Error(`Operation 输入节点不存在：${binding.sourceNodeId}`);
    return source;
  });
  validateSourceNodes(operation.metadata.operation.capabilityId, operation.metadata.operation.recipe.inputBindings, sourceNodes);
  return { project, operation, sourceNodes };
}

function validateSourceNodes(
  capabilityId: WorkflowOperationCapabilityId,
  bindings: readonly { role: WorkflowOperationInputRole }[],
  sourceNodes: readonly WorkflowNode[],
) {
  const capability = getWorkflowOperationCapability(capabilityId);
  sourceNodes.forEach((source, index) => {
    const role = bindings[index]?.role;
    const spec = capability.inputRoles.find(input => input.role === role);
    if (!spec?.nodeTypes.includes(source.type)) throw new Error(`${capability.label}的 ${role} 不接受 ${source.type} 节点`);
  });
}

export async function loadWorkflowOperationSourceBlob(node: WorkflowNode, runtime: WorkflowOperationRuntime): Promise<Blob> {
  if (node.metadata.storageKey) {
    const blob = await (runtime.loadMedia || workflowMediaStorage.get)(node.metadata.storageKey);
    if (blob) return blob;
  }
  if (node.metadata.artifactRef?.taskId) {
    return loadRuntimeArtifactBlob(node.metadata.artifactRef.taskId, node.metadata.artifactRef.mimeType);
  }
  return loadWorkflowMediaBlob(undefined, node.metadata.href);
}

export async function startWorkflowOperation(input: {
  runtime: WorkflowOperationRuntime;
  projectId: string;
  capabilityId: WorkflowOperationCapabilityId;
  sources: Array<{ nodeId: string; role: WorkflowOperationInputRole }>;
  parameters: Record<string, unknown>;
  productModelId?: string;
  routeId?: string;
  anchorNodeId?: string;
}): Promise<StartedWorkflowOperation> {
  const project = requireProject(input.runtime, input.projectId);
  const createId = input.runtime.createId || nanoid;
  const sourceNodes = input.sources.map(source => {
    const node = project.nodes.find(item => item.id === source.nodeId);
    if (!node) throw new Error(`Operation 输入节点不存在：${source.nodeId}`);
    return node;
  });
  const bindings = input.sources.map((source, order) => createWorkflowOperationInputBinding(createId(), source.nodeId, source.role, order));
  validateWorkflowOperationInputBindings(input.capabilityId, bindings, { requireMinimum: true });
  validateSourceNodes(input.capabilityId, bindings, sourceNodes);
  const anchor = project.nodes.find(node => node.id === input.anchorNodeId) || sourceNodes.at(-1);
  if (!anchor) throw new Error('Operation 缺少布局锚点');
  const operation = await createWorkflowOperationNode({
    id: createId(),
    capabilityId: input.capabilityId,
    position: { x: anchor.position.x + anchor.width + 64, y: anchor.position.y + Math.max(0, (anchor.height - 156) / 2) },
    prompt: '',
    parameters: input.parameters,
    productModelId: input.productModelId,
    inputBindings: bindings,
  });
  const started = await beginWorkflowOperationTake(operation, { id: createId(), snapshotId: createId(), routeId: input.routeId });
  const next: WorkflowProject = {
    ...project,
    nodes: [...project.nodes, started.node],
    connections: [...project.connections, ...workflowOperationInputConnections(started.node)],
    selectedNodeIds: [started.node.id],
    draftVersion: (project.draftVersion || 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  await input.runtime.onProjectChange(next);
  return { sourceNodes, operationId: started.node.id, takeId: started.take.id, createId };
}

export async function restartWorkflowOperation(
  runtime: WorkflowOperationRuntime,
  projectId: string,
  operationNodeId: string,
  routeId?: string,
): Promise<StartedWorkflowOperation> {
  const { project, operation, sourceNodes } = requireWorkflowOperation(runtime, projectId, operationNodeId);
  const createId = runtime.createId || nanoid;
  const started = await beginWorkflowOperationTake(operation, { id: createId(), snapshotId: createId(), routeId });
  const next: WorkflowProject = {
    ...project,
    nodes: project.nodes.map(node => node.id === operation.id ? started.node : node),
    selectedNodeIds: [operation.id],
    draftVersion: (project.draftVersion || 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  await runtime.onProjectChange(next);
  return { sourceNodes, operationId: operation.id, takeId: started.take.id, createId };
}

function outputExtension(nodeType: 'image' | 'video' | 'audio', mimeType: string) {
  if (nodeType === 'image') return mimeType.includes('jpeg') ? 'jpg' : 'png';
  if (nodeType === 'audio') return mimeType.includes('wav') ? 'wav' : 'mp3';
  return mimeType.includes('webm') ? 'webm' : 'mp4';
}

function defaultOutputMimeType(nodeType: 'image' | 'video' | 'audio') {
  return nodeType === 'image' ? 'image/png' : nodeType === 'audio' ? 'audio/mpeg' : 'video/mp4';
}

export async function commitWorkflowOperation(
  runtime: WorkflowOperationRuntime,
  projectId: string,
  started: StartedWorkflowOperation,
  outputs: WorkflowOperationBlobOutput[],
): Promise<WorkflowOperationOutcome> {
  const current = runtime.getProject();
  const operation = current?.id === projectId ? current.nodes.find(node => node.id === started.operationId) : undefined;
  if (!current || !operation?.metadata.operation) return { status: 'stale', project: current || null };
  const capability = getWorkflowOperationCapability(operation.metadata.operation.capabilityId);
  const normalized = outputs.map(output => {
    const spec = capability.outputRoles.find(item => item.role === output.role);
    if (!spec) throw new Error(`${capability.label}不允许输出 ${output.role}`);
    return { ...output, nodeType: spec.nodeType };
  });
  validateWorkflowOperationOutputs(operation.metadata.operation.capabilityId, normalized);

  const records: WorkflowMediaRecord[] = [];
  try {
    for (const output of normalized) {
      const mimeType = output.mimeType || output.blob.type || defaultOutputMimeType(output.nodeType);
      const fileName = output.fileName || `${output.title}.${outputExtension(output.nodeType, mimeType)}`;
      records.push(await (runtime.ingestMedia || ingestWorkflowMedia)(new File([output.blob], fileName, { type: mimeType, lastModified: Date.now() })));
    }
  } catch (error) {
    await Promise.all(records.map(record => discardWorkflowMediaRecord(record.storageKey)));
    throw error;
  }

  const latest = runtime.getProject();
  const latestOperation = latest?.id === projectId ? latest.nodes.find(node => node.id === started.operationId) : undefined;
  if (!latest || !latestOperation?.metadata.operation) {
    await Promise.all(records.map(record => discardWorkflowMediaRecord(record.storageKey)));
    return { status: 'stale', project: latest || null };
  }

  let outputY = latestOperation.position.y;
  const outputNodes = normalized.map((output, index) => {
    const record = records[index];
    const size = fitWorkflowMediaSize(output.nodeType, record.naturalWidth, record.naturalHeight);
    const node = {
      ...createWorkflowNode(started.createId(), output.nodeType, { x: latestOperation.position.x + latestOperation.width + 64, y: outputY }, {
        ...record,
        href: undefined,
        name: record.name,
        status: 'success' as const,
        config: output.nodeType === started.sourceNodes[0]?.type ? started.sourceNodes[0].metadata.config : undefined,
        sourceOperationNodeId: latestOperation.id,
        operationTakeId: started.takeId,
        operationOutputRole: output.role,
      }),
      ...size,
      title: output.title,
    };
    outputY += size.height + 24;
    return node;
  });
  const completed = completeWorkflowOperationTake(latestOperation, started.takeId, outputNodes.map(node => node.id));
  const connections = outputNodes.map((node, index) => ({
    id: started.createId(),
    fromNodeId: latestOperation.id,
    toNodeId: node.id,
    kind: 'operation-output' as const,
    role: normalized[index].role,
    order: index,
  }));
  const next: WorkflowProject = {
    ...latest,
    nodes: [...latest.nodes.map(node => node.id === latestOperation.id ? completed : node), ...outputNodes],
    connections: [...latest.connections, ...connections],
    selectedNodeIds: [latestOperation.id],
    draftVersion: (latest.draftVersion || 1) + 1,
    updatedAt: new Date().toISOString(),
  };
  await runtime.onProjectChange(next);
  records.forEach(record => releaseWorkflowMediaRecord(record.storageKey));
  return { status: 'committed', project: next };
}

export async function failWorkflowOperation(
  runtime: WorkflowOperationRuntime,
  projectId: string,
  started: StartedWorkflowOperation,
  error: unknown,
) {
  const project = runtime.getProject();
  const operation = project?.id === projectId ? project.nodes.find(node => node.id === started.operationId) : undefined;
  if (!project || !operation) return;
  const message = error instanceof Error ? error.message : '媒体处理失败';
  const failed = completeWorkflowOperationTake(operation, started.takeId, [], { error: message });
  await runtime.onProjectChange({
    ...project,
    nodes: project.nodes.map(node => node.id === operation.id ? failed : node),
    draftVersion: (project.draftVersion || 1) + 1,
    updatedAt: new Date().toISOString(),
  });
}
