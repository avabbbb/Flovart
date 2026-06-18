import { nanoid } from 'nanoid';
import type { WorkflowConnection, WorkflowOp, WorkflowSnapshot } from './types';

export interface WorkflowOpResult {
  snapshot: WorkflowSnapshot;
  runRequests: Array<{ nodeId: string }>;
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

  ops.forEach(op => {
    if (op.type === 'add_node') {
      if (!snapshot.nodes.some(node => node.id === op.node.id)) {
        snapshot = { ...snapshot, nodes: [...snapshot.nodes, op.node], selectedNodeIds: [op.node.id] };
      }
      return;
    }
    if (op.type === 'create_connected_node') {
      const duplicateNode = snapshot.nodes.some(node => node.id === op.node.id);
      const candidate = duplicateNode ? snapshot : { ...snapshot, nodes: [...snapshot.nodes, op.node] };
      if (!validateWorkflowConnection(candidate, op.fromNodeId, op.node.id).ok || duplicateNode) return;
      snapshot = {
        ...candidate,
        connections: [...candidate.connections, { id: nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.node.id }],
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
      if (!validateWorkflowConnection(snapshot, op.fromNodeId, op.toNodeId).ok) return;
      snapshot = {
        ...snapshot,
        connections: [...snapshot.connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }],
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
  });

  return { snapshot, runRequests };
}

export function summarizeWorkflowOps(ops: WorkflowOp[]): string {
  const counts = ops.reduce<Record<string, number>>((result, op) => {
    result[op.type] = (result[op.type] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts).map(([type, count]) => `${type} ${count}`).join('，');
}
