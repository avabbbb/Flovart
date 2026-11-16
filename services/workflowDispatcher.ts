import { WORKFLOW_NODE_PATCH_FIELDS, WORKFLOW_OPERATION_FIELDS } from '../tools/flovart/workflow-operation-schema.js';
import { nanoid } from 'nanoid';
import { WORKFLOW_MUTATION_COMMANDS, workflowCommandSummary } from '../components/workflow/agentOps';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowMutation, applyWorkflowViewOperations } from '../components/workflow/draftAuthority';
import { applyWorkflowOps } from '../components/workflow/ops';
import { appendWorkflowDraftLog, createWorkflowDraftLogEntry } from '../components/workflow/draftLog';
import { isWorkflowNodeTool } from '../components/workflow/nodeToolCatalog';
import { getWorkflowOperationCapabilityByNodeTool, parseWorkflowOperationNodeToolArguments } from '../components/workflow/operationRegistry';
import { getWorkflowPersistenceError, useWorkflowStore } from '../components/workflow/store';
import { reorderReferenceOperations } from '../components/workflow/references';
import type { WorkflowConnection, WorkflowDocumentOperation, WorkflowMutationSource, WorkflowNode, WorkflowNodeMetadata, WorkflowNodeType, WorkflowProject } from '../components/workflow/types';
import { normalizeWorkflowExecutionError, type WorkflowExecutor, type WorkflowRunCommand, type WorkflowRunResult } from './workflowExecutor';
import { displayError } from './displayError';
import { buildProductionBible } from '../components/workflow/productionBible';
import { nodeSearchQueryFromArgs, searchWorkflowNodes } from '../components/workflow/nodeSearch';
import { buildWorkflowPromptDocument, promptDocumentMentions } from '../components/workflow/promptDocument';
import { generateModeOf, listWorkflowModels, planWorkflowGenerate, WorkflowGenerateError } from './workflowGenerateCommand';
import type { UserApiKey } from '../types';

export interface WorkflowCommandEnvelope {
  id: string;
  command: string;
  args: Record<string, unknown>;
  source: 'ui' | 'cli' | 'agent' | 'operator';
  idempotencyKey?: string;
  caller?: { agentIdentity?: string; hostSessionId?: string };
  workspaceLease?: {
    leaseId: string;
    agentIdentity: string;
    clientId: string;
    projectId: string;
    baseRevision: number | null;
    issuedAt: number;
    expiresAt: number;
  };
}

const WORKFLOW_HUMAN_APPROVAL = Symbol('flovart.workflow-human-approval');

export function withWorkflowHumanApproval(envelope: WorkflowCommandEnvelope): WorkflowCommandEnvelope {
  const approved = { ...envelope, args: { ...envelope.args } };
  delete approved.args.confirmed;
  Object.defineProperty(approved, WORKFLOW_HUMAN_APPROVAL, { value: true });
  return approved;
}

function hasWorkflowHumanApproval(envelope: WorkflowCommandEnvelope): boolean {
  return (envelope as WorkflowCommandEnvelope & { [WORKFLOW_HUMAN_APPROVAL]?: true })[WORKFLOW_HUMAN_APPROVAL] === true;
}

export interface WorkflowCommandResult {
  ok: boolean;
  commandId: string;
  result?: unknown;
  confirmation?: { required: boolean; summary: string; code?: 'CONFIRMATION_REQUIRED' };
  error?: { code: string; message: string; expectedRevision?: number; actualRevision?: number; changedObjectIds?: string[]; details?: Record<string, unknown> };
}

export interface WorkflowDispatcherDependencies {
  getState: () => { projects: WorkflowProject[]; activeProjectId: string | null };
  createProject: (title?: string) => string;
  setActiveProject: (id: string | null) => void;
  deleteProjects: (ids: string[]) => void;
  updateProject: (id: string, patch: Partial<Omit<WorkflowProject, 'id' | 'createdAt'>>) => void;
  executor?: WorkflowExecutor;
  getExecutor?: () => WorkflowExecutor | undefined;
  nodeToolRunner?: (projectId: string, nodeId: string, tool: string, args: Record<string, unknown>) => Promise<unknown>;
  persistenceError?: () => unknown;
  /** 当前 BYOK Key：models.list / generate 判断哪些模型与模式真正可运行 */
  getUserApiKeys?: () => UserApiKey[];
  /** 素材库查询：media.import 的 assetId 来源 */
  lookupAsset?: (assetId: string) => WorkflowImportAsset | undefined;
  /** URL → durable Workflow 媒体记录；默认在浏览器里下载后走 ingestWorkflowMedia */
  importMediaUrl?: (url: string) => Promise<WorkflowImportedMedia>;
}

export interface WorkflowImportAsset {
  id: string;
  name?: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface WorkflowImportedMedia {
  type: 'image' | 'video' | 'audio';
  metadata: WorkflowNodeMetadata;
  width: number;
  height: number;
  /** 写入成功后释放 pending 保护；失败时丢弃已存的媒体 */
  commit?: () => void;
  discard?: () => Promise<void> | void;
}

async function browserImportMediaUrl(url: string): Promise<WorkflowImportedMedia> {
  const { ingestWorkflowMedia, fitWorkflowMediaSize, releaseWorkflowMediaRecord, discardWorkflowMediaRecord } = await import('../components/workflow/media');
  const response = await fetch(url);
  if (!response.ok) throw new Error('下载素材失败：HTTP ' + response.status);
  const blob = await response.blob();
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'imported') || 'imported';
  const record = await ingestWorkflowMedia(new File([blob], name, { type: blob.type || response.headers.get('content-type') || '' }));
  const { type, ...metadata } = record;
  const size = fitWorkflowMediaSize(type, record.naturalWidth, record.naturalHeight);
  return {
    type,
    metadata: { ...metadata, status: 'success' },
    width: size.width,
    height: size.height,
    commit: () => releaseWorkflowMediaRecord(record.storageKey),
    discard: () => discardWorkflowMediaRecord(record.storageKey),
  };
}

const NOTE_IS_ANNOTATION_MESSAGE = '文本节点是备注，只给人看、不参与生成：生成请用 flovart_generate（提示词写进生成节点的 Prompt Bar）；用户明确要求写备注时用 flovart_note_write。';

/** 非 UI 来源（Agent / CLI / MCP / Runtime）不得用通用写入建文本节点。 */
function agentTextNodeViolation(source: WorkflowCommandEnvelope['source'], operations: WorkflowDocumentOperation[]): boolean {
  if (source === 'ui') return false;
  return operations.some(op => (op.type === 'add_node' || op.type === 'create_connected_node') && op.node?.type === 'text');
}

function stableShortId(prefix: string, seed: string) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return prefix + hash.toString(36);
}

const MAX_IDEMPOTENCY_ENTRIES = 256;
const NODE_TYPES: WorkflowNodeType[] = ['image', 'text', 'video', 'audio'];
const DOCUMENT_OPERATION_TYPES = new Set<WorkflowDocumentOperation['type']>([
  'add_node', 'create_connected_node', 'update_node', 'delete_nodes', 'delete_connections', 'connect_nodes',
  'move_nodes', 'reorder_nodes', 'reorder_connections', 'group_nodes', 'ungroup_nodes', 'set_batch_primary',
]);
const DOCUMENT_MUTATION_COMMANDS = new Set([
  'workflow.apply', 'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update',
  'workflow.node.delete', 'workflow.node.move', 'workflow.node.resize', 'workflow.connect', 'workflow.disconnect',
]);
const WORKFLOW_READ_COMMANDS = new Set(['workflow.project.list', 'workflow.inspect', 'workflow.selection.get', 'workflow.models.list', 'workflow.nodes.search']);
const SENSITIVE_KEY = /(?:api.?key|authorization|token|secret|password|storage.?key|file.?path|local.?path|data.?url)/i;
const MEDIA_KEY = /^(?:href|poster|src|url)$/i;
const LOCAL_PATH = /^(?:[a-z]:\\|\\\\|\/home\/|\/Users\/|\/tmp\/)/i;

export function redactWorkflowAgentValue<T>(value: T, key = ''): T {
  if (SENSITIVE_KEY.test(key)) return '[redacted]' as T;
  if (typeof value === 'string') {
    if (MEDIA_KEY.test(key) || /^(?:data:|blob:|file:)/i.test(value) || LOCAL_PATH.test(value)) return '[media]' as T;
    return value
      .replace(/(?:data|blob|file):[^\s"']+/gi, '[media]')
      .replace(/(?:[a-z]:\\|\\\\)[^\r\n"']+/gi, '[local-path]') as T;
  }
  if (Array.isArray(value)) return value.map(item => redactWorkflowAgentValue(item)) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redactWorkflowAgentValue(child, childKey)])) as T;
}

const redactNode = (node: WorkflowNode) => ({
  ...redactWorkflowAgentValue(node),
  metadata: {
    ...redactWorkflowAgentValue(node.metadata),
    hasMedia: Boolean(node.metadata.href || node.metadata.poster || node.metadata.storageKey),
  },
});

const redactProject = (project: WorkflowProject) => ({
  ...redactWorkflowAgentValue(project),
  nodes: project.nodes.map(redactNode),
});

const INSPECT_CHANGE_SET_SUMMARY = 5;
const INSPECT_RECEIPT_SUMMARY = 3;

// inspect 默认只给最近的变更摘要：完整 ChangeSet / Receipt 的 before/after 会把模型上下文塞满。
const inspectProject = (project: WorkflowProject) => {
  const { draftChangeSets = [], workflowMutationReceipts = [], draftRedoStack: _redoStack, ...rest } = redactProject(project);
  return {
    ...rest,
    draftChangeSets: draftChangeSets.slice(-INSPECT_CHANGE_SET_SUMMARY).map(item => ({
      id: item.id,
      at: item.at,
      actor: item.actor,
      intent: item.intent,
      status: item.status,
      baseDraftVersion: item.baseDraftVersion,
      resultDraftVersion: item.resultDraftVersion,
      nodeIds: item.nodeChanges.map(change => change.id),
      connectionIds: item.connectionChanges.map(change => change.id),
    })),
    draftChangeSetsTotal: draftChangeSets.length,
    workflowMutationReceipts: workflowMutationReceipts.slice(-INSPECT_RECEIPT_SUMMARY).map(item => ({
      mutationId: item.mutationId,
      previousRevision: item.previousRevision,
      revision: item.revision,
      replayed: item.replayed,
      changeSetId: item.changeSetId,
      createdAt: item.createdAt,
    })),
    workflowMutationReceiptsTotal: workflowMutationReceipts.length,
  };
};

/** 轻量图：只给 id/type/title/位置/尺寸，避免 Agent 每次拉全量 metadata。 */
const inspectSummary = (project: WorkflowProject) => ({
  projectId: project.id,
  title: project.title,
  draftVersion: project.draftVersion || 1,
  selectedNodeIds: project.selectedNodeIds,
  viewport: project.viewport,
  nodes: project.nodes.map(node => ({
    id: node.id,
    type: node.type,
    title: node.title,
    position: node.position,
    width: node.width,
    height: node.height,
    visible: node.isVisible !== false,
    locked: node.isLocked === true,
    status: node.metadata.status || 'idle',
    // 多结果的备选挂在节点上（不是画布节点）；详情用 inspect nodeId 读 metadata.alternates。
    ...(node.metadata.alternates?.length ? { alternateCount: node.metadata.alternates.length } : {}),
  })),
  connectionCount: project.connections.length,
  connections: project.connections.map(connection => ({
    id: connection.id,
    fromNodeId: connection.fromNodeId,
    toNodeId: connection.toNodeId,
    kind: connection.kind,
    role: connection.role,
    order: connection.order,
  })),
});

/** 单节点详查：含直接入/出边与邻居 id，足够 Agent 做局部修改而不用整图 inspect。 */
const inspectNode = (project: WorkflowProject, nodeId: string) => {
  const node = project.nodes.find(item => item.id === nodeId);
  if (!node) return null;
  const inbound = project.connections.filter(connection => connection.toNodeId === nodeId);
  const outbound = project.connections.filter(connection => connection.fromNodeId === nodeId);
  return {
    projectId: project.id,
    title: project.title,
    draftVersion: project.draftVersion || 1,
    node: redactNode(node),
    inbound,
    outbound,
    upstreamNodeIds: [...new Set(inbound.map(connection => connection.fromNodeId))],
    downstreamNodeIds: [...new Set(outbound.map(connection => connection.toNodeId))],
  };
};

const error = (
  commandId: string,
  code: string,
  message: string,
  details: Pick<NonNullable<WorkflowCommandResult['error']>, 'expectedRevision' | 'actualRevision' | 'changedObjectIds'> = {},
): WorkflowCommandResult => ({ ok: false, commandId, error: { code, message, ...details } });
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const requiredString = (value: unknown, label: string) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label}不能为空`);
  return text;
};
const finiteNumber = (value: unknown, label: string, fallback?: number) => {
  if ((value === undefined || value === null || value === '') && fallback !== undefined) return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label}必须是有限数字`);
  return number;
};
const positiveNumber = (value: unknown, label: string) => {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label}必须大于 0`);
  return number;
};
const recordArg = (value: unknown, label: string) => {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error(`${label}必须是对象`);
  return value;
};

/** AI/CLI/MCP 驱动的 Draft Action 记入项目草稿日志；纯 UI 手动编辑跳过（手动编辑已有独立撤销栈）。 */
function draftLogPatch(
  project: WorkflowProject,
  envelope: WorkflowCommandEnvelope,
  ok: boolean,
  extra?: { message?: string; nodeIds?: string[]; connectionIds?: string[] },
): Partial<WorkflowProject> {
  if (envelope.source === 'ui') return {};
  const entry = createWorkflowDraftLogEntry({
    source: envelope.source,
    command: envelope.command,
    args: envelope.args,
    ok,
    message: extra?.message,
    nodeIds: extra?.nodeIds,
    connectionIds: extra?.connectionIds,
  });
  return { draftLog: appendWorkflowDraftLog(project, entry).draftLog };
}

function validatedNode(args: Record<string, unknown>, fallbackId?: string): WorkflowNode {
  if (args.type === undefined || args.type === null || args.type === '') throw new Error('type 不能为空：image / video / audio（文本备注请用 flovart_note_write）');
  const type = String(args.type) as WorkflowNodeType;
  if (!NODE_TYPES.includes(type)) throw new Error(`不支持的节点类型：${type}`);
  const metadata = recordArg(args.metadata, 'metadata') as WorkflowNodeMetadata;
  const node = createWorkflowNode(String(args.id || fallbackId || nanoid()), type, {
    x: finiteNumber(args.x, 'x', 0),
    y: finiteNumber(args.y, 'y', 0),
  }, metadata);
  if (args.title !== undefined) node.title = requiredString(args.title, 'title');
  if (args.width !== undefined) node.width = positiveNumber(args.width, 'width');
  if (args.height !== undefined) node.height = positiveNumber(args.height, 'height');
  return node;
}

const AUTO_LAYOUT_GAP_X = 96;
const AUTO_LAYOUT_GAP_Y = 40;

/**
 * Agent 建节点未给 x/y 时的落位：放在上游节点（无上游时为全部节点）右侧一列，
 * 从上游顶边开始向下避让已有节点。旧行为是一律落在 (0,0)，多个节点会叠在原点。
 */
export function autoPlaceWorkflowNode(nodes: WorkflowNode[], node: Pick<WorkflowNode, 'width' | 'height'>, upstreamIds: string[] = []): { x: number; y: number } {
  const upstream = nodes.filter(item => upstreamIds.includes(item.id));
  const anchors = upstream.length ? upstream : nodes;
  if (!anchors.length) return { x: 0, y: 0 };
  const x = Math.max(...anchors.map(item => item.position.x + item.width)) + AUTO_LAYOUT_GAP_X;
  let y = Math.min(...anchors.map(item => item.position.y));
  // y 单调下移，每个阻挡节点至多命中一次。
  for (let guard = 0; guard <= nodes.length; guard += 1) {
    const blocker = nodes.find(item => x < item.position.x + item.width + AUTO_LAYOUT_GAP_Y
      && item.position.x < x + node.width + AUTO_LAYOUT_GAP_Y
      && y < item.position.y + item.height + AUTO_LAYOUT_GAP_Y
      && item.position.y < y + node.height + AUTO_LAYOUT_GAP_Y);
    if (!blocker) break;
    y = blocker.position.y + blocker.height + AUTO_LAYOUT_GAP_Y;
  }
  return { x, y };
}

function withSpecSize(node: WorkflowNode): WorkflowNode {
  const spec = createWorkflowNode(node.id, node.type, node.position || { x: 0, y: 0 });
  return { ...node, position: node.position || spec.position, width: node.width ?? spec.width, height: node.height ?? spec.height };
}

/** workflow.apply 里不带 position 的 add_node / create_connected_node 按同一规则落位；上游取 fromNodeId 或同批 connect_nodes。 */
export function autoPlaceDocumentOperations(nodes: WorkflowNode[], operations: WorkflowDocumentOperation[]): WorkflowDocumentOperation[] {
  const placed = [...nodes];
  return operations.map(op => {
    if (op.type !== 'add_node' && op.type !== 'create_connected_node') return op;
    if (!op.node || typeof op.node !== 'object') return op;
    const sized = withSpecSize(op.node);
    if (op.node.position) {
      placed.push(sized);
      return op;
    }
    const upstreamIds = op.type === 'create_connected_node'
      ? [op.fromNodeId]
      : operations.flatMap(item => (item.type === 'connect_nodes' && item.toNodeId === op.node.id ? [item.fromNodeId] : []));
    const node = { ...sized, position: autoPlaceWorkflowNode(placed, sized, upstreamIds) };
    placed.push(node);
    return { ...op, node };
  });
}

export function documentOperationsArg(value: unknown): WorkflowDocumentOperation[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('operations 必须是非空数组');
  return value.map((operation, index) => {
    if (!isRecord(operation) || typeof operation.type !== 'string' || !DOCUMENT_OPERATION_TYPES.has(operation.type as WorkflowDocumentOperation['type'])) {
      throw new Error('operations[' + index + '] 不是受支持的 Document Operation；可用 type：' + [...DOCUMENT_OPERATION_TYPES].join('、'));
    }
    // 未知字段直接报错并列出可用字段，避免 changes/fields 之类的猜测写法被静默丢弃后误报「无修改」。
    const allowed = (WORKFLOW_OPERATION_FIELDS as Record<string, readonly string[]>)[operation.type];
    if (allowed) {
      const unknownFields = Object.keys(operation).filter(key => !allowed.includes(key));
      if (unknownFields.length) {
        throw new Error('operations[' + index + '] ' + operation.type + ' 不支持字段 ' + unknownFields.join('、') + '；可用字段：' + allowed.join('、'));
      }
    }
    if (operation.type !== 'update_node') return operation as unknown as WorkflowDocumentOperation;
    // Agent 常把节点 id 写成 nodeId：归一化为 id；缺失时显式报错，不再落成静默空操作。
    const { nodeId, ...rest } = operation;
    const id = typeof rest.id === 'string' && rest.id.trim() ? rest.id
      : typeof nodeId === 'string' && nodeId.trim() ? nodeId
      : '';
    if (!id) throw new Error('operations[' + index + '] update_node 缺少节点 id');
    if (rest.patch !== undefined) {
      if (!isRecord(rest.patch)) throw new Error('operations[' + index + '] update_node.patch 必须是对象');
      const patchFields: readonly string[] = WORKFLOW_NODE_PATCH_FIELDS;
      const unknownPatch = Object.keys(rest.patch).filter(key => !patchFields.includes(key));
      if (unknownPatch.length) {
        throw new Error('operations[' + index + '] update_node.patch 不支持字段 ' + unknownPatch.join('、') + '；可用字段：' + patchFields.join('、') + '（提示词、配置写在 patch.metadata 里）');
      }
    }
    if (rest.metadata !== undefined && !isRecord(rest.metadata)) throw new Error('operations[' + index + '] update_node.metadata 必须是对象');
    if (!isRecord(rest.patch) && !isRecord(rest.metadata)) {
      throw new Error('operations[' + index + '] update_node 需要 patch 或 metadata，例如 {"type":"update_node","id":"' + id + '","patch":{"title":"新标题"}}');
    }
    return { ...rest, id } as unknown as WorkflowDocumentOperation;
  });
}

/**
 * reorder_connections 的 Agent 写法 {targetNodeId, orderedSourceIds}：展开成“断开目标入边 → 按新顺序重连”，
 * 让 Draft ChangeSet 记下真实的连线增删（可撤销、可重放）。同批前面带 id 的 connect_nodes 也算进去。
 * 只给完整 ids 的旧写法同样按目标节点分组展开。
 */
export function expandReferenceReorders(connections: readonly WorkflowConnection[], operations: WorkflowDocumentOperation[], createId: () => string = nanoid): WorkflowDocumentOperation[] {
  let working: WorkflowConnection[] = [...connections];
  return operations.flatMap((operation, index): WorkflowDocumentOperation[] => {
    if (operation.type === 'connect_nodes' && operation.id) {
      working = [...working, { id: operation.id, fromNodeId: operation.fromNodeId, toNodeId: operation.toNodeId }];
      return [operation];
    }
    if (operation.type === 'delete_connections') {
      const ids = new Set(operation.ids || []);
      working = operation.all ? [] : working.filter(connection => !ids.has(connection.id));
      return [operation];
    }
    if (operation.type !== 'reorder_connections') return [operation];
    const raw = operation as { type: 'reorder_connections'; ids?: unknown; targetNodeId?: unknown; orderedSourceIds?: unknown };
    let plans: Array<{ targetNodeId: string; orderedSourceIds: string[] }>;
    if (raw.targetNodeId === undefined && raw.orderedSourceIds === undefined) {
      if (!Array.isArray(raw.ids) || !raw.ids.length) throw new Error('operations[' + index + '] reorder_connections 需要 targetNodeId + orderedSourceIds，或完整的 ids');
      const byId = new Map(working.map(connection => [connection.id, connection]));
      const ordered = raw.ids.map(id => byId.get(String(id)));
      if (ordered.some(connection => !connection) || raw.ids.length !== working.length) throw new Error('operations[' + index + '] 连接顺序必须完整且不能重复');
      const targets = [...new Set(ordered.map(connection => connection!.toNodeId))];
      plans = targets.map(targetNodeId => ({ targetNodeId, orderedSourceIds: ordered.filter(connection => connection!.toNodeId === targetNodeId).map(connection => connection!.fromNodeId) }));
    } else {
      const targetNodeId = requiredString(raw.targetNodeId, 'reorder_connections.targetNodeId');
      if (!Array.isArray(raw.orderedSourceIds) || raw.orderedSourceIds.some(id => typeof id !== 'string')) {
        throw new Error('operations[' + index + '] reorder_connections.orderedSourceIds 必须是节点 id 数组');
      }
      const inbound = new Set(working.filter(connection => connection.toNodeId === targetNodeId).map(connection => connection.fromNodeId));
      const stray = (raw.orderedSourceIds as string[]).filter(id => !inbound.has(id));
      if (stray.length) throw new Error('operations[' + index + '] reorder_connections：' + stray.join('、') + ' 不是 ' + targetNodeId + ' 的上游参考，先 connect_nodes');
      plans = [{ targetNodeId, orderedSourceIds: raw.orderedSourceIds as string[] }];
    }
    return plans.flatMap(plan => {
      const ops = reorderReferenceOperations(working, plan.targetNodeId, plan.orderedSourceIds, () => 'conn-' + createId());
      for (const op of ops) {
        if (op.type === 'delete_connections') working = working.filter(connection => !op.ids.includes(connection.id));
        else working = [...working, { id: op.id, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId, kind: op.kind, role: op.role, order: op.order }];
      }
      return ops as WorkflowDocumentOperation[];
    });
  });
}

const mutationSource = (source: WorkflowCommandEnvelope['source']): WorkflowMutationSource => (
  source === 'operator' ? 'dsh' : source
);

// 节点来源：外部 Agent / CLI / 运维通道新建的节点标 origin='agent'，画布 UI 标 'user'；已显式给出的不覆盖。
export function tagWorkflowNodeOrigin(operations: WorkflowDocumentOperation[], source: WorkflowCommandEnvelope['source']): WorkflowDocumentOperation[] {
  const origin: 'agent' | 'user' = source === 'ui' ? 'user' : 'agent';
  return operations.map(op => {
    if (op.type !== 'add_node' && op.type !== 'create_connected_node') return op;
    if (!op.node || typeof op.node !== 'object' || op.node.metadata?.origin) return op;
    return { ...op, node: { ...op.node, metadata: { ...(op.node.metadata || {}), origin } } };
  });
}

function validateEnvelope(envelope: WorkflowCommandEnvelope): WorkflowCommandResult | null {
  if (!envelope || typeof envelope !== 'object') return error('', 'BAD_REQUEST', '命令 envelope 无效。');
  if (!String(envelope.id || '').trim()) return error('', 'BAD_REQUEST', '命令 id 不能为空。');
  if (!String(envelope.command || '').trim()) return error(envelope.id, 'BAD_REQUEST', '命令名称不能为空。');
  if (!isRecord(envelope.args)) return error(envelope.id, 'BAD_REQUEST', '命令参数必须是对象。');
  if (!['ui', 'cli', 'agent', 'operator'].includes(envelope.source)) return error(envelope.id, 'BAD_REQUEST', '命令来源无效。');
  return null;
}

function requiresWorkflowConfirmation(envelope: WorkflowCommandEnvelope) {
  const isExternalAgent = envelope.source === 'agent'
    || (envelope.source === 'cli' && Boolean(envelope.caller?.agentIdentity));
  if (!isExternalAgent) return false;
  // 批量文档操作里夹带删除节点，与单独 workflow.node.delete 同等风险，必须确认。
  if (envelope.command === 'workflow.apply') {
    try {
      return documentOperationsArg(envelope.args.operations || envelope.args.ops).some(op => op.type === 'delete_nodes');
    } catch {
      return false; // 参数非法时后续执行会直接报错，不会落写。
    }
  }
  // 只写 Prompt Bar 不扣费；run=true 时与 node.run 同等，需要确认。
  if (envelope.command === 'workflow.generate') return envelope.args.run === true || envelope.args.run === 'true';
  if (!WORKFLOW_MUTATION_COMMANDS.has(envelope.command) || !isExternalAgent) return false;
  if (envelope.command === 'workflow.project.delete' || envelope.command === 'workflow.node.delete' || envelope.command === 'workflow.node.run') return true;
  if (envelope.command !== 'workflow.node.tool') return false;
  const tool = String(envelope.args.tool || '');
  if (!isWorkflowNodeTool(tool)) return false;
  return getWorkflowOperationCapabilityByNodeTool(tool)?.confirmation !== 'none';
}

/** 工具策略层用：这条命令是否已经由命令面自己发起确认（避免重复弹窗）。 */
export function workflowCommandNeedsConfirmation(command: string, args: Record<string, unknown>): boolean {
  return requiresWorkflowConfirmation({ id: 'policy-probe', command, args, source: 'agent' } as WorkflowCommandEnvelope);
}

/**
 * 节点 ID 列表的统一解析（node.run 与 focus.nodes 共用）：
 * 接受数组、逗号分隔字符串（CLI `--node-ids a,b`）或 JSON 数组字符串。
 */
export function parseWorkflowNodeIdList(value: unknown, name = 'nodeIds'): string[] {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try { raw = JSON.parse(trimmed); } catch { throw new Error(name + ' 不是合法的 JSON 数组。'); }
    } else {
      raw = trimmed.split(',');
    }
  }
  if (!Array.isArray(raw)) throw new Error(name + ' 必须是节点 ID 数组或逗号分隔的字符串。');
  const ids = raw.map(item => (typeof item === 'string' ? item.trim() : item)).filter(item => item !== '');
  const nodeIds = [...new Set(ids.map(item => requiredString(item, name)))];
  if (!nodeIds.length) throw new Error(name + ' 不能为空。');
  return nodeIds;
}

/**
 * node.run / generate 的结构化结果：runId、批次（封面 + 全部成员）、每张产物。
 * artifact 字段保留为封面产物，兼容只读单张的旧调用方。
 */
export function workflowRunPayload(run: WorkflowRunResult) {
  const outputs = run.outputs;
  const takes = outputs?.artifacts.map(({ nodeId, artifactId, kind, mimeType }) => ({ nodeId, artifactId, kind, mimeType }))
    || (run.artifact ? [{ nodeId: run.nodeId, artifactId: run.artifact.artifactId, kind: run.artifact.kind, mimeType: run.artifact.mimeType }] : []);
  return {
    runId: run.runId,
    status: run.status,
    ...(run.artifact ? { artifact: run.artifact } : {}),
    batch: {
      ...(outputs?.batchId ? { batchId: outputs.batchId } : {}),
      headNodeId: outputs?.headNodeId || run.nodeId,
      memberNodeIds: outputs?.nodeIds || [run.nodeId],
    },
    primaryNodeId: outputs?.headNodeId || run.nodeId,
    takes,
  };
}

/** workflow.node.run 的目标节点：nodeId 单跑，或 nodeIds 一次确认后批量并行。 */
function workflowRunNodeIds(args: Record<string, unknown>): string[] {
  if (args.nodeIds === undefined) return [requiredString(args.nodeId || args.id, 'nodeId')];
  if (args.nodeId !== undefined || args.id !== undefined) throw new Error('nodeId 与 nodeIds 只能二选一。');
  return parseWorkflowNodeIdList(args.nodeIds);
}

/** workflow.focus.nodes 的目标节点：与 node.run 相同的列表语义；单个 nodeId 也可以是逗号分隔。 */
function workflowFocusNodeIds(args: Record<string, unknown>): string[] {
  if (args.nodeIds !== undefined) return parseWorkflowNodeIdList(args.nodeIds);
  if (args.nodeId !== undefined) return parseWorkflowNodeIdList(args.nodeId, 'nodeId');
  throw new Error('nodeIds 不能为空');
}

export function createWorkflowDispatcher(dependencies: WorkflowDispatcherDependencies) {
  const idempotencyCache = new Map<string, WorkflowCommandResult>();
  const cache = (key: string | undefined, result: WorkflowCommandResult) => {
    if (!key) return;
    idempotencyCache.set(key, result);
    while (idempotencyCache.size > MAX_IDEMPOTENCY_ENTRIES) idempotencyCache.delete(idempotencyCache.keys().next().value!);
  };

  /** 文档写入的唯一提交路径：draftAuthority 原子应用 → 写回 store → 回读提交结果。 */
  const commitDocument = (
    envelope: WorkflowCommandEnvelope,
    project: WorkflowProject,
    operations: WorkflowDocumentOperation[],
    options: { mutationId: string; expectedRevision: number; intent: string; clientId?: string; expectedObjectVersions?: Record<string, number> },
  ): WorkflowCommandResult => {
    const applied = applyWorkflowMutation(project, {
      clientId: options.clientId,
      projectId: project.id,
      expectedRevision: options.expectedRevision,
      mutationId: options.mutationId,
      source: mutationSource(envelope.source),
      intent: options.intent,
      ops: operations,
      expectedObjectVersions: options.expectedObjectVersions || {},
    });
    if (applied.ok === false) return error(envelope.id, applied.error.code, applied.error.message, {
      expectedRevision: applied.error.expectedRevision,
      actualRevision: applied.error.actualRevision,
      changedObjectIds: applied.error.changedObjectIds,
    });
    const affectedNodeIds = applied.changeSet.nodeChanges.map(change => change.id);
    const affectedConnectionIds = applied.changeSet.connectionChanges.map(change => change.id);
    const affectedIds = {
      ...(affectedNodeIds.length ? { nodeIds: affectedNodeIds } : {}),
      ...(affectedConnectionIds.length ? { connectionIds: affectedConnectionIds } : {}),
    };
    dependencies.updateProject(project.id, {
      nodes: applied.project.nodes,
      connections: applied.project.connections,
      selectedNodeIds: applied.project.selectedNodeIds,
      viewport: applied.project.viewport,
      draftVersion: applied.project.draftVersion,
      draftChangeSets: applied.project.draftChangeSets,
      draftRedoStack: applied.project.draftRedoStack,
      workflowMutationReceipts: applied.project.workflowMutationReceipts,
      ...(applied.receipt.replayed ? {} : draftLogPatch(project, envelope, true, affectedIds)),
    });
    const persistedError = dependencies.persistenceError?.();
    if (persistedError) return error(envelope.id, 'PERSISTENCE_FAILED', 'Workflow 持久化失败，请检查浏览器存储。');
    const committed = dependencies.getState().projects.find(item => item.id === project.id);
    if (!committed) return error(envelope.id, 'COMMIT_FAILED', 'Workflow 修改未提交。');
    const committedObjects = new Map<string, WorkflowNode | WorkflowConnection>([
      ...committed.nodes.map(item => [item.id, item] as const),
      ...committed.connections.map(item => [item.id, item] as const),
    ]);
    const objectVersions = Object.fromEntries(
      [...affectedNodeIds, ...affectedConnectionIds]
        .map(id => [id, committedObjects.get(id)?.objectVersion] as const)
        .filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number'),
    );
    return { ok: true, commandId: envelope.id, result: {
      ...applied.receipt,
      summary: workflowCommandSummary(envelope.command, envelope.args),
      draftVersion: applied.project.draftVersion,
      affectedNodeIds,
      affectedConnectionIds,
      objectVersions,
    } };
  };

  const execute = async (envelope: WorkflowCommandEnvelope): Promise<WorkflowCommandResult> => {
    const envelopeError = validateEnvelope(envelope);
    if (envelopeError) return envelopeError;
    const documentMutation = DOCUMENT_MUTATION_COMMANDS.has(envelope.command);
    const cacheKey = !documentMutation && !WORKFLOW_READ_COMMANDS.has(envelope.command)
      && envelope.idempotencyKey && `${envelope.source}:${envelope.idempotencyKey}`;
    if (cacheKey && idempotencyCache.has(cacheKey)) return idempotencyCache.get(cacheKey)!;
    const { command, args } = envelope;
    if (requiresWorkflowConfirmation(envelope) && !hasWorkflowHumanApproval(envelope)) {
      return {
        ok: true,
        commandId: envelope.id,
        confirmation: { required: true, code: 'CONFIRMATION_REQUIRED', summary: workflowCommandSummary(command, args) },
      };
    }

    try {
      const state = dependencies.getState();
      const projectId = command === 'workflow.apply'
        ? requiredString(args.projectId, 'projectId')
        : String(args.projectId || state.activeProjectId || '');
      const project = state.projects.find(item => item.id === projectId);
      let result: WorkflowCommandResult;

      if (command === 'workflow.project.list') {
        result = { ok: true, commandId: envelope.id, result: state.projects.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })) };
      } else if (command === 'workflow.project.create') {
        const id = dependencies.createProject(args.title === undefined ? undefined : requiredString(args.title, 'title'));
        const freshProject = dependencies.getState().projects.find(item => item.id === id);
        if (freshProject && envelope.source !== 'ui') {
          dependencies.updateProject(id, draftLogPatch(freshProject, envelope, true));
        }
        result = { ok: true, commandId: envelope.id, result: { projectId: id } };
      } else if (command === 'workflow.project.use') {
        if (!project) return error(envelope.id, 'NOT_FOUND', `Workflow 项目不存在：${projectId}`);
        dependencies.setActiveProject(projectId);
        if (envelope.source !== 'ui') dependencies.updateProject(projectId, draftLogPatch(project, envelope, true));
        result = { ok: true, commandId: envelope.id, result: { projectId } };
      } else if (command === 'workflow.project.delete') {
        if (!project) return error(envelope.id, 'NOT_FOUND', `Workflow 项目不存在：${projectId}`);
        dependencies.deleteProjects([projectId]);
        result = { ok: true, commandId: envelope.id, result: { projectId } };
      } else if (command === 'workflow.inspect') {
        if (!project) return error(envelope.id, 'NOT_FOUND', '当前没有可用的 Workflow 项目。');
        const summary = args.summary === true || args.view === 'summary' || args.mode === 'summary';
        const nodeId = typeof args.nodeId === 'string' ? args.nodeId.trim() : '';
        if (nodeId) {
          const scoped = inspectNode(project, nodeId);
          if (!scoped) return error(envelope.id, 'NOT_FOUND', `节点不存在：${nodeId}`);
          result = { ok: true, commandId: envelope.id, result: scoped };
        } else if (summary) {
          result = { ok: true, commandId: envelope.id, result: inspectSummary(project) };
        } else {
          // 制作圣经：结构化的锚点 / 镜头表 / 一致性问题，让 Agent 不必自己从节点里拼项目状态。
          result = { ok: true, commandId: envelope.id, result: { ...inspectProject(project), productionBible: buildProductionBible(project) } };
        }
      } else if (command === 'workflow.selection.get') {
        if (!project) return error(envelope.id, 'NOT_FOUND', '当前没有可用的 Workflow 项目。');
        const selectedNodeIds = project.selectedNodeIds.filter(nodeId => project.nodes.some(node => node.id === nodeId));
        result = {
          ok: true,
          commandId: envelope.id,
          result: {
            projectId: project.id,
            selectedNodeIds,
            nodes: project.nodes.filter(node => selectedNodeIds.includes(node.id)).map(redactNode),
            viewport: project.viewport,
            draftVersion: project.draftVersion || 1,
          },
        };
      } else if (command === 'workflow.nodes.search') {
        if (!project) return error(envelope.id, 'NOT_FOUND', '当前没有可用的 Workflow 项目。');
        result = { ok: true, commandId: envelope.id, result: { projectId: project.id, ...searchWorkflowNodes(project.nodes, nodeSearchQueryFromArgs(args)) } };
      } else if (command === 'workflow.models.list') {
        result = { ok: true, commandId: envelope.id, result: listWorkflowModels(args, dependencies.getUserApiKeys?.() || []) };
      } else if (!project) {
        return error(envelope.id, 'NOT_FOUND', '当前没有可用的 Workflow 项目。');
      } else if (command === 'workflow.node.run' || command === 'workflow.node.stop') {
        const nodeIds = command === 'workflow.node.run' ? workflowRunNodeIds(args) : [requiredString(args.nodeId || args.id, 'nodeId')];
        const missingNodeId = nodeIds.find(nodeId => !project.nodes.some(node => node.id === nodeId));
        if (missingNodeId) return error(envelope.id, 'NOT_FOUND', '节点不存在：' + missingNodeId);
        const executor = dependencies.getExecutor?.() || dependencies.executor;
        if (!executor || (command === 'workflow.node.stop' && !executor.stopNode)) {
          return error(envelope.id, 'RUNNER_UNAVAILABLE', command === 'workflow.node.run' ? 'Workflow 生成适配器尚未连接。' : 'Workflow 停止适配器尚未连接。');
        }
        const expectedRevision = args.expectedRevision === undefined ? undefined : finiteNumber(args.expectedRevision, 'expectedRevision');
        if (expectedRevision !== undefined && expectedRevision !== (project.draftVersion || 1)) {
          return error(envelope.id, 'REVISION_CONFLICT', 'Workflow 草稿版本已变化：期望 ' + expectedRevision + '，当前 ' + (project.draftVersion || 1) + '。');
        }
        const surface = envelope.source === 'agent' ? 'browser-agent' : envelope.source === 'operator' ? 'runtime' : envelope.source;
        const runCommandFor = (nodeId: string): WorkflowRunCommand => ({ projectId: project.id, nodeId, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
        if (command === 'workflow.node.stop' || nodeIds.length === 1) {
          const [nodeId] = nodeIds;
          let executionResult: WorkflowRunResult | undefined;
          try {
            if (command === 'workflow.node.run') executionResult = await executor.runNode(runCommandFor(nodeId), { surface, correlationId: envelope.id });
            else await executor.stopNode!(runCommandFor(nodeId), { surface, correlationId: envelope.id });
          } catch (cause) {
            const normalized = normalizeWorkflowExecutionError(cause);
            return error(envelope.id, normalized.code, normalized.message);
          }
          if (executionResult?.status === 'failed') {
            return error(envelope.id, executionResult.error?.code || 'RUN_FAILED', executionResult.error?.message || 'Workflow 生成失败，请重试。');
          }
          if (executionResult?.status === 'cancelled') {
            return error(envelope.id, 'RUN_CANCELLED', '生成已停止或被新的运行取代，未产生结果。');
          }
          const latestProject = dependencies.getState().projects.find(item => item.id === project.id) || project;
          dependencies.updateProject(project.id, draftLogPatch(latestProject, envelope, true, { nodeIds: [nodeId] }));
          result = { ok: true, commandId: envelope.id, result: {
            projectId: project.id,
            nodeId,
            ...(executionResult ? workflowRunPayload(executionResult) : {}),
          } };
        } else {
          // 批量：一次确认覆盖整批；各节点并行交给同一 WorkflowExecutor，逐节点报告结果，失败只影响自身。
          const runs = await Promise.all(nodeIds.map(async nodeId => {
            try {
              const executionResult = await executor.runNode(runCommandFor(nodeId), { surface, correlationId: envelope.id + ':' + nodeId });
              if (executionResult?.status === 'failed') {
                return { nodeId, ok: false, error: { code: executionResult.error?.code || 'RUN_FAILED', message: executionResult.error?.message || 'Workflow 生成失败，请重试。' } };
              }
              if (executionResult?.status === 'cancelled') {
                return { nodeId, ok: false, error: { code: 'RUN_CANCELLED', message: '生成已停止或被新的运行取代，未产生结果。' } };
              }
              return { nodeId, ok: true, ...(executionResult ? workflowRunPayload(executionResult) : {}) };
            } catch (cause) {
              const normalized = normalizeWorkflowExecutionError(cause);
              return { nodeId, ok: false, error: { code: normalized.code, message: normalized.message } };
            }
          }));
          const succeeded = runs.filter(run => run.ok).map(run => run.nodeId);
          if (!succeeded.length) {
            const first = runs.map(run => ('error' in run ? run.error : undefined)).find(Boolean);
            return error(envelope.id, first?.code || 'RUN_FAILED', '批量运行的 ' + runs.length + ' 个节点全部失败：' + (first?.message || ''));
          }
          const latestProject = dependencies.getState().projects.find(item => item.id === project.id) || project;
          dependencies.updateProject(project.id, draftLogPatch(latestProject, envelope, true, { nodeIds: succeeded }));
          result = { ok: true, commandId: envelope.id, result: { projectId: project.id, runs, failed: runs.length - succeeded.length } };
        }
      } else if (command === 'workflow.generate') {
        const mutationId = String(args.mutationId || envelope.idempotencyKey || '').trim() || 'generate-' + envelope.id;
        const expectedRevision = args.expectedRevision === undefined ? (project.draftVersion || 1) : finiteNumber(args.expectedRevision, 'expectedRevision');
        let plan: ReturnType<typeof planWorkflowGenerate>;
        try {
          plan = planWorkflowGenerate({
            nodes: project.nodes,
            connections: project.connections,
            args,
            mutationId,
            keys: dependencies.getUserApiKeys?.() || [],
            place: (node, upstreamIds) => autoPlaceWorkflowNode(project.nodes, node, upstreamIds),
          });
        } catch (cause) {
          if (!(cause instanceof WorkflowGenerateError)) throw cause;
          const compatible = Array.isArray(cause.details?.compatibleModels) ? cause.details.compatibleModels as Array<{ id: string; configured?: boolean }> : [];
          const hint = compatible.length ? ' 可用模型：' + compatible.slice(0, 8).map(item => item.id + (item.configured ? '' : '（未配置）')).join('、') : '';
          return { ok: false, commandId: envelope.id, error: { code: cause.code, message: cause.message + hint, ...(cause.details ? { details: cause.details } : {}) } };
        }
        const summary = {
          projectId: project.id,
          nodeId: plan.nodeId,
          created: plan.created,
          mode: plan.mode,
          prompt: plan.prompt,
          model: plan.model,
          references: plan.references,
          diagnostics: plan.diagnostics,
        };
        if (args.dryRun === true || args['dry-run'] === true) {
          result = { ok: true, commandId: envelope.id, result: { ...summary, dryRun: true, applied: false, draftVersion: project.draftVersion || 1, operationCount: plan.operations.length, willRun: args.run === true } };
          cache(cacheKey, result);
          return result;
        }
        const committed = commitDocument(envelope, project, tagWorkflowNodeOrigin(plan.operations, envelope.source), {
          mutationId,
          expectedRevision,
          intent: (plan.created ? '新建生成节点并写入提示词：' : '写入提示词：') + plan.nodeId,
        });
        if (!committed.ok) return committed;
        const draftVersion = (committed.result as { draftVersion?: number }).draftVersion;
        if (args.run !== true && args.run !== 'true') {
          result = { ok: true, commandId: envelope.id, result: { ...summary, draftVersion, ran: false } };
        } else {
          const executor = dependencies.getExecutor?.() || dependencies.executor;
          if (!executor) return error(envelope.id, 'RUNNER_UNAVAILABLE', '提示词已写入节点 ' + plan.nodeId + '；Workflow 生成适配器尚未连接，无法运行。');
          const surface = envelope.source === 'agent' ? 'browser-agent' : envelope.source === 'operator' ? 'runtime' : envelope.source;
          let executionResult: WorkflowRunResult;
          try {
            executionResult = await executor.runNode({ projectId: project.id, nodeId: plan.nodeId, promptIntent: plan.promptIntent }, { surface, correlationId: envelope.id });
          } catch (cause) {
            const normalized = normalizeWorkflowExecutionError(cause);
            return error(envelope.id, normalized.code, '提示词已写入节点 ' + plan.nodeId + '；运行失败：' + normalized.message);
          }
          if (executionResult.status === 'failed') {
            return error(envelope.id, executionResult.error?.code || 'RUN_FAILED', '提示词已写入节点 ' + plan.nodeId + '；运行失败：' + (executionResult.error?.message || 'Workflow 生成失败，请重试。'));
          }
          if (executionResult.status === 'cancelled') return error(envelope.id, 'RUN_CANCELLED', '提示词已写入节点 ' + plan.nodeId + '；生成已停止或被新的运行取代，未产生结果。');
          result = { ok: true, commandId: envelope.id, result: { ...summary, draftVersion, ran: true, run: workflowRunPayload(executionResult) } };
        }
      } else if (command === 'workflow.note.write') {
        const content = typeof args.text === 'string' ? args.text : typeof args.content === 'string' ? args.content : '';
        if (!content.trim()) throw new Error('text 不能为空');
        const mutationId = String(args.mutationId || envelope.idempotencyKey || '').trim() || 'note-' + envelope.id;
        const expectedRevision = args.expectedRevision === undefined ? (project.draftVersion || 1) : finiteNumber(args.expectedRevision, 'expectedRevision');
        const noteId = typeof args.noteId === 'string' ? args.noteId.trim() : '';
        let operation: WorkflowDocumentOperation;
        let targetNoteId: string;
        if (noteId) {
          const existing = project.nodes.find(node => node.id === noteId);
          if (!existing) return error(envelope.id, 'NOT_FOUND', '备注不存在：' + noteId);
          if (existing.type !== 'text') return error(envelope.id, 'BAD_REQUEST', '节点 ' + noteId + ' 不是备注；生成节点的提示词请用 flovart_generate 写入。');
          operation = { type: 'update_node', id: noteId, metadata: { content }, ...(typeof args.title === 'string' && args.title.trim() ? { patch: { title: args.title.trim() } } : {}) };
          targetNoteId = noteId;
        } else {
          targetNoteId = stableShortId('note-', mutationId);
          const node = createWorkflowNode(targetNoteId, 'text', { x: 0, y: 0 }, { content, origin: 'agent' });
          node.title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '备注';
          const anchorId = typeof args.attachToNodeId === 'string' ? args.attachToNodeId.trim() : '';
          const anchor = anchorId ? project.nodes.find(item => item.id === anchorId) : undefined;
          if (anchorId && !anchor) return error(envelope.id, 'NOT_FOUND', '节点不存在：' + anchorId);
          const gap = 48;
          const placement = String(args.placement || 'right');
          if (!['right', 'below', 'above', 'left'].includes(placement)) throw new Error('placement 只能是 right / below / above / left');
          node.position = anchor
            ? placement === 'below' ? { x: anchor.position.x, y: anchor.position.y + anchor.height + gap }
              : placement === 'above' ? { x: anchor.position.x, y: anchor.position.y - node.height - gap }
              : placement === 'left' ? { x: anchor.position.x - node.width - gap, y: anchor.position.y }
              : { x: anchor.position.x + anchor.width + gap, y: anchor.position.y }
            : autoPlaceWorkflowNode(project.nodes, node);
          // 备注永远不连线：不进生成链，也不当参考
          operation = { type: 'add_node', node };
        }
        const committed = commitDocument(envelope, project, [operation], { mutationId, expectedRevision, intent: noteId ? '更新备注：' + noteId : '写备注' });
        if (!committed.ok) return committed;
        result = { ok: true, commandId: envelope.id, result: { projectId: project.id, noteId: targetNoteId, created: !noteId, draftVersion: (committed.result as { draftVersion?: number }).draftVersion } };
      } else if (command === 'workflow.media.import') {
        const url = typeof args.url === 'string' ? args.url.trim() : '';
        const assetId = typeof args.assetId === 'string' ? args.assetId.trim() : '';
        if (Boolean(url) === Boolean(assetId)) throw new Error('url 与 assetId 必须二选一');
        const mutationId = String(args.mutationId || envelope.idempotencyKey || '').trim() || 'import-' + envelope.id;
        const expectedRevision = args.expectedRevision === undefined ? (project.draftVersion || 1) : finiteNumber(args.expectedRevision, 'expectedRevision');
        const attachToNodeId = typeof args.attachToNodeId === 'string' ? args.attachToNodeId.trim() : '';
        const attachTarget = attachToNodeId ? project.nodes.find(node => node.id === attachToNodeId) : undefined;
        if (attachToNodeId && !attachTarget) return error(envelope.id, 'NOT_FOUND', '节点不存在：' + attachToNodeId);
        if (attachTarget && !generateModeOf(attachTarget)) {
          return error(envelope.id, attachTarget.type === 'text' ? 'NOTE_IS_ANNOTATION' : 'BAD_REQUEST', '只能把素材接到图片/视频生成节点上作参考：' + attachToNodeId);
        }
        const importedId = stableShortId('media-', mutationId);
        let imported: WorkflowImportedMedia;
        if (assetId) {
          const asset = dependencies.lookupAsset?.(assetId);
          if (!asset) return error(envelope.id, 'NOT_FOUND', '素材库里没有这个素材：' + assetId);
          const type = asset.mimeType.startsWith('video/') ? 'video' : asset.mimeType.startsWith('audio/') ? 'audio' : 'image';
          const spec = createWorkflowNode(importedId, type, { x: 0, y: 0 });
          imported = {
            type,
            metadata: { sourceType: 'assetLibrary', assetId, href: 'asset-library:' + assetId, name: asset.name || '素材引用', mimeType: asset.mimeType, naturalWidth: asset.width, naturalHeight: asset.height, status: 'success' },
            width: spec.width,
            height: spec.height,
          };
        } else {
          if (!/^https?:\/\//i.test(url)) throw new Error('url 只支持 http(s) 地址');
          // 同一 mutationId 重放：节点已在画布上就不再下载
          if (project.nodes.some(node => node.id === importedId)) {
            result = { ok: true, commandId: envelope.id, result: { projectId: project.id, nodeId: importedId, replayed: true, draftVersion: project.draftVersion || 1 } };
            cache(cacheKey, result);
            return result;
          }
          try {
            imported = await (dependencies.importMediaUrl || browserImportMediaUrl)(url);
          } catch (cause) {
            return error(envelope.id, 'IMPORT_FAILED', '素材导入失败：' + displayError(cause));
          }
        }
        const node = { ...createWorkflowNode(importedId, imported.type, { x: 0, y: 0 }, imported.metadata), width: imported.width, height: imported.height, freeResize: false };
        if (typeof args.title === 'string' && args.title.trim()) node.title = args.title.trim();
        node.position = attachTarget
          ? { x: attachTarget.position.x + attachTarget.width / 2 - node.width / 2, y: attachTarget.position.y - node.height - 100 }
          : autoPlaceWorkflowNode(project.nodes, node);
        const operations: WorkflowDocumentOperation[] = [{ type: 'add_node', node }];
        let mentioned = false;
        if (attachTarget) {
          const connectionId = 'conn-' + importedId;
          operations.push({ type: 'connect_nodes', id: connectionId, fromNodeId: importedId, toNodeId: attachTarget.id });
          // 默认同时在目标 Prompt Bar 末尾加 @chip：有 mention 时未被 mention 的上游不会参与生成
          if (args.mention !== false) {
            const nodes = [...project.nodes, node];
            const connections = [...project.connections, { id: connectionId, fromNodeId: importedId, toNodeId: attachTarget.id }];
            const previousIds = promptDocumentMentions(attachTarget.metadata.richTextDocument).map(item => item.id);
            const built = buildWorkflowPromptDocument({
              text: attachTarget.metadata.prompt || '',
              targetNodeId: attachTarget.id,
              nodes,
              connections,
              ensureMentionIds: [...previousIds, importedId],
            });
            operations.push({ type: 'update_node', id: attachTarget.id, metadata: { prompt: built.prompt, richTextDocument: built.richTextDocument } });
            mentioned = built.mentionIds.includes(importedId);
          }
        }
        const committed = commitDocument(envelope, project, tagWorkflowNodeOrigin(operations, envelope.source), { mutationId, expectedRevision, intent: '导入素材：' + (node.title || importedId) });
        if (!committed.ok) {
          await imported.discard?.();
          return committed;
        }
        imported.commit?.();
        result = { ok: true, commandId: envelope.id, result: {
          projectId: project.id,
          nodeId: importedId,
          type: imported.type,
          ...(attachTarget ? { attachedTo: attachTarget.id, mentioned } : {}),
          draftVersion: (committed.result as { draftVersion?: number }).draftVersion,
        } };
      } else if (command === 'workflow.node.tool') {
        const nodeId = requiredString(args.nodeId || args.id, 'nodeId');
        const tool = requiredString(args.tool, 'tool');
        if (!project.nodes.some(node => node.id === nodeId)) return error(envelope.id, 'NOT_FOUND', `节点不存在：${nodeId}`);
        if (!isWorkflowNodeTool(tool)) return error(envelope.id, 'BAD_REQUEST', `不支持的画布工具：${tool}`);
        const runner = dependencies.nodeToolRunner;
        if (!runner) return error(envelope.id, 'RUNNER_UNAVAILABLE', 'Workflow 画布工具适配器尚未连接。');
        const toolArgs: Record<string, unknown> = { ...args };
        delete toolArgs.projectId;
        delete toolArgs.nodeId;
        delete toolArgs.id;
        delete toolArgs.tool;
        delete toolArgs.confirmed;
        const capability = getWorkflowOperationCapabilityByNodeTool(tool);
        const normalizedArgs = capability ? parseWorkflowOperationNodeToolArguments(capability.id, toolArgs) : toolArgs;
        const outcome = await runner(project.id, nodeId, tool, normalizedArgs);
        const committed = Boolean(outcome && typeof outcome === 'object' && (outcome as { status?: string }).status === 'committed');
        // 把新产出的节点 ID 交回调用方（Agent 据此继续连线或运行），不用再整图 inspect 一次。
        const before = new Set(project.nodes.map(node => node.id));
        const after = dependencies.getState().projects.find(item => item.id === project.id)?.nodes || [];
        const outputNodeIds = after.filter(node => !before.has(node.id) && node.type !== 'operation').map(node => node.id);
        dependencies.updateProject(project.id, draftLogPatch(project, envelope, true, { nodeIds: [nodeId] }));
        result = { ok: true, commandId: envelope.id, result: { projectId: project.id, nodeId, tool, committed, outputNodeIds } };
      } else {
        const requestedNodeId = String(args.nodeId || args.id || '');
        if (['workflow.node.update', 'workflow.node.delete', 'workflow.node.move', 'workflow.node.resize'].includes(command)
          && !project.nodes.some(node => node.id === requestedNodeId)) return error(envelope.id, 'NOT_FOUND', `节点不存在：${requestedNodeId}`);
        if (command === 'workflow.disconnect' && !project.connections.some(connection => connection.id === String(args.connectionId || args.id || ''))) {
          return error(envelope.id, 'NOT_FOUND', '指定的连接不存在。');
        }
        const mutationId = command === 'workflow.apply'
          ? requiredString(args.mutationId, 'mutationId')
          : requiredString(args.mutationId || envelope.idempotencyKey || args.changeSetId || envelope.id, 'mutationId');
        if (command === 'workflow.apply' && args.expectedRevision === undefined) throw new Error('expectedRevision 不能为空');
        const expectedRevision = args.expectedRevision === undefined ? (project.draftVersion || 1) : finiteNumber(args.expectedRevision, 'expectedRevision');
        let operation: WorkflowDocumentOperation | undefined;
        let operations: WorkflowDocumentOperation[] | undefined;
        if (command === 'workflow.apply') {
          operations = expandReferenceReorders(project.connections, autoPlaceDocumentOperations(project.nodes, documentOperationsArg(args.operations || args.ops)));
        } else if (command === 'workflow.node.create') {
          const node = validatedNode(args, 'node-' + mutationId);
          if (args.x === undefined && args.y === undefined) node.position = autoPlaceWorkflowNode(project.nodes, node);
          operation = { type: 'add_node', node };
        } else if (command === 'workflow.node.create-connected') {
          const fromNodeId = requiredString(args.fromNodeId || args.from, 'fromNodeId');
          const node = validatedNode(args, 'node-' + mutationId);
          if (args.x === undefined && args.y === undefined) node.position = autoPlaceWorkflowNode(project.nodes, node, [fromNodeId]);
          operation = { type: 'create_connected_node', fromNodeId, node };
        } else if (command === 'workflow.node.update') {
          const patch = recordArg(args.patch || args.updates, 'patch');
          if ('id' in patch) throw new Error('patch 不能修改节点 id');
          operation = { type: 'update_node', id: requiredString(requestedNodeId, 'nodeId'), patch: patch as never };
        } else if (command === 'workflow.node.delete') {
          operation = { type: 'delete_nodes', ids: [requiredString(requestedNodeId, 'nodeId')] };
        } else if (command === 'workflow.node.move') {
          operation = { type: 'move_nodes', positions: [{ id: requiredString(requestedNodeId, 'nodeId'), position: { x: finiteNumber(args.x, 'x'), y: finiteNumber(args.y, 'y') } }] };
        } else if (command === 'workflow.node.resize') {
          operation = { type: 'update_node', id: requiredString(requestedNodeId, 'nodeId'), patch: { width: positiveNumber(args.width, 'width'), height: positiveNumber(args.height, 'height') } };
        } else if (command === 'workflow.connect') {
          operation = { type: 'connect_nodes', id: args.id ? requiredString(args.id, 'id') : undefined, fromNodeId: requiredString(args.fromNodeId || args.from, 'fromNodeId'), toNodeId: requiredString(args.toNodeId || args.to, 'toNodeId') };
        } else if (command === 'workflow.disconnect') {
          operation = { type: 'delete_connections', ids: [requiredString(args.connectionId || args.id, 'connectionId')] };
        } else if (command === 'workflow.select') {
          if (!Array.isArray(args.ids) || args.ids.some(id => typeof id !== 'string')) throw new Error('ids 必须是字符串数组');
          const viewed = applyWorkflowViewOperations(project, [{ type: 'select_nodes', ids: args.ids.map(String) }]);
          if (viewed.ok === false) return error(envelope.id, viewed.error.code, viewed.error.message);
          dependencies.updateProject(project.id, { selectedNodeIds: viewed.project.selectedNodeIds, viewport: viewed.project.viewport });
          result = { ok: true, commandId: envelope.id, result: { projectId: project.id, draftVersion: project.draftVersion || 1 } };
          cache(cacheKey, result);
          return result;
        } else if (command === 'workflow.viewport.set') {
          const k = positiveNumber(args.k ?? args.zoom, 'k');
          const viewed = applyWorkflowViewOperations(project, [{ type: 'set_viewport', viewport: { x: finiteNumber(args.x, 'x'), y: finiteNumber(args.y, 'y'), k } }]);
          if (viewed.ok === false) return error(envelope.id, viewed.error.code, viewed.error.message);
          dependencies.updateProject(project.id, { selectedNodeIds: viewed.project.selectedNodeIds, viewport: viewed.project.viewport });
          result = { ok: true, commandId: envelope.id, result: { projectId: project.id, draftVersion: project.draftVersion || 1 } };
          cache(cacheKey, result);
          return result;
        } else if (command === 'workflow.focus.nodes') {
          const nodeIds = workflowFocusNodeIds(args);
          const missing = nodeIds.find(nodeId => !project.nodes.some(node => node.id === nodeId));
          if (missing) return error(envelope.id, 'NOT_FOUND', `节点不存在：${missing}`);
          const targets = project.nodes.filter(node => nodeIds.includes(node.id));
          const minX = Math.min(...targets.map(node => node.position.x));
          const minY = Math.min(...targets.map(node => node.position.y));
          const maxX = Math.max(...targets.map(node => node.position.x + node.width));
          const maxY = Math.max(...targets.map(node => node.position.y + node.height));
          const width = Math.max(240, finiteNumber(args.width, 'width', 1200));
          const height = Math.max(240, finiteNumber(args.height, 'height', 800));
          const padding = Math.max(0, finiteNumber(args.padding, 'padding', 80));
          const scale = Math.min(1, (width - padding * 2) / Math.max(1, maxX - minX), (height - padding * 2) / Math.max(1, maxY - minY));
          const k = Math.min(1, Math.max(.1, scale));
          const viewport = {
            x: width / 2 - ((minX + maxX) / 2) * k,
            y: height / 2 - ((minY + maxY) / 2) * k,
            k,
          };
          dependencies.updateProject(project.id, { viewport });
          result = { ok: true, commandId: envelope.id, result: { projectId: project.id, draftVersion: project.draftVersion || 1, nodeIds, viewport } };
          cache(cacheKey, result);
          return result;
        } else {
          return error(envelope.id, 'UNKNOWN_COMMAND', `未知 Workflow 命令：${command}`);
        }
        if (agentTextNodeViolation(envelope.source, operations || [operation!])) return error(envelope.id, 'NOTE_IS_ANNOTATION', NOTE_IS_ANNOTATION_MESSAGE);
        operations = tagWorkflowNodeOrigin(operations || [operation!], envelope.source);
        if (command === 'workflow.apply' && (args.dryRun === true || args['dry-run'] === true)) {
          const preview = applyWorkflowOps({
            projectId: project.id,
            title: project.title,
            nodes: project.nodes,
            connections: project.connections,
            selectedNodeIds: project.selectedNodeIds,
            viewport: project.viewport,
          }, operations);
          if (preview.rejections.length) {
            return error(envelope.id, 'BAD_REQUEST', '预演失败：' + preview.rejections.map(item => item.reason).join('；'));
          }
          const beforeNodeIds = new Set(project.nodes.map(node => node.id));
          const afterNodeIds = new Set(preview.snapshot.nodes.map(node => node.id));
          const beforeConnectionIds = new Set(project.connections.map(connection => connection.id));
          const afterConnectionIds = new Set(preview.snapshot.connections.map(connection => connection.id));
          result = {
            ok: true,
            commandId: envelope.id,
            result: {
              dryRun: true,
              applied: false,
              draftVersion: project.draftVersion || 1,
              operationCount: operations.length,
              summary: workflowCommandSummary(command, args),
              nodeIds: [...afterNodeIds].filter(id => !beforeNodeIds.has(id)),
              removedNodeIds: [...beforeNodeIds].filter(id => !afterNodeIds.has(id)),
              connectionIds: [...afterConnectionIds].filter(id => !beforeConnectionIds.has(id)),
              removedConnectionIds: [...beforeConnectionIds].filter(id => !afterConnectionIds.has(id)),
            },
          };
          cache(cacheKey, result);
          return result;
        }
        const expectedObjectVersions = Object.fromEntries(Object.entries(recordArg(args.expectedObjectVersions, 'expectedObjectVersions')).map(([id, value]) => [id, positiveNumber(value, `expectedObjectVersions.${id}`)]));
        const intent = typeof args.intent === 'string' && args.intent.trim()
          ? args.intent.trim()
          : createWorkflowDraftLogEntry({
            source: envelope.source,
            command,
            args,
            ok: true,
          }).summary;
        result = commitDocument(envelope, project, operations, {
          mutationId,
          expectedRevision,
          intent,
          clientId: typeof args.clientId === 'string' ? args.clientId : undefined,
          expectedObjectVersions,
        });
        if (!result.ok) return result;
      }

      cache(cacheKey, result);
      return result;
    } catch (cause) {
      return error(envelope.id, 'BAD_REQUEST', displayError(cause));
    }
  };
  const inFlightRuns = new Map<string, Promise<WorkflowCommandResult>>();
  return (envelope: WorkflowCommandEnvelope): Promise<WorkflowCommandResult> => {
    // 同一 idempotencyKey 的并发重复 run（Agent 重试、双击）共享一次执行；结果缓存只在完成后写入，挡不住并发。
    const key = (envelope?.command === 'workflow.node.run' || envelope?.command === 'workflow.generate') && envelope.idempotencyKey ? envelope.source + ':' + envelope.idempotencyKey : undefined;
    if (!key) return execute(envelope);
    const pending = inFlightRuns.get(key);
    if (pending) return pending;
    const running = execute(envelope).finally(() => inFlightRuns.delete(key));
    inFlightRuns.set(key, running);
    return running;
  };
}

let browserNodeToolRunner: WorkflowDispatcherDependencies['nodeToolRunner'];
let browserUserApiKeys: (() => UserApiKey[]) | undefined;
let browserAssetLookup: WorkflowDispatcherDependencies['lookupAsset'];

/** App 注入当前 BYOK Key（只在浏览器内存里读取，不进入命令结果）。 */
export function setWorkflowUserApiKeysProvider(provider?: () => UserApiKey[]) {
  browserUserApiKeys = provider;
}

export function setWorkflowAssetLookup(lookup?: WorkflowDispatcherDependencies['lookupAsset']) {
  browserAssetLookup = lookup;
}
let browserWorkflowExecutor: WorkflowExecutor | undefined;

export function setWorkflowExecutor(executor?: WorkflowExecutor) {
  browserWorkflowExecutor = executor;
}

export function setWorkflowNodeToolRunner(runner?: WorkflowDispatcherDependencies['nodeToolRunner']) {
  browserNodeToolRunner = runner;
}

const browserDependencies: WorkflowDispatcherDependencies = {
  getState: () => useWorkflowStore.getState(),
  createProject: title => useWorkflowStore.getState().createProject(title),
  setActiveProject: id => useWorkflowStore.getState().setActiveProject(id),
  deleteProjects: ids => useWorkflowStore.getState().deleteProjects(ids),
  updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
  getExecutor: () => browserWorkflowExecutor,
  nodeToolRunner: (projectId, nodeId, tool, args) => {
    if (!browserNodeToolRunner) throw new Error('Workflow 画布工具适配器尚未连接。');
    return browserNodeToolRunner(projectId, nodeId, tool, args);
  },
  persistenceError: getWorkflowPersistenceError,
  getUserApiKeys: () => browserUserApiKeys?.() || [],
  lookupAsset: assetId => browserAssetLookup?.(assetId),
};

export const dispatchWorkflowCommand = createWorkflowDispatcher(browserDependencies);
