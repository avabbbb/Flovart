import { nanoid } from 'nanoid';

import { applyWorkflowOps } from './ops';
import type {
  WorkflowConnection,
  WorkflowDraftActor,
  WorkflowDraftChangeSet,
  WorkflowNode,
  WorkflowOp,
  WorkflowProject,
  WorkflowSnapshot,
} from './types';

const CHANGE_SET_LIMIT = 100;

export interface WorkflowDraftChangeSetRequest {
  id?: string;
  actor: WorkflowDraftActor;
  intent: string;
  ops: WorkflowOp[];
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
  runRequests: Array<{ nodeId: string }>;
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
  if (!nodeChanges.length && !connectionChanges.length) return null;
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
  if (!recorded) return { ok: false, error: { code: 'BAD_REQUEST', message: '该操作没有修改 Workflow Draft' } };
  return {
    ok: true,
    project: {
      ...recorded.project,
      selectedNodeIds: applied.snapshot.selectedNodeIds,
      viewport: applied.snapshot.viewport,
    },
    changeSet: recorded.changeSet,
    runRequests: applied.runRequests,
  };
}

export function recordWorkflowDraftSnapshotChange(
  project: WorkflowProject,
  before: WorkflowDraftFrame,
  after: WorkflowDraftFrame,
  request: Pick<WorkflowDraftChangeSetRequest, 'id' | 'actor' | 'intent'>,
): WorkflowDraftAuthorityResult {
  const recorded = appendChangeSet(project, before, after, request);
  if (!recorded) return { ok: false, error: { code: 'BAD_REQUEST', message: '该操作没有修改 Workflow Draft' } };
  return { ok: true, ...recorded, runRequests: [] };
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
  const nodes = [...nodeMap.values()];
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
    runRequests: [],
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
      nodes: [...nodeMap.values()],
      connections: [...connectionMap.values()].filter(connection => existingNodes.has(connection.fromNodeId) && existingNodes.has(connection.toNodeId)),
      selectedNodeIds: project.selectedNodeIds.filter(id => existingNodes.has(id)),
      draftVersion: resultDraftVersion,
      draftChangeSets,
      draftRedoStack: (project.draftRedoStack || []).slice(0, -1),
    },
    changeSet,
    runRequests: [],
  };
}
