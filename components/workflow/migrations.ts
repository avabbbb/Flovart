import { workflowStorage } from './storage';
import { WORKFLOW_SNAPSHOT_LIMIT } from './snapshots';
import type { WorkflowConnection, WorkflowNamedSnapshot, WorkflowNode, WorkflowProject, WorkflowViewport } from './types';

// v2：新增 subgraph 节点与可选 parentId；旧数据无需补字段，只清理非法 / 悬空的 parentId。
// v3：文本节点改为独立「备注」，不再作为生成 prompt 上下文；旧连线迁移为可合并目标。
export const WORKFLOW_PERSISTENCE_VERSION = 3;
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
    ...('parentId' in value ? { parentId: typeof value.parentId === 'string' && value.parentId ? value.parentId : undefined } : {}),
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
      const migrated = migrateNoteSemantics(nodes, connections);
      return [{
        id: item.id,
        name: typeof item.name === 'string' && item.name.trim() ? item.name : '未命名快照',
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
        nodes: migrated.nodes,
        connections: migrated.connections,
        ...(isRecord(item.viewport) ? { viewport: viewportOf(item.viewport) } : {}),
      }];
    } catch {
      return [];
    }
  }).slice(-WORKFLOW_SNAPSHOT_LIMIT);
}

function migrateNoteSemantics(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): { nodes: WorkflowNode[]; connections: WorkflowConnection[] } {
  const typeById = new Map(nodes.map(node => [node.id, node.type]));
  const targetsByNote = new Map<string, string[]>();
  const addTarget = (noteId: string, targetId: string) => {
    if (typeById.get(noteId) !== 'text' || noteId === targetId) return;
    const targets = targetsByNote.get(noteId) || [];
    if (!targets.includes(targetId)) targets.push(targetId);
    targetsByNote.set(noteId, targets);
  };
  // Operation 旧的 prompt_context binding 也属于同一套隐式提示词语义。
  const migratedNodes = nodes.map(node => {
    if (node.type !== 'operation' || !node.metadata.operation) return node;
    const record = node.metadata.operation;
    const bindings = record.recipe.inputBindings || [];
    const textBindings = bindings.filter(binding => binding.role === 'prompt_context');
    if (!textBindings.length) return node;
    textBindings.forEach(binding => addTarget(binding.sourceNodeId, node.id));
    return {
      ...node,
      metadata: {
        ...node.metadata,
        operation: {
          ...record,
          recipe: {
            ...record.recipe,
            inputBindings: bindings.filter(binding => binding.role !== 'prompt_context'),
          },
        },
      },
    };
  });
  // 备注是叶子：移除所有进入/离开备注的连线，但记录旧下游目标供一次性合并。
  const migratedConnections = connections.filter(connection => {
    if (typeById.get(connection.fromNodeId) === 'text') {
      addTarget(connection.fromNodeId, connection.toNodeId);
      return false;
    }
    return typeById.get(connection.toNodeId) !== 'text';
  });
  return {
    nodes: migratedNodes.map(node => {
      if (node.type !== 'text') return node;
      const targets = targetsByNote.get(node.id);
      if (!targets?.length) return node;
      return {
        ...node,
        metadata: {
          ...node.metadata,
          noteMergeTargetIds: [...new Set([...(node.metadata.noteMergeTargetIds || []), ...targets])],
        },
      };
    }),
    connections: migratedConnections,
  };
}

export function migrateWorkflowProject(value: unknown, now = new Date().toISOString()): WorkflowProject {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    throw new Error('工作流迁移失败：项目缺少 id 或 title');
  }
  const parsedNodes = Array.isArray(value.nodes) ? value.nodes.map(nodeOf) : [];
  const nodeIds = new Set(parsedNodes.map(node => node.id));
  // parentId 指向不存在的子画布时退回顶层节点。
  const nodes = parsedNodes.map(node => (node.parentId && !nodeIds.has(node.parentId) ? { ...node, parentId: undefined } : node));
  const connections = (Array.isArray(value.connections) ? value.connections : [])
    .map((connection, index) => connectionOf(connection, index, nodeIds))
    .filter((connection): connection is WorkflowConnection => Boolean(connection));
  const selectedNodeIds = (Array.isArray(value.selectedNodeIds) ? value.selectedNodeIds : [])
    .filter((id): id is string => typeof id === 'string' && nodeIds.has(id));
  const draftVersion = positive(value.draftVersion, positive(value.revision, 1));
  const backgroundMode = value.backgroundMode === 'lines' || value.backgroundMode === 'none' ? value.backgroundMode : 'dots';
  const noteMigration = migrateNoteSemantics(nodes, connections);
  return {
    ...value,
    id: value.id,
    title: value.title,
    nodes: noteMigration.nodes,
    connections: noteMigration.connections,
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
