import { foldResultBatches } from './batchAlternates';
import { migrateManualBatchGroups } from './canvasGroups';
import { migrateLegacyOperationNodes } from './directOutputMigration';
import { workflowStorage } from './storage';
import { WORKFLOW_SNAPSHOT_LIMIT } from './snapshots';
import type { WorkflowConnection, WorkflowNamedSnapshot, WorkflowNode, WorkflowProject, WorkflowViewport } from './types';

// v2：新增 subgraph 节点与可选 parentId；旧数据无需补字段，只清理非法 / 悬空的 parentId。
// v3：文本节点改为独立「备注」，不再作为生成 prompt 上下文；旧连线迁移为可合并目标。
// v4：多结果叠放批次折叠成首图节点上的备选（metadata.alternates）；升级前整份状态写入备份键。
// v5：手动分组（batchGroupSource 'manual'）迁移成分组框（subgraph + groupKind 'group' + parentId），batchId 不再表示手动分组。
// v6：去掉 operation 中间节点——生成记录挪到结果节点，输入直连结果（directOutputMigration.ts）；升级前整份状态写入备份键。
export const WORKFLOW_PERSISTENCE_VERSION = 6;
export const WORKFLOW_BACKUP_KEY = 'iris:workflow:projects:backup';

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

/**
 * 解析单个持久化节点。缺 type 或不是对象的节点无法还原，返回 null 由调用方丢弃；
 * 只缺 id 的节点（历史上 Agent 写入过）补一个稳定的修复 id，保住用户内容。绝不抛错——
 * 一个坏节点不能让整个工作流（乃至全部工作流）无法加载。
 */
function nodeOf(value: unknown, index: number, takenIds: Set<string>): WorkflowNode | null {
  if (!isRecord(value) || typeof value.type !== 'string' || !value.type.trim()) {
    console.warn(`[Workflow] 丢弃无法还原的第 ${index + 1} 个节点（缺少 type）`);
    return null;
  }
  let id = typeof value.id === 'string' && value.id.trim() ? value.id : '';
  if (!id || takenIds.has(id)) {
    const base = id ? `${id}-dup` : `repaired-node-${index + 1}`;
    let candidate = base;
    for (let n = 2; takenIds.has(candidate); n += 1) candidate = `${base}-${n}`;
    console.warn(`[Workflow] 第 ${index + 1} 个节点${id ? ' id 重复' : '缺少 id'}，已修复为 ${candidate}`);
    id = candidate;
  }
  takenIds.add(id);
  const position = isRecord(value.position) ? value.position : {};
  return {
    ...value,
    id,
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

function nodesOf(value: unknown): WorkflowNode[] {
  if (!Array.isArray(value)) return [];
  const takenIds = new Set<string>();
  return value.flatMap((item, index) => {
    const node = nodeOf(item, index, takenIds);
    return node ? [node] : [];
  });
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
      const nodes = nodesOf(item.nodes);
      // 快照是还原点：有节点无法还原就整份丢弃，不能还原出缺节点的半份快照。
      if (nodes.length !== item.nodes.length) return [];
      const nodeIds = new Set(nodes.map(node => node.id));
      const connections = (Array.isArray(item.connections) ? item.connections : [])
        .map((connection, index) => connectionOf(connection, index, nodeIds))
        .filter((connection): connection is WorkflowConnection => Boolean(connection));
      const noted = migrateNoteSemantics(nodes, connections);
      const migrated = migrateLegacyOperationNodes(noted.nodes, noted.connections);
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
    if (!textBindings.length) {
      // 旧数据/外部导入可能缺 inputBindings：补成空数组，避免节点卡片渲染时崩溃。
      if (Array.isArray(record.recipe.inputBindings)) return node;
      return { ...node, metadata: { ...node.metadata, operation: { ...record, recipe: { ...record.recipe, inputBindings: [] } } } };
    }
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

function migrateLegacyManualGroups(nodes: WorkflowNode[]): WorkflowNode[] {
  const groups = new Map<string, WorkflowNode[]>();
  for (const node of nodes) {
    if (!node.batchId) continue;
    const group = groups.get(node.batchId) || [];
    group.push(node);
    groups.set(node.batchId, group);
  }
  const legacyManualIds = new Set([...groups].flatMap(([batchId, group]) => (
    group.length > 1
    && group.every(node => node.batchGroupSource === undefined && node.batchIndex === undefined)
      ? [batchId]
      : []
  )));
  if (!legacyManualIds.size) return nodes;
  return nodes.map(node => node.batchId && legacyManualIds.has(node.batchId)
    ? { ...node, batchGroupSource: 'manual' as const }
    : node);
}

export function migrateWorkflowProject(value: unknown, now = new Date().toISOString()): WorkflowProject {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
    throw new Error('工作流迁移失败：项目缺少 id');
  }
  const title = typeof value.title === 'string' && value.title.trim() ? value.title : '未命名工作流';
  const parsedNodes = nodesOf(value.nodes);
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
  const noteSemantics = migrateNoteSemantics(nodes, connections);
  // v6：operation 中间节点 → 直连结果节点（幂等：迁移后不再有 operation 节点）。
  const noteMigration = migrateLegacyOperationNodes(noteSemantics.nodes, noteSemantics.connections, now);
  // 旧的叠放批次（生成多张时其余结果是同位叠放的独立节点）折叠成首图节点上的备选；有连线的成员改成普通节点。
  const foldedNodes = foldResultBatches(migrateLegacyManualGroups(noteMigration.nodes), noteMigration.connections).nodes;
  // 手动分组 → 分组框（幂等：迁移后不再有 'manual' 的 batchId 分组）。
  const migratedNodes = migrateManualBatchGroups(foldedNodes).nodes;
  const survivingIds = new Set(migratedNodes.map(node => node.id));
  return {
    ...value,
    id: value.id,
    title,
    nodes: migratedNodes,
    connections: noteMigration.connections,
    selectedNodeIds: [...new Set(selectedNodeIds.map(id => noteMigration.renamed.get(id) || id))].filter(id => survivingIds.has(id)),
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

export const WORKFLOW_QUARANTINE_KEY = 'iris:workflow:projects:quarantine';

/**
 * 逐个迁移项目：某个项目迁移抛错时只隔离它（原始数据写入隔离键，不丢），其它项目照常打开。
 * 持久化水合（zustand merge）与版本迁移都走这里。
 */
export function migrateWorkflowProjectsSafely(value: unknown, now?: string): WorkflowProject[] {
  if (!Array.isArray(value)) return [];
  const quarantined: unknown[] = [];
  const projects = value.flatMap(project => {
    try {
      return [migrateWorkflowProject(project, now)];
    } catch (error) {
      console.warn('[Workflow] 隔离一个无法加载的工作流，其它工作流照常打开。', error);
      quarantined.push(project);
      return [];
    }
  });
  if (quarantined.length) {
    void workflowStorage.get<unknown[]>(WORKFLOW_QUARANTINE_KEY)
      .then(previous => workflowStorage.set(WORKFLOW_QUARANTINE_KEY, [...(Array.isArray(previous) ? previous : []), ...quarantined].slice(-20)))
      .catch(() => undefined);
  }
  return projects;
}

export async function migrateWorkflowPersistedState(
  value: unknown,
  version = 0,
): Promise<PersistedWorkflowStateLike> {
  const source = isRecord(value) ? value : {};
  if (version < WORKFLOW_PERSISTENCE_VERSION) {
    await workflowStorage.set(WORKFLOW_BACKUP_KEY, { version, state: value, createdAt: new Date().toISOString() });
  }
  const projects = migrateWorkflowProjectsSafely(source.projects);
  const projectIds = new Set(projects.map(project => project.id));
  const activeProjectId = typeof source.activeProjectId === 'string' && projectIds.has(source.activeProjectId)
    ? source.activeProjectId
    : projects[0]?.id || null;
  return { projects, activeProjectId };
}
