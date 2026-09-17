import { nanoid } from 'nanoid';
import { createWorkflowNode } from './constants';
import { resolveWorkflowInputs } from './inputResolver';
import { getWorkflowOperationInputRoleForNodeType, validateWorkflowOperationInputBindings } from './operationRegistry';
import { createWorkflowOperationInputBinding, updateWorkflowOperationFromMetadata, updateWorkflowOperationRecipe, workflowOperationInputConnections } from './operations';
import type { WorkflowConnection, WorkflowNode, WorkflowNodeMetadata, WorkflowOp, WorkflowOperationInputBinding, WorkflowOperationInputRole, WorkflowSnapshot } from './types';

export interface WorkflowOpResult {
  snapshot: WorkflowSnapshot;
  rejections: WorkflowOpRejection[];
}

export interface WorkflowOpRejection {
  opIndex: number;
  opType: string;
  reason: string;
}

export type WorkflowConnectionValidationResult = { ok: true } | { ok: false; reason: string };

function createsCycle(connections: WorkflowConnection[], fromNodeId: string, toNodeId: string): boolean {
  const outgoing = new Map<string, string[]>();
  connections.forEach(connection => {
    outgoing.set(connection.fromNodeId, [...(outgoing.get(connection.fromNodeId) || []), connection.toNodeId]);
  });
  const pending = [toNodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === fromNodeId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) || []));
  }
  return false;
}

function createUniqueConnectionId(connections: WorkflowConnection[]): string {
  let id = nanoid();
  while (connections.some(connection => connection.id === id)) id = nanoid();
  return id;
}

function operationInputRole(fromNode: WorkflowNode, toNode: WorkflowNode): WorkflowOperationInputRole | null {
  const capabilityId = toNode.metadata.operation?.capabilityId;
  if (!capabilityId) return null;
  return getWorkflowOperationInputRoleForNodeType(capabilityId, fromNode.type);
}

function connectOperationInput(snapshot: WorkflowSnapshot, connection: WorkflowConnection): WorkflowSnapshot {
  const source = snapshot.nodes.find(node => node.id === connection.fromNodeId);
  const target = snapshot.nodes.find(node => node.id === connection.toNodeId);
  if (!source || !target || target.type !== 'operation' || !target.metadata.operation) {
    return { ...snapshot, connections: [...snapshot.connections, connection] };
  }
  const role = operationInputRole(source, target)!;
  const existing = target.metadata.operation.recipe.inputBindings.find(binding => binding.sourceNodeId === source.id);
  const binding = existing || createWorkflowOperationInputBinding(connection.id, source.id, role, target.metadata.operation.recipe.inputBindings.length);
  const operation = existing ? target : updateWorkflowOperationRecipe(target, { inputBindings: [...target.metadata.operation.recipe.inputBindings, binding] });
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(node => node.id === target.id ? operation : node),
    connections: [...snapshot.connections, { ...connection, kind: 'operation-input', role: binding.role, order: binding.order }],
  };
}

function removeOperationInputs(snapshot: WorkflowSnapshot, removed: WorkflowConnection[]): WorkflowSnapshot {
  if (!removed.length) return snapshot;
  const removedSourcesByTarget = new Map<string, Set<string>>();
  removed.forEach(connection => {
    const target = snapshot.nodes.find(node => node.id === connection.toNodeId);
    if (target?.type !== 'operation') return;
    const sources = removedSourcesByTarget.get(target.id) || new Set<string>();
    sources.add(connection.fromNodeId);
    removedSourcesByTarget.set(target.id, sources);
  });
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(node => {
      const sources = removedSourcesByTarget.get(node.id);
      const operation = node.metadata.operation;
      if (!sources || !operation) return node;
      return updateWorkflowOperationRecipe(node, { inputBindings: operation.recipe.inputBindings.filter(binding => !sources.has(binding.sourceNodeId)) });
    }),
  };
}

function synchronizeOperationInputConnections(connections: WorkflowConnection[], node: WorkflowNode): WorkflowConnection[] {
  if (!node.metadata.operation) return connections;
  return [
    ...connections.filter(connection => connection.toNodeId !== node.id),
    ...workflowOperationInputConnections(node),
  ];
}

export function topoSort(nodes: WorkflowNode[], connections: WorkflowConnection[], nodeIds: string[]): string[] {
  const idSet = new Set(nodeIds);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  nodeIds.forEach(id => { incoming.set(id, []); outgoing.set(id, []); });
  connections.forEach(conn => {
    if (idSet.has(conn.fromNodeId) && idSet.has(conn.toNodeId)) {
      outgoing.get(conn.fromNodeId)!.push(conn.toNodeId);
      incoming.get(conn.toNodeId)!.push(conn.fromNodeId);
    }
  });
  const queue = nodeIds.filter(id => incoming.get(id)!.length === 0);
  const result: string[] = [];
  const inDegree = new Map<string, number>();
  nodeIds.forEach(id => inDegree.set(id, incoming.get(id)!.length));
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.push(id);
    outgoing.get(id)!.forEach(next => {
      const deg = inDegree.get(next)! - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    });
  }
  return result.length === nodeIds.length ? result : nodeIds;
}

export interface UpstreamData {
  imageHrefs: string[];
  videoHrefs: string[];
  audioHrefs: string[];
  textContents: string[];
  referenceNodeIds: string[];
}

export function getUpstreamData(
  targetNode: WorkflowNode,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): UpstreamData {
  const resolved = resolveWorkflowInputs(targetNode, nodes, connections);
  return {
    imageHrefs: resolved.images.map(resource => resource.href).filter((href): href is string => Boolean(href)),
    videoHrefs: resolved.videos.map(resource => resource.href).filter((href): href is string => Boolean(href)),
    audioHrefs: resolved.audios.map(resource => resource.href).filter((href): href is string => Boolean(href)),
    textContents: resolved.texts.map(resource => resource.text).filter((text): text is string => Boolean(text)),
    referenceNodeIds: [...new Set(resolved.resources.map(resource => resource.sourceNodeId))],
  };
}

export function validateWorkflowConnection(
  snapshot: WorkflowSnapshot,
  fromNodeId: string,
  toNodeId: string,
): WorkflowConnectionValidationResult {
  const fromNode = snapshot.nodes.find(node => node.id === fromNodeId);
  if (!fromNode) return { ok: false, reason: '起始节点不存在' };
  const toNode = snapshot.nodes.find(node => node.id === toNodeId);
  if (!toNode) return { ok: false, reason: '目标节点不存在' };
  if (fromNodeId === toNodeId) return { ok: false, reason: '不能连接节点自身' };
  if (fromNode.type === 'config' && toNode.type === 'config') return { ok: false, reason: '生成配置节点之间不能连接' };
  if (fromNode.type === 'script' && toNode.type !== 'image' && toNode.type !== 'video') return { ok: false, reason: '脚本节点只能连向图片或视频节点' };
  if (toNode.type === 'script' && fromNode.type !== 'image' && fromNode.type !== 'video' && fromNode.type !== 'text') return { ok: false, reason: '脚本节点只能接收图片、视频或文本输入' };
  if (snapshot.connections.some(connection => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) {
    return { ok: false, reason: '节点之间已存在连接' };
  }
  if (toNode.type === 'operation') {
    if (!toNode.metadata.operation) return { ok: false, reason: 'Operation 配方缺失' };
    const role = operationInputRole(fromNode, toNode);
    if (!role) return { ok: false, reason: '该节点类型不能作为此 Operation 的输入' };
    const existingBinding = toNode.metadata.operation.recipe.inputBindings.some(binding => binding.sourceNodeId === fromNodeId);
    if (!existingBinding) {
      try {
        validateWorkflowOperationInputBindings(toNode.metadata.operation.capabilityId, [
          ...toNode.metadata.operation.recipe.inputBindings,
          createWorkflowOperationInputBinding('__candidate__', fromNodeId, role, toNode.metadata.operation.recipe.inputBindings.length),
        ]);
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'Operation 输入不符合 Registry 契约' };
      }
    }
  }
  if (createsCycle(snapshot.connections, fromNodeId, toNodeId)) return { ok: false, reason: '连接会形成循环' };
  return { ok: true };
}

export function applyWorkflowOps(initial: WorkflowSnapshot, ops: WorkflowOp[]): WorkflowOpResult {
  let snapshot: WorkflowSnapshot = {
    ...initial,
    nodes: [...initial.nodes],
    connections: [...initial.connections],
    selectedNodeIds: [...initial.selectedNodeIds],
    viewport: { ...initial.viewport },
  };
  const rejections: WorkflowOpRejection[] = [];
  const reject = (opIndex: number, op: WorkflowOp, reason: string) => {
    rejections.push({ opIndex, opType: op.type, reason });
  };

/**
 * External callers (workflow.apply / Agent bridges) may submit a bare node literal
 * without metadata/size defaults. Re-materialize it through createWorkflowNode so
 * downstream code can rely on `node.metadata` existing — same defaults the
 * workflow.node.create adapter fills via validatedNode().
 */
function normalizeDocumentNode(node: WorkflowNode): WorkflowNode {
  const metadata = (node.metadata || {}) as WorkflowNodeMetadata;
  const normalized = createWorkflowNode(node.id, node.type, node.position, metadata);
  if (node.title !== undefined) normalized.title = node.title;
  if (node.width !== undefined) normalized.width = node.width;
  if (node.height !== undefined) normalized.height = node.height;
  if (node.isVisible !== undefined) normalized.isVisible = node.isVisible;
  if (node.isLocked !== undefined) normalized.isLocked = node.isLocked;
  if (node.batchId !== undefined) normalized.batchId = node.batchId;
  if (node.batchIndex !== undefined) normalized.batchIndex = node.batchIndex;
  if (node.batchGroupSource !== undefined) normalized.batchGroupSource = node.batchGroupSource;
  if (node.objectVersion !== undefined) normalized.objectVersion = node.objectVersion;
  return normalized;
}

  ops.forEach((op, opIndex) => {
    if (op.type === 'add_node') {
      const node = normalizeDocumentNode(op.node);
      if (!snapshot.nodes.some(item => item.id === node.id)) {
        snapshot = { ...snapshot, nodes: [...snapshot.nodes, node], selectedNodeIds: [node.id] };
      } else {
        reject(opIndex, op, '节点 ID 已存在');
      }
      return;
    }
    if (op.type === 'create_connected_node') {
      const node = normalizeDocumentNode(op.node);
      const duplicateNode = snapshot.nodes.some(item => item.id === node.id);
      const candidate = duplicateNode ? snapshot : { ...snapshot, nodes: [...snapshot.nodes, node] };
      const validation = validateWorkflowConnection(candidate, op.fromNodeId, node.id);
      if (duplicateNode) {
        reject(opIndex, op, '节点 ID 已存在');
        return;
      }
      if (validation.ok === false) {
        reject(opIndex, op, validation.reason);
        return;
      }
      snapshot = {
        ...candidate,
        connections: [...candidate.connections, {
          id: createUniqueConnectionId(candidate.connections),
          fromNodeId: op.fromNodeId,
          toNodeId: node.id,
        }],
        selectedNodeIds: [node.id],
      };
      return;
    }
    if (op.type === 'update_node') {
      const current = snapshot.nodes.find(node => node.id === op.id);
      if (!current) return;
      const metadataPatch = { ...(op.patch?.metadata || {}), ...(op.metadata || {}) };
      const base = { ...current, ...op.patch, metadata: current.metadata };
      const updated = op.replaceMetadata
        ? { ...base, metadata: op.patch?.metadata || op.metadata || {} }
        : current.metadata.operation && Object.keys(metadataPatch).length > 0
        ? updateWorkflowOperationFromMetadata(base, metadataPatch)
        : { ...base, metadata: { ...current.metadata, ...metadataPatch } };
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.map(node => node.id === op.id ? updated : node),
        connections: synchronizeOperationInputConnections(snapshot.connections, updated),
      };
      return;
    }
    if (op.type === 'delete_nodes') {
      const ids = new Set(op.ids);
      const next = {
        ...snapshot,
        nodes: snapshot.nodes.filter(node => !ids.has(node.id)),
        connections: snapshot.connections.filter(connection => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId)),
        selectedNodeIds: snapshot.selectedNodeIds.filter(id => !ids.has(id)),
      };
      snapshot = {
        ...next,
        nodes: next.nodes.map(node => {
          const operation = node.metadata.operation;
          if (!operation || !operation.recipe.inputBindings.some(binding => ids.has(binding.sourceNodeId))) return node;
          return updateWorkflowOperationRecipe(node, { inputBindings: operation.recipe.inputBindings.filter(binding => !ids.has(binding.sourceNodeId)) });
        }),
      };
      return;
    }
    if (op.type === 'delete_connections') {
      const ids = new Set(op.ids || []);
      const removed = snapshot.connections.filter(connection => op.all || ids.has(connection.id));
      snapshot = removeOperationInputs({ ...snapshot, connections: op.all ? [] : snapshot.connections.filter(connection => !ids.has(connection.id)) }, removed);
      return;
    }
    if (op.type === 'connect_nodes') {
      const validation = validateWorkflowConnection(snapshot, op.fromNodeId, op.toNodeId);
      if (op.id && snapshot.connections.some(connection => connection.id === op.id)) {
        reject(opIndex, op, '连接 ID 已存在');
        return;
      }
      if (validation.ok === false) {
        reject(opIndex, op, validation.reason);
        return;
      }
      snapshot = connectOperationInput(snapshot, {
        id: op.id || createUniqueConnectionId(snapshot.connections),
        fromNodeId: op.fromNodeId,
        toNodeId: op.toNodeId,
        kind: op.kind,
        role: op.role,
        order: op.order,
      });
      return;
    }
    if (op.type === 'move_nodes') {
      const positions = new Map(op.positions.map(item => [item.id, item.position]));
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.map(node => positions.has(node.id) ? { ...node, position: { ...positions.get(node.id)! } } : node),
      };
      return;
    }
    if (op.type === 'reorder_nodes') {
      const byId = new Map(snapshot.nodes.map(node => [node.id, node]));
      if (op.ids.length !== byId.size || new Set(op.ids).size !== byId.size || op.ids.some(id => !byId.has(id))) {
        reject(opIndex, op, '节点顺序必须完整且不能重复');
        return;
      }
      snapshot = { ...snapshot, nodes: op.ids.map(id => byId.get(id)!) };
      return;
    }
    if (op.type === 'reorder_connections') {
      const byId = new Map(snapshot.connections.map(connection => [connection.id, connection]));
      if (op.ids.length !== byId.size || new Set(op.ids).size !== byId.size || op.ids.some(id => !byId.has(id))) {
        reject(opIndex, op, '连接顺序必须完整且不能重复');
        return;
      }
      const reordered = op.ids.map(id => byId.get(id)!);
      // Operation 节点：bindings 顺序跟随连接数组顺序，role 保持不变
      const sourceOrderByTarget = new Map<string, string[]>();
      for (const connection of reordered) {
        const sources = sourceOrderByTarget.get(connection.toNodeId) || [];
        sources.push(connection.fromNodeId);
        sourceOrderByTarget.set(connection.toNodeId, sources);
      }
      let nodes = snapshot.nodes;
      for (const node of snapshot.nodes) {
        const operation = node.metadata.operation;
        const orderedSources = sourceOrderByTarget.get(node.id);
        if (!operation || !orderedSources) continue;
        const existing = new Map(operation.recipe.inputBindings.map(binding => [binding.sourceNodeId, binding]));
        const reorderedBindings = orderedSources
          .map(sourceNodeId => existing.get(sourceNodeId))
          .filter((binding): binding is WorkflowOperationInputBinding => Boolean(binding))
          .map((binding, index) => ({ ...binding, order: index }));
        nodes = nodes.map(item => item.id === node.id ? updateWorkflowOperationRecipe(item, { inputBindings: reorderedBindings }) : item);
      }
      snapshot = { ...snapshot, nodes, connections: reordered };
      return;
    }
    if (op.type === 'select_nodes') {
      const validIds = new Set(snapshot.nodes.map(node => node.id));
      snapshot = { ...snapshot, selectedNodeIds: op.ids.filter(id => validIds.has(id)) };
      return;
    }
    if (op.type === 'set_viewport') {
      snapshot = { ...snapshot, viewport: { ...op.viewport } };
      return;
    }
    if (op.type === 'group_nodes') {
      const ids = new Set(op.ids);
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.map(node => ids.has(node.id)
          ? { ...node, batchId: op.batchId, batchGroupSource: op.source || 'manual' }
          : node),
      };
      return;
    }
    if (op.type === 'ungroup_nodes') {
      const ids = new Set(op.ids);
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.map(node => ids.has(node.id)
          ? { ...node, batchId: undefined, batchIndex: undefined, batchGroupSource: undefined, metadata: { ...node.metadata, primaryImageId: undefined } }
          : node),
      };
      return;
    }
    if (op.type === 'set_batch_primary') {
      const groupNodes = snapshot.nodes.filter(node => node.batchId === op.batchId);
      const root = groupNodes.find(node => node.batchIndex === 0) || groupNodes[0];
      if (!root) return;
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.map(node => node.id === root.id
          ? { ...node, metadata: { ...node.metadata, primaryImageId: op.nodeId } }
          : node),
      };
      return;
    }
    if (op.type === 'focus_node') {
      if (!snapshot.nodes.some(node => node.id === op.nodeId)) {
        reject(opIndex, op, '目标节点不存在');
        return;
      }
      snapshot = {
        ...snapshot,
        selectedNodeIds: [op.nodeId],
        ...(op.viewport ? { viewport: { ...op.viewport } } : {}),
      };
      return;
    }
    reject(opIndex, op as WorkflowOp, String((op as { type?: unknown }).type).includes('generation') || (op as { type?: unknown }).type === 'execute_group'
      ? '执行操作不属于 Workflow Mutation Core'
      : '未知 Workflow operation');
  });

  return { snapshot, rejections };
}

export function summarizeWorkflowOps(ops: WorkflowOp[]): string {
  const counts = ops.reduce<Record<string, number>>((result, op) => {
    result[op.type] = (result[op.type] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([type, count]) => `${type} ${count}`).join('，');
}
