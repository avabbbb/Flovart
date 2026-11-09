import { nanoid } from 'nanoid';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalize } from 'json-canonicalize';

import { applyWorkflowOps } from './ops';
import type {
  WorkflowConnection,
  WorkflowDraftActor,
  WorkflowDraftChangeSet,
  WorkflowDocumentOperation,
  WorkflowMutationEnvelope,
  WorkflowMutationReceipt,
  WorkflowNode,
  WorkflowProject,
  WorkflowSnapshot,
  WorkflowViewOperation,
} from './types';

const CHANGE_SET_LIMIT = 100;
const MUTATION_RECEIPT_LIMIT = 256;
const DOCUMENT_OPERATION_TYPES = new Set<WorkflowDocumentOperation['type']>([
  'add_node', 'create_connected_node', 'update_node', 'delete_nodes', 'delete_connections', 'connect_nodes',
  'move_nodes', 'reorder_nodes', 'group_nodes', 'ungroup_nodes', 'set_batch_primary',
]);

export interface WorkflowDraftChangeSetRequest {
  id?: string;
  actor: WorkflowDraftActor;
  intent: string;
  ops: WorkflowDocumentOperation[];
  baseDraftVersion?: number;
  expectedObjectVersions?: Record<string, number>;
}

export interface WorkflowDraftFrame {
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

export type WorkflowDraftAuthorityResult = {
  ok: true;
  project: WorkflowProject;
  changeSet: WorkflowDraftChangeSet;
} | {
  ok: false;
  error: { code: 'PRECONDITION_FAILED' | 'BAD_REQUEST' | 'NOT_FOUND'; message: string; objectId?: string; currentVersion?: number };
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const snapshot = (project: WorkflowProject): WorkflowSnapshot => ({
  projectId: project.id,
  title: project.title,
  nodes: project.nodes,
  connections: project.connections,
  selectedNodeIds: project.selectedNodeIds,
  viewport: project.viewport,
});

function currentObject(project: WorkflowProject, id: string) {
  return project.nodes.find(node => node.id === id) || project.connections.find(connection => connection.id === id);
}

function versionNode(before: WorkflowNode | undefined, after: WorkflowNode): WorkflowNode {
  if (!before) return { ...after, objectVersion: after.objectVersion || 1 };
  if (same(before, after)) return after;
  return { ...after, objectVersion: Math.max(after.objectVersion || 0, (before.objectVersion || 1) + 1) };
}

function versionConnection(before: WorkflowConnection | undefined, after: WorkflowConnection): WorkflowConnection {
  if (!before) return { ...after, objectVersion: after.objectVersion || 1 };
  if (same(before, after)) return after;
  return { ...after, objectVersion: Math.max(after.objectVersion || 0, (before.objectVersion || 1) + 1) };
}

function changes<T extends { id: string }>(before: T[], after: T[]) {
  const beforeById = new Map(before.map(item => [item.id, item]));
  const afterById = new Map(after.map(item => [item.id, item]));
  return [...new Set([...beforeById.keys(), ...afterById.keys()])]
    .filter(id => !same(beforeById.get(id), afterById.get(id)))
    .map(id => ({ id, before: beforeById.get(id), after: afterById.get(id) }));
}

function mergeChangeEntries<T extends { id: string; before?: unknown; after?: unknown }>(existing: T[], incoming: T[]): T[] {
  const merged = new Map(existing.map(entry => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = merged.get(entry.id);
    merged.set(entry.id, previous
      ? { ...entry, before: previous.before }
      : entry);
  }
  return [...merged.values()];
}

function appendChangeSet(
  project: WorkflowProject,
  before: WorkflowDraftFrame,
  after: WorkflowDraftFrame,
  request: Pick<WorkflowDraftChangeSetRequest, 'id' | 'actor' | 'intent'>,
) {
  const nodes = after.nodes.map(node => versionNode(before.nodes.find(item => item.id === node.id), node));
  const connections = after.connections.map(connection => (
    versionConnection(before.connections.find(item => item.id === connection.id), connection)
  ));
  const nodeChanges = changes(before.nodes, nodes);
  const connectionChanges = changes(before.connections, connections);
  const nodeOrderBefore = before.nodes.map(node => node.id);
  const nodeOrderAfter = nodes.map(node => node.id);
  const orderChanged = !same(nodeOrderBefore, nodeOrderAfter);
  if (!nodeChanges.length && !connectionChanges.length && !orderChanged) return null;
  const baseDraftVersion = project.draftVersion || 1;
  const resultDraftVersion = baseDraftVersion + 1;
  const last = project.draftChangeSets?.at(-1);
  const mergeable = Boolean(last && last.id === request.id && last.status === 'completed' && last.actor === request.actor);
  if (mergeable) {
    const changeSet: WorkflowDraftChangeSet = {
      ...last!,
      intent: last!.intent,
      status: 'completed',
      resultDraftVersion,
      nodeChanges: mergeChangeEntries(last!.nodeChanges, nodeChanges),
      connectionChanges: mergeChangeEntries(last!.connectionChanges, connectionChanges),
      nodeOrderBefore: last!.nodeOrderBefore || nodeOrderBefore,
      nodeOrderAfter,
    };
    return {
      project: {
        ...project,
        nodes,
        connections,
        draftVersion: resultDraftVersion,
        draftChangeSets: [...(project.draftChangeSets || []).slice(0, -1), changeSet],
        draftRedoStack: [],
      },
      changeSet,
    };
  }
  const changeSet: WorkflowDraftChangeSet = {
    id: request.id || nanoid(),
    at: new Date().toISOString(),
    actor: request.actor,
    intent: request.intent,
    status: 'completed',
    baseDraftVersion,
    resultDraftVersion,
    nodeChanges,
    connectionChanges,
    ...(orderChanged ? { nodeOrderBefore, nodeOrderAfter } : {}),
  };
  return {
    project: {
      ...project,
      nodes,
      connections,
      draftVersion: resultDraftVersion,
      draftChangeSets: [...(project.draftChangeSets || []), changeSet].slice(-CHANGE_SET_LIMIT),
      draftRedoStack: [],
    },
    changeSet,
  };
}

export function applyWorkflowDraftChangeSet(
  project: WorkflowProject,
  request: WorkflowDraftChangeSetRequest,
): WorkflowDraftAuthorityResult {
  for (const [objectId, expectedVersion] of Object.entries(request.expectedObjectVersions || {})) {
    const object = currentObject(project, objectId);
    const currentVersion = object?.objectVersion || 0;
    if (!object || currentVersion !== expectedVersion) {
      return {
        ok: false,
        error: {
          code: 'PRECONDITION_FAILED',
          message: `对象 ${objectId} 已被修改，请重新读取后再操作`,
          objectId,
          currentVersion,
        },
      };
    }
  }

  const applied = applyWorkflowOps(snapshot(project), request.ops);
  if (applied.rejections.length) {
    return {
      ok: false,
      error: { code: 'BAD_REQUEST', message: applied.rejections.map(item => item.reason).join('；') },
    };
  }
  const recorded = appendChangeSet(project, { nodes: project.nodes, connections: project.connections }, {
    nodes: applied.snapshot.nodes,
    connections: applied.snapshot.connections,
  }, request);
  if (!recorded) return { ok: false, error: { code: 'BAD_REQUEST', message: '该操作没有修改 Workflow Draft：写入内容与当前节点完全一致' } };
  return {
    ok: true,
    project: {
      ...recorded.project,
      selectedNodeIds: applied.snapshot.selectedNodeIds,
      viewport: applied.snapshot.viewport,
    },
    changeSet: recorded.changeSet,
  };
}

export type WorkflowMutationResult = {
  ok: true;
  project: WorkflowProject;
  changeSet: WorkflowDraftChangeSet;
  receipt: WorkflowMutationReceipt;
} | {
  ok: false;
  error: {
    code: 'BAD_REQUEST' | 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'REVISION_CONFLICT' | 'IDEMPOTENCY_KEY_REUSE';
    message: string;
    expectedRevision?: number;
    actualRevision?: number;
    objectId?: string;
    currentVersion?: number;
  };
};

const mutationHash = (envelope: WorkflowMutationEnvelope) => bytesToHex(sha256(utf8ToBytes(canonicalize({
  clientId: envelope.clientId,
  projectId: envelope.projectId,
  expectedRevision: envelope.expectedRevision,
  mutationId: envelope.mutationId,
  source: envelope.source,
  intent: envelope.intent,
  ops: envelope.ops,
  expectedObjectVersions: envelope.expectedObjectVersions,
}))));

const mutationActor = (source: WorkflowMutationEnvelope['source']): WorkflowDraftActor => (
  source === 'promptbar' ? 'ui' : source === 'dsh' ? 'operator' : source
);

export function applyWorkflowMutation(project: WorkflowProject, envelope: WorkflowMutationEnvelope): WorkflowMutationResult {
  if (envelope.projectId !== project.id) {
    return { ok: false, error: { code: 'NOT_FOUND', message: `Workflow 项目不存在：${envelope.projectId}` } };
  }
  if (!envelope.mutationId.trim()) return { ok: false, error: { code: 'BAD_REQUEST', message: 'mutationId 不能为空' } };
  if (!Number.isInteger(envelope.expectedRevision) || envelope.expectedRevision < 0) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'expectedRevision 必须是非负整数' } };
  }
  if (!Array.isArray(envelope.ops) || envelope.ops.length === 0) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: 'ops 至少包含一个 Document Operation' } };
  }
  const invalidOperation = envelope.ops.find(op => !op || !DOCUMENT_OPERATION_TYPES.has(op.type));
  if (invalidOperation) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: `${String(invalidOperation?.type || invalidOperation)} 不属于 Document Mutation` } };
  }
  const requestHash = mutationHash(envelope);
  const existing = (project.workflowMutationReceipts || []).find(receipt => receipt.mutationId === envelope.mutationId);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return { ok: false, error: { code: 'IDEMPOTENCY_KEY_REUSE', message: `mutationId 已用于不同载荷：${envelope.mutationId}` } };
    }
    const changeSet = project.draftChangeSets?.find(item => item.id === existing.changeSetId);
    if (!changeSet) return { ok: false, error: { code: 'BAD_REQUEST', message: `Mutation Receipt 缺少 ChangeSet：${existing.changeSetId}` } };
    return { ok: true, project, changeSet, receipt: { ...existing, replayed: true } };
  }
  const currentRevision = project.draftVersion || 1;
  if (envelope.expectedRevision !== currentRevision) {
    return {
      ok: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: `Workflow 草稿版本已变化：期望 ${envelope.expectedRevision}，当前 ${currentRevision}。`,
        expectedRevision: envelope.expectedRevision,
        actualRevision: currentRevision,
      },
    };
  }
  const applied = applyWorkflowDraftChangeSet(project, {
    id: envelope.mutationId,
    actor: mutationActor(envelope.source),
    intent: envelope.intent || '编辑 Workflow',
    ops: envelope.ops,
    baseDraftVersion: currentRevision,
    expectedObjectVersions: envelope.expectedObjectVersions,
  });
  if (applied.ok === false) return applied;
  const receipt: WorkflowMutationReceipt = {
    mutationId: envelope.mutationId,
    projectId: project.id,
    requestHash,
    previousRevision: currentRevision,
    revision: applied.project.draftVersion || currentRevision + 1,
    applied: true,
    replayed: false,
    operationResults: envelope.ops.map((op, index) => ({ index, type: op.type, status: 'applied' })),
    changeSetId: applied.changeSet.id,
    createdAt: applied.changeSet.at,
  };
  return {
    ok: true,
    changeSet: applied.changeSet,
    receipt,
    project: {
      ...applied.project,
      workflowMutationReceipts: [...(project.workflowMutationReceipts || []), receipt].slice(-MUTATION_RECEIPT_LIMIT),
    },
  };
}

export type WorkflowViewOperationResult = { ok: true; project: WorkflowProject } | {
  ok: false;
  error: { code: 'BAD_REQUEST'; message: string };
};

export function applyWorkflowViewOperations(project: WorkflowProject, ops: WorkflowViewOperation[]): WorkflowViewOperationResult {
  const applied = applyWorkflowOps(snapshot(project), ops);
  if (applied.rejections.length) {
    return { ok: false, error: { code: 'BAD_REQUEST', message: applied.rejections.map(item => item.reason).join('；') } };
  }
  return {
    ok: true,
    project: { ...project, selectedNodeIds: applied.snapshot.selectedNodeIds, viewport: applied.snapshot.viewport },
  };
}

export function workflowDocumentOperationsFromFrames(
  before: WorkflowDraftFrame,
  after: WorkflowDraftFrame,
): WorkflowDocumentOperation[] {
  const beforeNodes = new Map(before.nodes.map(node => [node.id, node]));
  const afterNodes = new Map(after.nodes.map(node => [node.id, node]));
  const beforeConnections = new Map(before.connections.map(connection => [connection.id, connection]));
  const afterConnections = new Map(after.connections.map(connection => [connection.id, connection]));
  const changedConnectionIds = before.connections
    .filter(connection => afterConnections.has(connection.id) && !same(connection, afterConnections.get(connection.id)))
    .map(connection => connection.id);
  const deletedConnectionIds = before.connections
    .filter(connection => !afterConnections.has(connection.id))
    .map(connection => connection.id);
  const deletedNodeIds = before.nodes.filter(node => !afterNodes.has(node.id)).map(node => node.id);
  const operations: WorkflowDocumentOperation[] = [];
  const removedConnectionIds = [...new Set([...deletedConnectionIds, ...changedConnectionIds])];
  if (removedConnectionIds.length) operations.push({ type: 'delete_connections', ids: removedConnectionIds });
  if (deletedNodeIds.length) operations.push({ type: 'delete_nodes', ids: deletedNodeIds });
  after.nodes.filter(node => !beforeNodes.has(node.id)).forEach(node => operations.push({ type: 'add_node', node }));
  after.nodes.filter(node => beforeNodes.has(node.id) && !same(beforeNodes.get(node.id), node)).forEach(node => {
    const { id, ...patch } = node;
    operations.push({ type: 'update_node', id, patch, replaceMetadata: true });
  });
  after.connections
    .filter(connection => !beforeConnections.has(connection.id) || changedConnectionIds.includes(connection.id))
    .forEach(connection => operations.push({ type: 'connect_nodes', ...connection }));
  const beforeOrder = before.nodes.map(node => node.id).filter(id => afterNodes.has(id));
  const afterOrder = after.nodes.map(node => node.id);
  if (!same(beforeOrder, afterOrder)) operations.push({ type: 'reorder_nodes', ids: afterOrder });
  return operations;
}

export function recordWorkflowDraftSnapshotChange(
  project: WorkflowProject,
  before: WorkflowDraftFrame,
  after: WorkflowDraftFrame,
  request: Pick<WorkflowDraftChangeSetRequest, 'id' | 'actor' | 'intent'>,
): WorkflowDraftAuthorityResult {
  return applyWorkflowDraftChangeSet(project, {
    ...request,
    ops: workflowDocumentOperationsFromFrames(before, after),
  });
}

function restoredVersion(
  current: { objectVersion?: number } | undefined,
  before: { objectVersion?: number },
  after?: { objectVersion?: number },
) {
  return Math.max(current?.objectVersion || 0, before.objectVersion || 0, after?.objectVersion || 0, 1) + 1;
}

export function undoWorkflowDraftChangeSet(project: WorkflowProject): WorkflowDraftAuthorityResult {
  const target = [...(project.draftChangeSets || [])].reverse().find(item => item.status === 'completed' || item.status === 'partial');
  if (!target) return { ok: false, error: { code: 'NOT_FOUND', message: '没有可撤销的 Draft ChangeSet' } };
  const nodeMap = new Map(project.nodes.map(node => [node.id, node]));
  const connectionMap = new Map(project.connections.map(connection => [connection.id, connection]));
  target.nodeChanges.forEach(change => {
    if (!change.before) nodeMap.delete(change.id);
    else nodeMap.set(change.id, {
      ...change.before,
      objectVersion: restoredVersion(nodeMap.get(change.id), change.before, change.after),
    });
  });
  target.connectionChanges.forEach(change => {
    if (!change.before) connectionMap.delete(change.id);
    else connectionMap.set(change.id, {
      ...change.before,
      objectVersion: restoredVersion(connectionMap.get(change.id), change.before, change.after),
    });
  });
  const existingNodes = new Set(nodeMap.keys());
  const nodeOrder = target.nodeOrderBefore || [...nodeMap.keys()];
  const nodes = [...nodeOrder.filter(id => nodeMap.has(id)).map(id => nodeMap.get(id)!), ...[...nodeMap.values()].filter(node => !nodeOrder.includes(node.id))];
  const connections = [...connectionMap.values()].filter(connection => (
    existingNodes.has(connection.fromNodeId) && existingNodes.has(connection.toNodeId)
  ));
  const resultDraftVersion = (project.draftVersion || 1) + 1;
  const now = new Date().toISOString();
  const draftChangeSets = (project.draftChangeSets || []).map(item => item.id === target.id
    ? { ...item, status: 'undone' as const, undoneAt: now, undoneDraftVersion: resultDraftVersion }
    : item);
  const changeSet = draftChangeSets.find(item => item.id === target.id)!;
  return {
    ok: true,
    project: {
      ...project,
      nodes,
      connections,
      selectedNodeIds: project.selectedNodeIds.filter(id => existingNodes.has(id)),
      draftVersion: resultDraftVersion,
      draftChangeSets,
      draftRedoStack: [...(project.draftRedoStack || []), target.id],
    },
    changeSet,
  };
}

export function redoWorkflowDraftChangeSet(project: WorkflowProject): WorkflowDraftAuthorityResult {
  const targetId = project.draftRedoStack?.at(-1);
  const target = project.draftChangeSets?.find(item => item.id === targetId && item.status === 'undone');
  if (!target) return { ok: false, error: { code: 'NOT_FOUND', message: '没有可重做的 Draft ChangeSet' } };
  const nodeMap = new Map(project.nodes.map(node => [node.id, node]));
  const connectionMap = new Map(project.connections.map(connection => [connection.id, connection]));
  target.nodeChanges.forEach(change => {
    if (!change.after) nodeMap.delete(change.id);
    else nodeMap.set(change.id, {
      ...change.after,
      objectVersion: restoredVersion(nodeMap.get(change.id), change.after, change.before),
    });
  });
  target.connectionChanges.forEach(change => {
    if (!change.after) connectionMap.delete(change.id);
    else connectionMap.set(change.id, {
      ...change.after,
      objectVersion: restoredVersion(connectionMap.get(change.id), change.after, change.before),
    });
  });
  const existingNodes = new Set(nodeMap.keys());
  const nodeOrder = target.nodeOrderAfter || [...nodeMap.keys()];
  const resultDraftVersion = (project.draftVersion || 1) + 1;
  const now = new Date().toISOString();
  const draftChangeSets = (project.draftChangeSets || []).map(item => item.id === target.id
    ? { ...item, status: 'completed' as const, redoneAt: now, redoneDraftVersion: resultDraftVersion }
    : item);
  const changeSet = draftChangeSets.find(item => item.id === target.id)!;
  return {
    ok: true,
    project: {
      ...project,
      nodes: [...nodeOrder.filter(id => nodeMap.has(id)).map(id => nodeMap.get(id)!), ...[...nodeMap.values()].filter(node => !nodeOrder.includes(node.id))],
      connections: [...connectionMap.values()].filter(connection => existingNodes.has(connection.fromNodeId) && existingNodes.has(connection.toNodeId)),
      selectedNodeIds: project.selectedNodeIds.filter(id => existingNodes.has(id)),
      draftVersion: resultDraftVersion,
      draftChangeSets,
      draftRedoStack: (project.draftRedoStack || []).slice(0, -1),
    },
    changeSet,
  };
}
