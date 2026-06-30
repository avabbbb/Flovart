import { nanoid } from 'nanoid';
import type { WorkflowConnection, WorkflowNode, WorkflowOp, WorkflowSnapshot } from './types';

export interface WorkflowOpResult {
  snapshot: WorkflowSnapshot;
  runRequests: Array<{ nodeId: string }>;
  rejections: WorkflowOpRejection[];
}

export interface WorkflowOpRejection {
  opIndex: number;
  opType: WorkflowOp['type'];
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
  const explicitRefs = targetNode.metadata.referenceNodeIds || [];
  const upstreamNodeIds = explicitRefs.length > 0
    ? explicitRefs
    : connections.filter(c => c.toNodeId === targetNode.id).map(c => c.fromNodeId);
  const nodesById = new Map(nodes.map(n => [n.id, n]));
  const data: UpstreamData = { imageHrefs: [], videoHrefs: [], audioHrefs: [], textContents: [], referenceNodeIds: upstreamNodeIds };
  upstreamNodeIds.forEach(id => {
    const node = nodesById.get(id);
    if (!node) return;
    if (node.type === 'image' && node.metadata.href) data.imageHrefs.push(node.metadata.href);
    if (node.type === 'video' && node.metadata.href) data.videoHrefs.push(node.metadata.href);
    if (node.type === 'audio' && node.metadata.href) data.audioHrefs.push(node.metadata.href);
    if (node.type === 'text' && node.metadata.content) data.textContents.push(node.metadata.content);
    if (node.type === 'config' && node.metadata.prompt) data.textContents.push(node.metadata.prompt);
  });
  return data;
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
  const runRequests: Array<{ nodeId: string }> = [];
  const rejections: WorkflowOpRejection[] = [];
  const reject = (opIndex: number, op: WorkflowOp, reason: string) => {
    rejections.push({ opIndex, opType: op.type, reason });
  };

  ops.forEach((op, opIndex) => {
    if (op.type === 'add_node') {
      if (!snapshot.nodes.some(node => node.id === op.node.id)) {
        snapshot = { ...snapshot, nodes: [...snapshot.nodes, op.node], selectedNodeIds: [op.node.id] };
      } else {
        reject(opIndex, op, '节点 ID 已存在');
      }
      return;
    }
    if (op.type === 'create_connected_node') {
      const duplicateNode = snapshot.nodes.some(node => node.id === op.node.id);
      const candidate = duplicateNode ? snapshot : { ...snapshot, nodes: [...snapshot.nodes, op.node] };
      const validation = validateWorkflowConnection(candidate, op.fromNodeId, op.node.id);
      if (duplicateNode) {
        reject(opIndex, op, '节点 ID 已存在');
        return;
      }
      if (!validation.ok) {
        reject(opIndex, op, validation.reason);
        return;
      }
      snapshot = {
        ...candidate,
        connections: [...candidate.connections, {
          id: createUniqueConnectionId(candidate.connections),
          fromNodeId: op.fromNodeId,
          toNodeId: op.node.id,
        }],
        selectedNodeIds: [op.node.id],
      };
      return;
    }
    if (op.type === 'update_node') {
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.map(node => node.id === op.id
          ? { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } }
          : node),
      };
      return;
    }
    if (op.type === 'delete_nodes') {
      const ids = new Set(op.ids);
      snapshot = {
        ...snapshot,
        nodes: snapshot.nodes.filter(node => !ids.has(node.id)),
        connections: snapshot.connections.filter(connection => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId)),
        selectedNodeIds: snapshot.selectedNodeIds.filter(id => !ids.has(id)),
      };
      return;
    }
    if (op.type === 'delete_connections') {
      const ids = new Set(op.ids || []);
      snapshot = { ...snapshot, connections: op.all ? [] : snapshot.connections.filter(connection => !ids.has(connection.id)) };
      return;
    }
    if (op.type === 'connect_nodes') {
      const validation = validateWorkflowConnection(snapshot, op.fromNodeId, op.toNodeId);
      if (op.id && snapshot.connections.some(connection => connection.id === op.id)) {
        reject(opIndex, op, '连接 ID 已存在');
        return;
      }
      if (!validation.ok) {
        reject(opIndex, op, validation.reason);
        return;
      }
      snapshot = {
        ...snapshot,
        connections: [...snapshot.connections, {
          id: op.id || createUniqueConnectionId(snapshot.connections),
          fromNodeId: op.fromNodeId,
          toNodeId: op.toNodeId,
        }],
      };
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
    if (op.type === 'run_generation' && snapshot.nodes.some(node => node.id === op.nodeId)) {
      runRequests.push({ nodeId: op.nodeId });
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
          ? { ...node, batchId: undefined, batchIndex: undefined, batchGroupSource: undefined }
          : node),
      };
      return;
    }
    if (op.type === 'execute_group') {
      const order = topoSort(snapshot.nodes, snapshot.connections, op.nodeIds);
      order.forEach(nodeId => runRequests.push({ nodeId }));
    }
  });

  return { snapshot, runRequests, rejections };
}

export function summarizeWorkflowOps(ops: WorkflowOp[]): string {
  const counts = ops.reduce<Record<string, number>>((result, op) => {
    result[op.type] = (result[op.type] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([type, count]) => `${type} ${count}`).join('，');
}
