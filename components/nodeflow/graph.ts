import { NODE_DEFS } from './defs';
import type {
  NodeKind,
  NodePort,
  PendingConnection,
  SelectionBox,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
  XYPosition,
} from './types';

export const GRID_SIZE = 16;
const NODE_HEADER = 30;
const PORT_TOP = 50;
const PORT_GAP = 22;

export const makeId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function snapPosition(pos: XYPosition): XYPosition {
  return { x: snapToGrid(pos.x), y: snapToGrid(pos.y) };
}

export function getNodeRect(node: WorkflowNode) {
  const def = NODE_DEFS[node.kind];
  return { x: node.x, y: node.y, width: def.width, height: def.height };
}

export function getNodesBounds(nodes: WorkflowNode[]) {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const rect = getNodeRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function buildGroupFromNodes(
  title: string,
  nodeIds: string[],
  nodes: WorkflowNode[],
): WorkflowGroup | null {
  const members = nodes.filter((node) => nodeIds.includes(node.id));
  if (members.length < 2) return null;
  const bounds = getNodesBounds(members);
  const padding = 28;
  return {
    id: makeId('group'),
    title,
    x: bounds.x - padding,
    y: bounds.y - padding - 16,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2 + 16,
    nodeIds: members.map((n) => n.id),
  };
}

export function updateGroupBounds(group: WorkflowGroup, nodes: WorkflowNode[]): WorkflowGroup {
  const members = nodes.filter((node) => group.nodeIds.includes(node.id));
  if (members.length === 0) return group;
  const bounds = getNodesBounds(members);
  const padding = 28;
  return {
    ...group,
    x: bounds.x - padding,
    y: bounds.y - padding - 16,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2 + 16,
  };
}

export function getPortPosition(node: WorkflowNode, portIndex: number, output: boolean): XYPosition {
  const def = NODE_DEFS[node.kind];
  return {
    x: node.x + (output ? def.width : 0),
    y: node.y + PORT_TOP + portIndex * PORT_GAP,
  };
}

export function getPortLabelY(index: number): number {
  return NODE_HEADER + 17 + index * PORT_GAP;
}

function getPortType(kind: NodeKind, port: string, output: boolean) {
  const def = NODE_DEFS[kind];
  const list = output ? def.outputs : def.inputs;
  return list.find((p) => p.key === port)?.type;
}

function arePortTypesCompatible(sourceType: string, targetType: string): boolean {
  if (sourceType === targetType) return true;
  if (sourceType === 'any' || targetType === 'any') return true;
  return sourceType === 'result' || targetType === 'result';
}

export function canConnectEdge(
  sourceNode: WorkflowNode | undefined,
  sourcePort: string,
  targetNode: WorkflowNode | undefined,
  targetPort: string,
): boolean {
  if (!sourceNode || !targetNode) return false;
  if (sourceNode.id === targetNode.id) return false;
  const sourceType = getPortType(sourceNode.kind, sourcePort, true);
  const targetType = getPortType(targetNode.kind, targetPort, false);
  if (!sourceType || !targetType) return false;
  return arePortTypesCompatible(sourceType, targetType);
}

function findCompatiblePortPair(
  sourceNode: WorkflowNode,
  sourcePortKey: string,
  targetNode: WorkflowNode,
  targetPortKey: string,
): { fromPort: string; toPort: string } | null {
  if (sourceNode.id === targetNode.id) return null;
  const sourcePorts = NODE_DEFS[sourceNode.kind].outputs;
  const targetPorts = NODE_DEFS[targetNode.kind].inputs;
  const requestedSource = sourcePorts.find((port) => port.key === sourcePortKey);
  const requestedTarget = targetPorts.find((port) => port.key === targetPortKey);

  const isCompatible = (source: NodePort, target: NodePort) => (
    arePortTypesCompatible(source.type, target.type)
  );

  if (requestedSource && requestedTarget && isCompatible(requestedSource, requestedTarget)) {
    return { fromPort: requestedSource.key, toPort: requestedTarget.key };
  }

  if (requestedSource) {
    const target = targetPorts.find((port) => isCompatible(requestedSource, port));
    return target ? { fromPort: requestedSource.key, toPort: target.key } : null;
  }

  if (requestedTarget) {
    const source = sourcePorts.find((port) => isCompatible(port, requestedTarget));
    return source ? { fromPort: source.key, toPort: requestedTarget.key } : null;
  }

  for (const source of sourcePorts) {
    const target = targetPorts.find((port) => isCompatible(source, port));
    if (target) return { fromPort: source.key, toPort: target.key };
  }

  return null;
}

export function normalizeWorkflowEdges(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowEdge[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const usedInputs = new Set<string>();
  const normalized: WorkflowEdge[] = [];

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.fromNode);
    const targetNode = nodeMap.get(edge.toNode);
    if (!sourceNode || !targetNode) continue;

    const pair = findCompatiblePortPair(sourceNode, edge.fromPort, targetNode, edge.toPort);
    if (!pair) continue;

    const inputKey = `${edge.toNode}:${pair.toPort}`;
    if (usedInputs.has(inputKey)) continue;
    usedInputs.add(inputKey);

    normalized.push({
      ...edge,
      id: typeof edge.id === 'string' && edge.id ? edge.id : makeId('edge'),
      fromPort: pair.fromPort,
      toPort: pair.toPort,
    });
  }

  return normalized;
}

export function upsertEdgeToInput(
  edges: WorkflowEdge[],
  connection: PendingConnection,
  targetNode: string,
  targetPort: string,
): WorkflowEdge[] {
  const filtered = edges.filter((edge) => !(edge.toNode === targetNode && edge.toPort === targetPort));
  filtered.push({
    id: makeId('edge'),
    fromNode: connection.fromNode,
    fromPort: connection.fromPort,
    toNode: targetNode,
    toPort: targetPort,
  });
  return filtered;
}

export function removeNodeAndEdges(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  groups: WorkflowGroup[],
  nodeId: string,
) {
  const nextNodes = nodes.filter((node) => node.id !== nodeId);
  const nextEdges = edges.filter((edge) => edge.fromNode !== nodeId && edge.toNode !== nodeId);
  const nextGroups = groups
    .map((group) => ({ ...group, nodeIds: group.nodeIds.filter((id) => id !== nodeId) }))
    .filter((group) => group.nodeIds.length > 0);
  return { nodes: nextNodes, edges: nextEdges, groups: nextGroups };
}

export function getBezierPath(p1: XYPosition, p2: XYPosition): string {
  const dx = p2.x - p1.x;
  const controlOffset = Math.min(Math.max(Math.abs(dx) * 0.5, 48), 150);
  const cx1 = p1.x + controlOffset;
  const cx2 = p2.x - controlOffset;
  return `M ${p1.x} ${p1.y} C ${cx1} ${p1.y}, ${cx2} ${p2.y}, ${p2.x} ${p2.y}`;
}

export function selectionBoxRect(selectionBox: SelectionBox) {
  return {
    x: Math.min(selectionBox.startX, selectionBox.currentX),
    y: Math.min(selectionBox.startY, selectionBox.currentY),
    width: Math.abs(selectionBox.currentX - selectionBox.startX),
    height: Math.abs(selectionBox.currentY - selectionBox.startY),
  };
}

export function nodesInSelection(nodes: WorkflowNode[], selectionBox: SelectionBox): string[] {
  const rect = selectionBoxRect(selectionBox);
  return nodes
    .filter((node) => {
      const n = getNodeRect(node);
      const inside =
        n.x >= rect.x &&
        n.y >= rect.y &&
        n.x + n.width <= rect.x + rect.width &&
        n.y + n.height <= rect.y + rect.height;
      return inside;
    })
    .map((node) => node.id);
}

export function clampScale(scale: number) {
  return Math.max(0.3, Math.min(2.2, scale));
}

