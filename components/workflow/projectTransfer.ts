import { nanoid } from 'nanoid';
import { workflowDataUrlToBlob, workflowBlobToDataUrl } from './media';
import { validateWorkflowConnection } from './ops';
import { workflowMediaStorage } from './storage';
import type { WorkflowNode, WorkflowProject } from './types';

export const WORKFLOW_EXPORT_APP = 'flovart-workflow';
export const WORKFLOW_EXPORT_VERSION = 1;

interface WorkflowExportAsset {
  nodeId: string;
  dataUrl: string;
  mimeType: string;
  name?: string;
}

export interface WorkflowExportFile {
  app: typeof WORKFLOW_EXPORT_APP;
  version: typeof WORKFLOW_EXPORT_VERSION;
  exportedAt: string;
  projects: Array<{ project: WorkflowProject; assets: WorkflowExportAsset[] }>;
}

const nodeTypes = new Set(['image', 'text', 'video', 'audio', 'config']);
const backgroundModes = new Set(['dots', 'lines', 'none']);

function portableProject(project: WorkflowProject): WorkflowProject {
  return {
    ...project,
    selectedNodeIds: [],
    nodes: project.nodes.map(node => {
      const href = node.metadata.href;
      if (!node.metadata.storageKey && href && /^(blob:|file:)/i.test(href)) {
        throw new Error(`节点“${node.title}”只包含临时媒体地址，无法完整导出`);
      }
      return {
        ...node,
        metadata: {
          ...node.metadata,
          storageKey: undefined,
          href: node.metadata.storageKey ? undefined : href,
          poster: node.metadata.poster && /^(blob:|file:)/i.test(node.metadata.poster) ? undefined : node.metadata.poster,
        },
      };
    }),
  };
}

export async function serializeWorkflowProjects(projects: WorkflowProject[]): Promise<WorkflowExportFile> {
  const exported = await Promise.all(projects.map(async project => {
    const assets = (await Promise.all(project.nodes.map(async node => {
      if (!node.metadata.storageKey) return null;
      const blob = await workflowMediaStorage.get(node.metadata.storageKey);
      if (!blob) throw new Error(`节点“${node.title}”的本地媒体不存在，无法完整导出`);
      return {
        nodeId: node.id,
        dataUrl: await workflowBlobToDataUrl(blob),
        mimeType: blob.type || node.metadata.mimeType || 'application/octet-stream',
        name: node.metadata.name,
      } satisfies WorkflowExportAsset;
    }))).filter((asset): asset is WorkflowExportAsset => Boolean(asset));
    return { project: portableProject(project), assets };
  }));
  return { app: WORKFLOW_EXPORT_APP, version: WORKFLOW_EXPORT_VERSION, exportedAt: new Date().toISOString(), projects: exported };
}

export async function downloadWorkflowProjects(projects: WorkflowProject[], fileName = 'Flovart-Workflow') {
  if (!projects.length) throw new Error('没有可导出的工作流');
  const exported = await serializeWorkflowProjects(projects);
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeFileName(fileName)}.workflow.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateNode(value: unknown, projectIndex: number, nodeIndex: number): asserts value is WorkflowNode {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.type !== 'string'
    || !nodeTypes.has(value.type)
    || !isRecord(value.position)
    || !finite(value.position.x)
    || !finite(value.position.y)
    || !finite(value.width)
    || !finite(value.height)
    || !isRecord(value.metadata)) {
    throw new Error(`第 ${projectIndex + 1} 个工作流的第 ${nodeIndex + 1} 个节点格式无效`);
  }
}

function validateProject(value: unknown, index: number): asserts value is WorkflowProject {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.connections)
    || !Array.isArray(value.selectedNodeIds)
    || !isRecord(value.viewport)
    || !finite(value.viewport.x)
    || !finite(value.viewport.y)
    || !finite(value.viewport.k)
    || typeof value.backgroundMode !== 'string'
    || !backgroundModes.has(value.backgroundMode)
    || !Array.isArray(value.agentSessions)
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string') {
    throw new Error(`第 ${index + 1} 个工作流格式无效`);
  }
  value.nodes.forEach((node, nodeIndex) => validateNode(node, index, nodeIndex));
  const nodeIds = new Set(value.nodes.map(node => node.id));
  if (nodeIds.size !== value.nodes.length) throw new Error(`第 ${index + 1} 个工作流包含重复节点 ID`);
  const acceptedConnections: WorkflowProject['connections'] = [];
  const connectionIds = new Set<string>();
  value.connections.forEach(connection => {
    if (!isRecord(connection)
      || typeof connection.id !== 'string'
      || typeof connection.fromNodeId !== 'string'
      || typeof connection.toNodeId !== 'string'
      || !nodeIds.has(connection.fromNodeId)
      || !nodeIds.has(connection.toNodeId)) {
      throw new Error(`第 ${index + 1} 个工作流包含无效连线`);
    }
    if (connectionIds.has(connection.id)) throw new Error(`第 ${index + 1} 个工作流包含重复连线 ID`);
    const validation = validateWorkflowConnection({
      projectId: value.id,
      title: value.title,
      nodes: value.nodes,
      connections: acceptedConnections,
      selectedNodeIds: [],
      viewport: value.viewport,
    }, connection.fromNodeId, connection.toNodeId);
    if (!validation.ok) throw new Error(`第 ${index + 1} 个工作流连线无效：${validation.reason}`);
    connectionIds.add(connection.id);
    acceptedConnections.push(connection);
  });
}

function validateExport(value: unknown): asserts value is WorkflowExportFile {
  if (!isRecord(value)
    || value.app !== WORKFLOW_EXPORT_APP
    || value.version !== WORKFLOW_EXPORT_VERSION
    || !Array.isArray(value.projects)) {
    throw new Error('不是受支持的 Flovart Workflow 文件');
  }
  value.projects.forEach((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.assets)) throw new Error(`第 ${index + 1} 个工作流导出项无效`);
    validateProject(entry.project, index);
    const nodeIds = new Set(entry.project.nodes.map(node => node.id));
    const assetNodeIds = new Set<string>();
    entry.assets.forEach(asset => {
      const dataMimeType = isRecord(asset) && typeof asset.dataUrl === 'string'
        ? asset.dataUrl.match(/^data:((?:image|video|audio)\/[^;,]+);base64,/i)?.[1]
        : undefined;
      if (!isRecord(asset)
        || typeof asset.nodeId !== 'string'
        || !nodeIds.has(asset.nodeId)
        || typeof asset.dataUrl !== 'string'
        || !dataMimeType
        || typeof asset.mimeType !== 'string'
        || asset.mimeType.toLowerCase() !== dataMimeType.toLowerCase()) {
        throw new Error(`第 ${index + 1} 个工作流包含无效媒体`);
      }
      if (assetNodeIds.has(asset.nodeId)) throw new Error(`第 ${index + 1} 个工作流包含重复媒体`);
      assetNodeIds.add(asset.nodeId);
    });
  });
}

export async function parseWorkflowProjectFile(file: File): Promise<WorkflowProject[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('工作流文件不是有效 JSON');
  }
  validateExport(parsed);
  const createdKeys: string[] = [];
  try {
    return await Promise.all(parsed.projects.map(async ({ project, assets }) => {
      const assetByNode = new Map(assets.map(asset => [asset.nodeId, asset]));
      const nodes = await Promise.all(project.nodes.map(async node => {
        const asset = assetByNode.get(node.id);
        if (!asset) return { ...node, metadata: { ...node.metadata, storageKey: undefined } };
        const blob = await workflowDataUrlToBlob(asset.dataUrl);
        const storageKey = `workflow-media-${nanoid()}`;
        await workflowMediaStorage.set(storageKey, blob);
        createdKeys.push(storageKey);
        return {
          ...node,
          metadata: {
            ...node.metadata,
            storageKey,
            href: undefined,
            mimeType: asset.mimeType,
            name: asset.name || node.metadata.name,
            bytes: blob.size,
          },
        };
      }));
      const now = new Date().toISOString();
      return {
        ...project,
        id: nanoid(),
        title: `${project.title}（导入）`,
        nodes,
        selectedNodeIds: [],
        activeAgentSessionId: null,
        createdAt: now,
        updatedAt: now,
      };
    }));
  } catch (error) {
    await Promise.all(createdKeys.map(key => workflowMediaStorage.remove(key)));
    throw error;
  }
}

function safeFileName(value: string) {
  return (value.trim() || 'Flovart-Workflow').replace(/[\\/:*?"<>|]/g, '_');
}
