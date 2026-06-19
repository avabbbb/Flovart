import { nanoid } from 'nanoid';
import { createWorkflowNode } from '../components/workflow/constants';
import { discardWorkflowMediaRecord, ingestWorkflowMedia, loadWorkflowMediaBlob, releaseWorkflowMediaRecord, workflowBlobToDataUrl, workflowDataUrlToBlob, type WorkflowMediaRecord } from '../components/workflow/media';
import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { ModelPreference, UserApiKey } from '../types';
import { resolveModelSelection } from '../utils/modelRefs';
import { editImageWithProvider, runImageAgentWithProvider, splitImageLayersWithProvider, type ImageToolLayer, type ImageToolResult, type ImageToolTask } from './aiGateway';

export interface WorkflowImageToolRuntime {
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  getProject: () => WorkflowProject | null;
  onProjectChange: (project: WorkflowProject) => void | Promise<void>;
  createId?: () => string;
  loadMedia?: (storageKey: string) => Promise<Blob | null>;
  ingestMedia?: (file: File) => Promise<WorkflowMediaRecord>;
  encodeDataUrl?: (blob: Blob) => Promise<string>;
  executeAgent?: typeof runImageAgentWithProvider;
  executeEdit?: typeof editImageWithProvider;
  executeSplit?: typeof splitImageLayersWithProvider;
}

const activeRequests = new Map<string, string>();
const requestKey = (projectId: string, nodeId: string) => `${projectId}:${nodeId}:image-tool`;
const canonical = (runtime: WorkflowImageToolRuntime) => runtime.getProject();
const publish = async (runtime: WorkflowImageToolRuntime, project: WorkflowProject) => { await runtime.onProjectChange(project); return project; };

function patchSource(project: WorkflowProject, nodeId: string, metadata: Record<string, unknown>) {
  return { ...project, nodes: project.nodes.map(node => node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...metadata } } : node) };
}

function resolveImageModel(runtime: WorkflowImageToolRuntime, node: WorkflowNode) {
  const modelRef = node.metadata.config?.modelId || runtime.modelPreference.imageModel;
  const resolved = resolveModelSelection(modelRef, runtime.userApiKeys, 'image');
  if (!resolved) throw new Error('未找到可用于图片处理的 API Key。');
  return resolved;
}

async function sourceInput(node: WorkflowNode, runtime: WorkflowImageToolRuntime) {
  const blob = node.metadata.storageKey
    ? await (runtime.loadMedia || workflowMediaStorage.get)(node.metadata.storageKey)
    : await loadWorkflowMediaBlob(undefined, node.metadata.href);
  if (!blob) throw new Error('图片文件不存在，请重新选择文件');
  return { blob, input: { href: await (runtime.encodeDataUrl || workflowBlobToDataUrl)(blob), mimeType: node.metadata.mimeType || blob.type || 'image/png' } };
}

function fileFrom(blob: Blob, name: string, mimeType?: string) {
  return new File([blob], name, { type: mimeType || blob.type || 'image/png', lastModified: Date.now() });
}

async function ingestDataUrl(dataUrl: string, name: string, mimeType: string, runtime: WorkflowImageToolRuntime) {
  const blob = await workflowDataUrlToBlob(dataUrl.startsWith('data:') ? dataUrl : `data:${mimeType};base64,${dataUrl}`);
  return (runtime.ingestMedia || ingestWorkflowMedia)(fileFrom(blob, name, mimeType));
}

function resultNode(source: WorkflowNode, record: WorkflowMediaRecord, id: string, index = 0, title = '图片处理结果') {
  const node = createWorkflowNode(id, 'image', { x: source.position.x + source.width + 80, y: source.position.y + index * 44 }, { ...record, href: undefined, status: 'success' });
  node.title = title;
  node.width = record.naturalWidth && record.naturalHeight ? Math.min(420, record.naturalWidth) : source.width;
  node.height = record.naturalWidth && record.naturalHeight ? Math.round(node.width * record.naturalHeight / record.naturalWidth) : source.height;
  return node;
}

async function start(projectId: string, nodeId: string, runtime: WorkflowImageToolRuntime) {
  const project = canonical(runtime);
  const node = project?.id === projectId ? project.nodes.find(item => item.id === nodeId) : null;
  if (!project || !node || node.type !== 'image') throw new Error('图片节点不存在或已被删除');
  const createId = runtime.createId || nanoid;
  const requestId = createId();
  activeRequests.set(requestKey(projectId, nodeId), requestId);
  await publish(runtime, patchSource(project, nodeId, { status: 'loading', progress: 0, error: undefined, generationRequestId: requestId }));
  return { node, requestId, createId };
}

function stillActive(projectId: string, nodeId: string, requestId: string, runtime: WorkflowImageToolRuntime) {
  if (activeRequests.get(requestKey(projectId, nodeId)) !== requestId) return false;
  const project = canonical(runtime);
  return project?.id === projectId && project.nodes.some(node => node.id === nodeId && node.metadata.generationRequestId === requestId);
}

async function fail(projectId: string, nodeId: string, requestId: string, runtime: WorkflowImageToolRuntime, error: unknown) {
  if (!stillActive(projectId, nodeId, requestId, runtime)) return;
  activeRequests.delete(requestKey(projectId, nodeId));
  const project = canonical(runtime);
  if (project) await publish(runtime, patchSource(project, nodeId, { status: 'error', error: error instanceof Error ? error.message : '图片处理失败', progress: undefined, generationRequestId: undefined }));
}

async function commitResults(projectId: string, source: WorkflowNode, requestId: string, records: Array<{ record: WorkflowMediaRecord; title: string; offsetX?: number; offsetY?: number }>, runtime: WorkflowImageToolRuntime, createId: () => string) {
  if (!stillActive(projectId, source.id, requestId, runtime)) {
    await Promise.all(records.map(({ record }) => discardWorkflowMediaRecord(record.storageKey)));
    return canonical(runtime);
  }
  const project = canonical(runtime)!;
  const nodes = records.map(({ record, title, offsetX = 0, offsetY = 0 }, index) => {
    const node = resultNode(source, record, createId(), index, title);
    node.position = { x: node.position.x + offsetX, y: node.position.y + offsetY };
    return node;
  });
  const connections = nodes.map(node => ({ id: createId(), fromNodeId: source.id, toNodeId: node.id }));
  activeRequests.delete(requestKey(projectId, source.id));
  const next = {
    ...project,
    nodes: [...project.nodes.map(node => node.id === source.id ? { ...node, metadata: { ...node.metadata, status: 'success' as const, error: undefined, progress: 100, generationRequestId: undefined } } : node), ...nodes],
    connections: [...project.connections, ...connections], selectedNodeIds: nodes.map(node => node.id),
  };
  await publish(runtime, next);
  records.forEach(({ record }) => releaseWorkflowMediaRecord(record.storageKey));
  return next;
}

export async function runWorkflowImageAgent(projectId: string, nodeId: string, task: ImageToolTask, runtime: WorkflowImageToolRuntime, options: Record<string, unknown> = {}) {
  const { node, requestId, createId } = await start(projectId, nodeId, runtime);
  try {
    const { input } = await sourceInput(node, runtime);
    const resolved = resolveImageModel(runtime, node);
    const result: ImageToolResult = await (runtime.executeAgent || runImageAgentWithProvider)(input, task, resolved.model, resolved.key, options);
    if (!stillActive(projectId, nodeId, requestId, runtime)) {
      if (activeRequests.get(requestKey(projectId, nodeId)) === requestId) activeRequests.delete(requestKey(projectId, nodeId));
      return canonical(runtime);
    }
    const record = await ingestDataUrl(result.dataUrl, `${task}.png`, result.mimeType, runtime);
    return commitResults(projectId, node, requestId, [{ record, title: task === 'upscale' ? '高清放大' : '移除背景' }], runtime, createId);
  } catch (error) {
    await fail(projectId, nodeId, requestId, runtime, error);
    throw error;
  }
}

export async function runWorkflowImageEdit(projectId: string, nodeId: string, prompt: string, mask: { href: string; mimeType: string } | undefined, runtime: WorkflowImageToolRuntime) {
  const { node, requestId, createId } = await start(projectId, nodeId, runtime);
  try {
    const { input } = await sourceInput(node, runtime);
    const resolved = resolveImageModel(runtime, node);
    const result = await (runtime.executeEdit || editImageWithProvider)([input], prompt, resolved.model, resolved.key, mask ? { mask } : undefined);
    if (!result.newImageBase64) throw new Error(result.textResponse || '图片编辑没有返回可用结果');
    if (!stillActive(projectId, nodeId, requestId, runtime)) {
      if (activeRequests.get(requestKey(projectId, nodeId)) === requestId) activeRequests.delete(requestKey(projectId, nodeId));
      return canonical(runtime);
    }
    const mimeType = result.newImageMimeType || 'image/png';
    const record = await ingestDataUrl(result.newImageBase64, 'edited.png', mimeType, runtime);
    return commitResults(projectId, node, requestId, [{ record, title: mask ? '局部编辑' : '扩展画面' }], runtime, createId);
  } catch (error) {
    await fail(projectId, nodeId, requestId, runtime, error);
    throw error;
  }
}

export async function runWorkflowImageSplit(projectId: string, nodeId: string, runtime: WorkflowImageToolRuntime) {
  const { node, requestId, createId } = await start(projectId, nodeId, runtime);
  const records: Array<{ record: WorkflowMediaRecord; title: string; offsetX: number; offsetY: number }> = [];
  try {
    const { input } = await sourceInput(node, runtime);
    const resolved = resolveImageModel(runtime, node);
    const layers: ImageToolLayer[] = await (runtime.executeSplit || splitImageLayersWithProvider)(input, resolved.model, resolved.key);
    if (!layers.length) throw new Error('图层拆分没有返回可用结果');
    if (!stillActive(projectId, nodeId, requestId, runtime)) {
      if (activeRequests.get(requestKey(projectId, nodeId)) === requestId) activeRequests.delete(requestKey(projectId, nodeId));
      return canonical(runtime);
    }
    for (const [index, layer] of layers.entries()) {
      const record = await ingestDataUrl(layer.dataUrl, `${layer.name || `layer-${index + 1}`}.png`, 'image/png', runtime);
      records.push({ record, title: layer.name || `图层 ${index + 1}`, offsetX: layer.offsetX, offsetY: layer.offsetY });
    }
    return commitResults(projectId, node, requestId, records, runtime, createId);
  } catch (error) {
    await Promise.all(records.map(({ record }) => discardWorkflowMediaRecord(record.storageKey)));
    await fail(projectId, nodeId, requestId, runtime, error);
    throw error;
  }
}

export function cancelWorkflowImageTool(projectId: string, nodeId: string, runtime: WorkflowImageToolRuntime) {
  activeRequests.delete(requestKey(projectId, nodeId));
  const project = canonical(runtime);
  if (!project || project.id !== projectId) return false;
  void publish(runtime, patchSource(project, nodeId, { status: 'idle', error: undefined, progress: undefined, generationRequestId: undefined }));
  return true;
}
