import { workflowStorage } from './storage';
import { WORKFLOW_SNAPSHOT_LIMIT } from './snapshots';
import type { WorkflowConnection, WorkflowNamedSnapshot, WorkflowNode, WorkflowProject, WorkflowViewport } from './types';

export const WORKFLOW_PERSISTENCE_VERSION = 1;
export const WORKFLOW_BACKUP_KEY = 'flovart:workflow:projects:backup';

export interface PersistedWorkflowStateLike {
  projects: WorkflowProject[];
  activeProjectId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function positive(value: unknown, fallback: number) {
  return finite(value) && value > 0 ? value : fallback;
}

function viewportOf(value: unknown): WorkflowViewport {
  const source = isRecord(value) ? value : {};
  return {
    x: finite(source.x) ? source.x : 0,
    y: finite(source.y) ? source.y : 0,
    k: positive(source.k, 1),
  };
}

function nodeOf(value: unknown, index: number): WorkflowNode {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    throw new Error(`工作流迁移失败：第 ${index + 1} 个节点缺少 id 或 type`);
  }
  const position = isRecord(value.position) ? value.position : {};
  return {
    ...value,
    id: value.id,
    type: value.type,
    title: typeof value.title === 'string' && value.title.trim() ? value.title : '未命名节点',
    position: { x: finite(position.x) ? position.x : 0, y: finite(position.y) ? position.y : 0 },
    width: positive(value.width, 320),
    height: positive(value.height, 200),
    metadata: isRecord(value.metadata) ? value.metadata : {},
    objectVersion: positive(value.objectVersion, 1),
    isVisible: value.isVisible !== false,
    isLocked: value.isLocked === true,
  } as WorkflowNode;
}

function connectionOf(value: unknown, index: number, nodeIds: Set<string>): WorkflowConnection | null {
  if (!isRecord(value) || typeof value.fromNodeId !== 'string' || typeof value.toNodeId !== 'string') return null;
  if (!nodeIds.has(value.fromNodeId) || !nodeIds.has(value.toNodeId)) return null;
  return {
    ...value,
    id: typeof value.id === 'string' && value.id ? value.id : `legacy-connection-${index + 1}`,
    objectVersion: positive(value.objectVersion, 1),
  } as WorkflowConnection;
}

// 单个快照损坏时只丢弃该快照，不影响项目本身加载。
function snapshotsOf(value: unknown): WorkflowNamedSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): WorkflowNamedSnapshot[] => {
    if (!isRecord(item) || typeof item.id !== 'string' || !Array.isArray(item.nodes)) return [];
    try {
      const nodes = item.nodes.map(nodeOf);
      const nodeIds = new Set(nodes.map(node => node.id));
      const connections = (Array.isArray(item.connections) ? item.connections : [])
        .map((connection, index) => connectionOf(connection, index, nodeIds))
        .filter((connection): connection is WorkflowConnection => Boolean(connection));
      return [{
        id: item.id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name : '未命名快照',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
        nodes,
        connections,
        ...(isRecord(item.viewport) ? { viewport: viewportOf(item.viewport) } : {}),
      }];
    } catch {
      return [];
    }
  }).slice(-WORKFLOW_SNAPSHOT_LIMIT);
}

export function migrateWorkflowProject(value: unknown, now = new Date().toISOString()): WorkflowProject {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new Error('工作流迁移失败：项目缺少 id 或 title');
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(nodeOf) : [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const connections = (Array.isArray(value.connections) ? value.connections : [])
    .map((connection, index) => connectionOf(connection, index, nodeIds))
    .filter((connection): connection is WorkflowConnection => Boolean(connection));
  const selectedNodeIds = (Array.isArray(value.selectedNodeIds) ? value.selectedNodeIds : [])
    .filter((id): id is string => typeof id === 'string' && nodeIds.has(id));
  const draftVersion = positive(value.draftVersion, positive(value.revision, 1));
  const backgroundMode = value.backgroundMode === 'lines' || value.backgroundMode === 'none' ? value.backgroundMode : 'dots';
  return {
    ...value,
    id: value.id,
    title: value.title,
    nodes,
    connections,
    selectedNodeIds,
    viewport: viewportOf(value.viewport),
    backgroundMode,
    agentSessions: Array.isArray(value.agentSessions) ? value.agentSessions : [],
    activeAgentSessionId: typeof value.activeAgentSessionId === 'string' ? value.activeAgentSessionId : null,
    draftLog: Array.isArray(value.draftLog) ? value.draftLog : [],
    draftChangeSets: Array.isArray(value.draftChangeSets) ? value.draftChangeSets : [],
    draftRedoStack: Array.isArray(value.draftRedoStack) ? value.draftRedoStack : [],
    draftVersion,
    workflowMutationReceipts: Array.isArray(value.workflowMutationReceipts) ? value.workflowMutationReceipts : [],
    ...(Array.isArray(value.snapshots) ? { snapshots: snapshotsOf(value.snapshots) } : { snapshots: undefined }),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

export async function migrateWorkflowPersistedState(
  value: unknown,
  version = 0,
): Promise<PersistedWorkflowStateLike> {
  const source = isRecord(value) ? value : {};
  if (version < WORKFLOW_PERSISTENCE_VERSION) {
    await workflowStorage.set(WORKFLOW_BACKUP_KEY, { version, state: value, createdAt: new Date().toISOString() });
  }
  const projects = Array.isArray(source.projects) ? source.projects.map(project => migrateWorkflowProject(project)) : [];
  const projectIds = new Set(projects.map(project => project.id));
  const activeProjectId = typeof source.activeProjectId === 'string' && projectIds.has(source.activeProjectId)
    ? source.activeProjectId
    : projects[0]?.id || null;
  return { projects, activeProjectId };
}
