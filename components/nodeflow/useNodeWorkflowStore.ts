import { useEffect, useMemo, useRef, useState } from 'react';
import { INITIAL_EDGES, INITIAL_GROUPS, INITIAL_NODES, NODE_DEFS } from './defs';
import {
  collectPinnedOutputObjectUrls,
  hydrateWorkflowNodesFromStorage,
  serializeWorkflowNodesForStorage,
} from './pinnedOutputPersistence';
import {
  buildGroupFromNodes,
  canConnectEdge,
  clampScale,
  makeId,
  nodesInSelection,
  normalizeWorkflowEdges,
  removeNodeAndEdges,
  snapPosition,
  updateGroupBounds,
  upsertEdgeToInput,
} from './graph';
import type {
  NodeConfig,
  NodeKind,
  PendingConnection,
  SelectionBox,
  WorkflowEdge,
  WorkflowGroup,
  WorkflowNode,
  WorkflowViewport,
  XYPosition,
} from './types';

type GraphState = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  viewport: WorkflowViewport;
};

type ClipboardData = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  anchor: XYPosition;
};

type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
type DistributeMode = 'horizontal' | 'vertical';

type DragState =
  | {
      kind: 'node';
      nodeIds: string[];
      start: XYPosition;
      origin: Record<string, XYPosition>;
    }
  | {
      kind: 'group';
      groupId: string;
      nodeIds: string[];
      start: XYPosition;
      origin: Record<string, XYPosition>;
    };

const STORAGE_KEY = 'flovart.nodeflow.v1';
const HISTORY_LIMIT = 80;
const PASTE_OFFSET = 48;

type StoredWorkflow = {
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  groups?: WorkflowGroup[];
  viewport?: WorkflowViewport;
};

function isKnownNodeKind(kind: unknown): kind is NodeKind {
  return typeof kind === 'string' && kind in NODE_DEFS;
}

function sanitizeStoredWorkflow(stored: StoredWorkflow): StoredWorkflow {
  const nodes = (stored.nodes ?? []).filter((node): node is WorkflowNode => (
    !!node
    && typeof node.id === 'string'
    && isKnownNodeKind(node.kind)
    && typeof node.x === 'number'
    && typeof node.y === 'number'
  ));
  if (nodes.length === 0) {
    return { viewport: stored.viewport };
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeWorkflowEdges(
    nodes,
    (stored.edges ?? []).filter((edge): edge is WorkflowEdge => !!edge),
  );
  const groups = (stored.groups ?? [])
    .filter((group): group is WorkflowGroup => (
      !!group
      && typeof group.id === 'string'
      && Array.isArray(group.nodeIds)
    ))
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((nodeId) => nodeIds.has(nodeId)),
    }))
    .filter((group): group is WorkflowGroup => (
      !!group
      && typeof group.id === 'string'
      && group.nodeIds.length > 0
    ));

  return {
    nodes: nodes.length > 0 ? nodes : undefined,
    edges,
    groups,
    viewport: stored.viewport,
  };
}

function loadStoredWorkflow(): StoredWorkflow | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitizeStoredWorkflow(JSON.parse(raw) as StoredWorkflow);
  } catch {
    return null;
  }
}

function cloneGraph(graph: GraphState): GraphState {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    groups: graph.groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] })),
    viewport: { ...graph.viewport },
  };
}

function updateGroupsWithNodes(groups: WorkflowGroup[], nodes: WorkflowNode[]): WorkflowGroup[] {
  return groups.map((group) => updateGroupBounds(group, nodes));
}

export function useNodeWorkflowStore() {
  const stored = useMemo(() => loadStoredWorkflow(), []);
  const [graph, setGraph] = useState<GraphState>(() => ({
    nodes: stored?.nodes ?? INITIAL_NODES,
    edges: stored?.edges ?? INITIAL_EDGES,
    groups: stored?.groups ?? INITIAL_GROUPS,
    viewport: stored?.viewport ?? { x: -120, y: -80, scale: 0.86 },
  }));

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [panning, setPanning] = useState<{ start: XYPosition; origin: XYPosition } | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [, bumpMeta] = useState(0);

  const historyPastRef = useRef<GraphState[]>([]);
  const historyFutureRef = useRef<GraphState[]>([]);
  const clipboardRef = useRef<ClipboardData | null>(null);
  const persistVersionRef = useRef(0);
  const hasLocalEditsRef = useRef(false);
  const hydratedPinnedUrlsRef = useRef<Set<string>>(new Set());

  const nodeMap = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);

  const snap = (position: XYPosition) => (gridSnapEnabled ? snapPosition(position) : position);

  const canUndo = historyPastRef.current.length > 0;
  const canRedo = historyFutureRef.current.length > 0;
  const canPaste = !!clipboardRef.current && clipboardRef.current.nodes.length > 0;

  const touchMeta = () => bumpMeta((v) => v + 1);

  const persistGraph = (next: GraphState) => {
    if (typeof window === 'undefined') return;
    const snapshot: StoredWorkflow = {
      nodes: next.nodes.map((node) => ({ ...node, config: node.config ? { ...node.config } : node.config })),
      edges: next.edges,
      groups: next.groups,
      viewport: next.viewport,
    };
    const persistVersion = ++persistVersionRef.current;

    void serializeWorkflowNodesForStorage(snapshot.nodes ?? [])
      .then((serializedNodes) => {
        if (persistVersion !== persistVersionRef.current) return;
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
            ...snapshot,
            nodes: serializedNodes,
          }));
        } catch {
          // ignore storage quota errors
        }
      })
      .catch(() => {
        if (persistVersion !== persistVersionRef.current) return;
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch {
          // ignore storage quota errors
        }
      });
  };

  const pushHistory = (snapshot: GraphState) => {
    historyPastRef.current = [...historyPastRef.current.slice(-(HISTORY_LIMIT - 1)), cloneGraph(snapshot)];
    historyFutureRef.current = [];
    touchMeta();
  };

  const commitGraph = (updater: (prev: GraphState) => GraphState, recordHistory = true) => {
    if (recordHistory) {
      pushHistory(graph);
    }
    hasLocalEditsRef.current = true;
    setGraph((prev) => {
      const next = updater(prev);
      persistGraph(next);
      return next;
    });
  };

  useEffect(() => {
    if (!stored?.nodes || stored.nodes.length === 0) return;
    let cancelled = false;

    void hydrateWorkflowNodesFromStorage(stored.nodes).then((hydratedNodes) => {
      if (cancelled || hasLocalEditsRef.current) {
        collectPinnedOutputObjectUrls(hydratedNodes).forEach((url) => URL.revokeObjectURL(url));
        return;
      }
      hydratedPinnedUrlsRef.current = collectPinnedOutputObjectUrls(hydratedNodes);
      setGraph((prev) => ({
        ...prev,
        nodes: hydratedNodes,
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [stored]);

  useEffect(() => () => {
    hydratedPinnedUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    hydratedPinnedUrlsRef.current.clear();
  }, []);

  const setViewport = (next: WorkflowViewport | ((prev: WorkflowViewport) => WorkflowViewport), recordHistory = false) => {
    commitGraph(
      (prev) => ({
        ...prev,
        viewport: typeof next === 'function' ? next(prev.viewport) : next,
      }),
      recordHistory,
    );
  };

  const addNode = (kind: NodeKind, worldPosition: XYPosition, config?: WorkflowNode['config']) => {
    const position = snap(worldPosition);
    const created: WorkflowNode = { id: makeId(kind), kind, x: position.x, y: position.y, ...(config ? { config } : {}) };
    commitGraph((prev) => ({ ...prev, nodes: [...prev.nodes, created] }), true);
    setSelectedNodeIds([created.id]);
    setSelectedGroupId(null);
    return created;
  };

  const addNodeFromConnection = (
    kind: NodeKind,
    worldPosition: XYPosition,
    connection: PendingConnection,
  ) => {
    const position = snap(worldPosition);
    const created: WorkflowNode = { id: makeId(kind), kind, x: position.x, y: position.y };
    const targetPort = NODE_DEFS[kind].inputs.find((port) => {
      const source = graph.nodes.find((node) => node.id === connection.fromNode);
      return canConnectEdge(source, connection.fromPort, created, port.key);
    })?.key;

    commitGraph((prev) => {
      const source = prev.nodes.find((node) => node.id === connection.fromNode);
      const canConnect = !!targetPort && canConnectEdge(source, connection.fromPort, created, targetPort);
      return {
        ...prev,
        nodes: [...prev.nodes, created],
        edges: canConnect
          ? upsertEdgeToInput(prev.edges, connection, created.id, targetPort)
          : prev.edges,
      };
    }, true);
    setPendingConnection(null);
    setSelectedNodeIds([created.id]);
    setSelectedGroupId(null);
    return created;
  };

  const removeSelected = () => {
    if (selectedNodeIds.length === 0 && !selectedGroupId) return;
    if (selectedGroupId) {
      commitGraph(
        (prev) => ({
          ...prev,
          groups: prev.groups.filter((group) => group.id !== selectedGroupId),
        }),
        true,
      );
      setSelectedGroupId(null);
      return;
    }
    commitGraph((prev) => {
      let nextNodes = prev.nodes;
      let nextEdges = prev.edges;
      let nextGroups = prev.groups;
      for (const id of selectedNodeIds) {
        const removed = removeNodeAndEdges(nextNodes, nextEdges, nextGroups, id);
        nextNodes = removed.nodes;
        nextEdges = removed.edges;
        nextGroups = removed.groups;
      }
      return {
        ...prev,
        nodes: nextNodes,
        edges: nextEdges,
        groups: updateGroupsWithNodes(nextGroups, nextNodes),
      };
    });
    setSelectedNodeIds([]);
  };

  const removeNode = (nodeId: string) => {
    commitGraph((prev) => {
      const removed = removeNodeAndEdges(prev.nodes, prev.edges, prev.groups, nodeId);
      return {
        ...prev,
        nodes: removed.nodes,
        edges: removed.edges,
        groups: updateGroupsWithNodes(removed.groups, removed.nodes),
      };
    });
    setSelectedNodeIds((prev) => prev.filter((id) => id !== nodeId));
  };

  const removeGroup = (groupId: string) => {
    commitGraph((prev) => ({ ...prev, groups: prev.groups.filter((group) => group.id !== groupId) }));
    if (selectedGroupId === groupId) setSelectedGroupId(null);
  };

  const selectSingleNode = (id: string, additive = false) => {
    setSelectedGroupId(null);
    setSelectedNodeIds((prev) => {
      if (!additive) return [id];
      return prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id];
    });
  };

  const selectGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedNodeIds([]);
  };

  const clearSelection = () => {
    setSelectedNodeIds([]);
    setSelectedGroupId(null);
  };

  const selectAllNodes = () => {
    setSelectedGroupId(null);
    setSelectedNodeIds(graph.nodes.map((node) => node.id));
  };

  const startNodeDrag = (id: string, world: XYPosition, additive = false) => {
    let ids = selectedNodeIds;
    if (!ids.includes(id)) {
      ids = additive ? [...selectedNodeIds, id] : [id];
      setSelectedNodeIds(ids);
      setSelectedGroupId(null);
    }
    const origin: Record<string, XYPosition> = {};
    graph.nodes.forEach((node) => {
      if (ids.includes(node.id)) origin[node.id] = { x: node.x, y: node.y };
    });
    pushHistory(graph);
    const next: DragState = { kind: 'node', nodeIds: ids, start: world, origin };
    dragRef.current = next;
    setDragState(next);
  };

  const startGroupDrag = (groupId: string, world: XYPosition) => {
    const group = graph.groups.find((item) => item.id === groupId);
    if (!group) return;
    const origin: Record<string, XYPosition> = {};
    graph.nodes.forEach((node) => {
      if (group.nodeIds.includes(node.id)) origin[node.id] = { x: node.x, y: node.y };
    });
    pushHistory(graph);
    const next: DragState = { kind: 'group', groupId, nodeIds: group.nodeIds, start: world, origin };
    dragRef.current = next;
    setDragState(next);
    setSelectedGroupId(groupId);
    setSelectedNodeIds([]);
  };

  const moveDrag = (world: XYPosition) => {
    const ds = dragRef.current;
    if (!ds) return;
    const dx = world.x - ds.start.x;
    const dy = world.y - ds.start.y;
    commitGraph(
      (prev) => {
        const moved = prev.nodes.map((node) => {
          if (!ds.nodeIds.includes(node.id)) return node;
          const origin = ds.origin[node.id];
          return {
            ...node,
            ...snap({ x: origin.x + dx, y: origin.y + dy }),
          };
        });
        return {
          ...prev,
          nodes: moved,
          groups: updateGroupsWithNodes(prev.groups, moved),
        };
      },
      false,
    );
  };

  const endDrag = () => {
    dragRef.current = null;
    setDragState(null);
  };

  const startPan = (client: XYPosition) => {
    setPanning({ start: client, origin: { x: graph.viewport.x, y: graph.viewport.y } });
  };

  const panTo = (client: XYPosition) => {
    if (!panning) return;
    const dx = client.x - panning.start.x;
    const dy = client.y - panning.start.y;
    setViewport((prev) => ({ ...prev, x: panning.origin.x + dx, y: panning.origin.y + dy }), false);
  };

  const endPan = () => setPanning(null);

  const zoomAt = (client: XYPosition, containerRect: DOMRect, deltaY: number) => {
    const factor = deltaY < 0 ? 1.08 : 0.92;
    const nextScale = clampScale(graph.viewport.scale * factor);
    const px = client.x - containerRect.left;
    const py = client.y - containerRect.top;
    const wx = (px - graph.viewport.x) / graph.viewport.scale;
    const wy = (py - graph.viewport.y) / graph.viewport.scale;
    setViewport({
      x: px - wx * nextScale,
      y: py - wy * nextScale,
      scale: nextScale,
    }, false);
  };

  const startConnection = (fromNode: string, fromPort: string, world: XYPosition) => {
    setPendingConnection({ fromNode, fromPort, mouseX: world.x, mouseY: world.y });
  };

  const moveConnection = (world: XYPosition) => {
    setPendingConnection((prev) => (prev ? { ...prev, mouseX: world.x, mouseY: world.y } : null));
  };

  const commitConnection = (toNode: string, toPort: string) => {
    if (!pendingConnection) return;
    const source = nodeMap.get(pendingConnection.fromNode);
    const target = nodeMap.get(toNode);
    if (!canConnectEdge(source, pendingConnection.fromPort, target, toPort)) {
      setPendingConnection(null);
      return;
    }
    commitGraph((prev) => ({
      ...prev,
      edges: upsertEdgeToInput(prev.edges, pendingConnection, toNode, toPort),
    }));
    setPendingConnection(null);
  };

  const cancelConnection = () => setPendingConnection(null);

  const deleteEdge = (id: string) => {
    commitGraph((prev) => ({
      ...prev,
      edges: prev.edges.filter((edge) => edge.id !== id),
    }));
  };

  const startSelection = (world: XYPosition) => {
    setSelectionBox({ startX: world.x, startY: world.y, currentX: world.x, currentY: world.y });
    setSelectedGroupId(null);
  };

  const moveSelection = (world: XYPosition) => {
    setSelectionBox((prev) => (prev ? { ...prev, currentX: world.x, currentY: world.y } : null));
  };

  const endSelection = (additive = false) => {
    if (!selectionBox) return;
    const matched = nodesInSelection(graph.nodes, selectionBox);
    setSelectedNodeIds((prev) => (additive ? Array.from(new Set([...prev, ...matched])) : matched));
    setSelectionBox(null);
  };

  const createGroupFromSelection = () => {
    if (selectedNodeIds.length < 2) return;
    const next = buildGroupFromNodes(`Group ${graph.groups.length + 1}`, selectedNodeIds, graph.nodes);
    if (!next) return;
    commitGraph((prev) => ({
      ...prev,
      groups: [...prev.groups, next],
    }));
    setSelectedGroupId(next.id);
    setSelectedNodeIds([]);
  };

  const fitViewToContent = (canvasWidth: number, canvasHeight: number) => {
    const contentNodes = graph.nodes.length > 0 ? graph.nodes : INITIAL_NODES;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of contentNodes) {
      const rect = {
        x: node.x,
        y: node.y,
        width: NODE_DEFS[node.kind].width,
        height: NODE_DEFS[node.kind].height,
      };
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
    for (const group of graph.groups) {
      minX = Math.min(minX, group.x);
      minY = Math.min(minY, group.y);
      maxX = Math.max(maxX, group.x + group.width);
      maxY = Math.max(maxY, group.y + group.height);
    }
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const padding = 120;
    const scale = clampScale(Math.min((canvasWidth - padding * 2) / width, (canvasHeight - padding * 2) / height));
    setViewport({
      scale,
      x: (canvasWidth - width * scale) / 2 - minX * scale,
      y: (canvasHeight - height * scale) / 2 - minY * scale,
    });
  };

  const copySelection = () => {
    const ids =
      selectedGroupId != null
        ? graph.groups.find((group) => group.id === selectedGroupId)?.nodeIds ?? []
        : selectedNodeIds;
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const selectedNodes = graph.nodes.filter((node) => idSet.has(node.id)).map((node) => ({ ...node }));
    const selectedEdges = graph.edges
      .filter((edge) => idSet.has(edge.fromNode) && idSet.has(edge.toNode))
      .map((edge) => ({ ...edge }));
    const selectedGroups = graph.groups
      .filter((group) => group.nodeIds.every((nodeId) => idSet.has(nodeId)))
      .map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));

    const anchorX = Math.min(...selectedNodes.map((node) => node.x));
    const anchorY = Math.min(...selectedNodes.map((node) => node.y));
    clipboardRef.current = {
      nodes: selectedNodes,
      edges: selectedEdges,
      groups: selectedGroups,
      anchor: { x: anchorX, y: anchorY },
    };
    touchMeta();
  };

  const cutSelection = () => {
    if ((selectedGroupId == null && selectedNodeIds.length === 0) || activeNodeId) return;
    copySelection();
    removeSelected();
  };

  const pasteFromClipboard = (worldPosition?: XYPosition) => {
    const data = clipboardRef.current;
    if (!data || data.nodes.length === 0) return;
    const offset = worldPosition
      ? { x: worldPosition.x - data.anchor.x, y: worldPosition.y - data.anchor.y }
      : { x: PASTE_OFFSET, y: PASTE_OFFSET };

    const idMap = new Map<string, string>();
    const pastedNodes = data.nodes.map((node) => {
      const id = makeId(node.kind);
      idMap.set(node.id, id);
      return {
        ...node,
        id,
        x: snap({ x: node.x + offset.x, y: node.y + offset.y }).x,
        y: snap({ x: node.x + offset.x, y: node.y + offset.y }).y,
      };
    });

    const pastedEdges = data.edges
      .map((edge) => {
        const fromNode = idMap.get(edge.fromNode);
        const toNode = idMap.get(edge.toNode);
        if (!fromNode || !toNode) return null;
        return { ...edge, id: makeId('edge'), fromNode, toNode };
      })
      .filter((edge): edge is WorkflowEdge => !!edge);

    const pastedGroups = data.groups
      .map((group) => {
        const mappedNodeIds = group.nodeIds.map((nodeId) => idMap.get(nodeId)).filter((id): id is string => !!id);
        if (mappedNodeIds.length === 0) return null;
        return {
          ...group,
          id: makeId('group'),
          nodeIds: mappedNodeIds,
          title: `${group.title} Copy`,
        };
      })
      .filter((group): group is WorkflowGroup => !!group);

    commitGraph((prev) => {
      const mergedNodes = [...prev.nodes, ...pastedNodes];
      const mergedGroups = updateGroupsWithNodes([...prev.groups, ...pastedGroups], mergedNodes);
      const normalizedEdges = normalizeWorkflowEdges(mergedNodes, [...prev.edges, ...pastedEdges]);
      return {
        ...prev,
        nodes: mergedNodes,
        edges: normalizedEdges,
        groups: mergedGroups,
      };
    });

    setSelectedNodeIds(pastedNodes.map((node) => node.id));
    setSelectedGroupId(null);
  };

  const alignSelectedNodes = (mode: AlignMode) => {
    if (selectedNodeIds.length < 2) return;
    const idSet = new Set(selectedNodeIds);
    const selectedNodes = graph.nodes.filter((node) => idSet.has(node.id));
    if (selectedNodes.length < 2) return;

    const left = Math.min(...selectedNodes.map((node) => node.x));
    const top = Math.min(...selectedNodes.map((node) => node.y));
    const right = Math.max(...selectedNodes.map((node) => node.x + NODE_DEFS[node.kind].width));
    const bottom = Math.max(...selectedNodes.map((node) => node.y + NODE_DEFS[node.kind].height));
    const center = (left + right) / 2;
    const middle = (top + bottom) / 2;

    commitGraph((prev) => {
      const nextNodes = prev.nodes.map((node) => {
        if (!idSet.has(node.id)) return node;
        const width = NODE_DEFS[node.kind].width;
        const height = NODE_DEFS[node.kind].height;
        if (mode === 'left') return { ...node, x: snap({ x: left, y: node.y }).x };
        if (mode === 'center') return { ...node, x: snap({ x: center - width / 2, y: node.y }).x };
        if (mode === 'right') return { ...node, x: snap({ x: right - width, y: node.y }).x };
        if (mode === 'top') return { ...node, y: snap({ x: node.x, y: top }).y };
        if (mode === 'middle') return { ...node, y: snap({ x: node.x, y: middle - height / 2 }).y };
        return { ...node, y: snap({ x: node.x, y: bottom - height }).y };
      });
      return {
        ...prev,
        nodes: nextNodes,
        groups: updateGroupsWithNodes(prev.groups, nextNodes),
      };
    });
  };

  const distributeSelectedNodes = (mode: DistributeMode) => {
    if (selectedNodeIds.length < 3) return;
    const idSet = new Set(selectedNodeIds);
    const selectedNodes = graph.nodes.filter((node) => idSet.has(node.id));
    if (selectedNodes.length < 3) return;

    if (mode === 'horizontal') {
      const sorted = [...selectedNodes].sort((a, b) => a.x - b.x);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = last.x - first.x;
      if (span <= 0) return;
      const step = span / (sorted.length - 1);
      const targetX = new Map<string, number>();
      sorted.forEach((node, idx) => targetX.set(node.id, first.x + step * idx));
      commitGraph((prev) => {
        const nextNodes = prev.nodes.map((node) => {
          const tx = targetX.get(node.id);
          if (tx == null) return node;
          return { ...node, x: snap({ x: tx, y: node.y }).x };
        });
        return { ...prev, nodes: nextNodes, groups: updateGroupsWithNodes(prev.groups, nextNodes) };
      });
      return;
    }

    const sorted = [...selectedNodes].sort((a, b) => a.y - b.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last.y - first.y;
    if (span <= 0) return;
    const step = span / (sorted.length - 1);
    const targetY = new Map<string, number>();
    sorted.forEach((node, idx) => targetY.set(node.id, first.y + step * idx));
    commitGraph((prev) => {
      const nextNodes = prev.nodes.map((node) => {
        const ty = targetY.get(node.id);
        if (ty == null) return node;
        return { ...node, y: snap({ x: node.x, y: ty }).y };
      });
      return { ...prev, nodes: nextNodes, groups: updateGroupsWithNodes(prev.groups, nextNodes) };
    });
  };

  const autoArrange = () => {
    if (graph.nodes.length === 0) return;
    const nodeOrder = new Map(graph.nodes.map((node, index) => [node.id, index]));
    const outgoing = new Map<string, string[]>();
    const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
    const layers = new Map(graph.nodes.map((node) => [node.id, 0]));

    graph.edges.forEach((edge) => {
      if (!indegree.has(edge.fromNode) || !indegree.has(edge.toNode)) return;
      outgoing.set(edge.fromNode, [...(outgoing.get(edge.fromNode) ?? []), edge.toNode]);
      indegree.set(edge.toNode, (indegree.get(edge.toNode) ?? 0) + 1);
    });

    const queue = graph.nodes
      .filter((node) => (indegree.get(node.id) ?? 0) === 0)
      .sort((a, b) => (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0))
      .map((node) => node.id);
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      visited.add(current);
      for (const next of outgoing.get(current) ?? []) {
        layers.set(next, Math.max(layers.get(next) ?? 0, (layers.get(current) ?? 0) + 1));
        indegree.set(next, (indegree.get(next) ?? 1) - 1);
        if ((indegree.get(next) ?? 0) === 0) {
          queue.push(next);
        }
      }
    }

    graph.nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        layers.set(node.id, Math.max(layers.get(node.id) ?? 0, 0));
      }
    });

    const nodesByLayer = new Map<number, WorkflowNode[]>();
    graph.nodes.forEach((node) => {
      const layer = layers.get(node.id) ?? 0;
      nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), node]);
    });

    const arranged = new Map<string, XYPosition>();
    const origin = { x: 220, y: 160 };
    const columnGap = 380;
    const rowGap = 220;

    Array.from(nodesByLayer.entries())
      .sort(([a], [b]) => a - b)
      .forEach(([layer, nodes]) => {
        nodes
          .sort((a, b) => (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0))
          .forEach((node, index) => {
            arranged.set(node.id, snap({
              x: origin.x + layer * columnGap,
              y: origin.y + index * rowGap,
            }));
          });
      });

    commitGraph((prev) => {
      const nextNodes = prev.nodes.map((node) => ({
        ...node,
        ...(arranged.get(node.id) ?? { x: node.x, y: node.y }),
      }));
      return {
        ...prev,
        nodes: nextNodes,
        groups: updateGroupsWithNodes(prev.groups, nextNodes),
      };
    });
  };

  const undo = () => {
    if (historyPastRef.current.length === 0) return;
    const previous = historyPastRef.current[historyPastRef.current.length - 1];
    historyPastRef.current = historyPastRef.current.slice(0, -1);
    historyFutureRef.current = [cloneGraph(graph), ...historyFutureRef.current].slice(0, HISTORY_LIMIT);
    const restored = cloneGraph(previous);
    hasLocalEditsRef.current = true;
    setGraph(restored);
    persistGraph(restored);
    touchMeta();
    clearSelection();
  };

  const redo = () => {
    if (historyFutureRef.current.length === 0) return;
    const next = historyFutureRef.current[0];
    historyFutureRef.current = historyFutureRef.current.slice(1);
    historyPastRef.current = [...historyPastRef.current, cloneGraph(graph)].slice(-HISTORY_LIMIT);
    const restored = cloneGraph(next);
    hasLocalEditsRef.current = true;
    setGraph(restored);
    persistGraph(restored);
    touchMeta();
    clearSelection();
  };

  const updateNodeConfig = (nodeId: string, updates: Partial<NodeConfig>, recordHistory = false) => {
    commitGraph(
      (prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => {
          if (node.id !== nodeId) return node;
          return {
            ...node,
            config: {
              ...node.config,
              ...updates,
            },
          };
        }),
      }),
      recordHistory,
    );
  };

  /** Replace the entire graph from a template or imported workflow */
  const loadTemplate = (template: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; groups?: WorkflowGroup[]; viewport?: WorkflowViewport }) => {
    const nodes = template.nodes
      .filter((node): node is WorkflowNode => !!node && isKnownNodeKind(node.kind))
      .map(n => ({ ...n }));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const newGraph: GraphState = {
      nodes,
      edges: normalizeWorkflowEdges(nodes, template.edges.map(e => ({ ...e }))),
      groups: (template.groups ?? [])
        .map(g => ({ ...g, nodeIds: [...g.nodeIds].filter((nodeId) => nodeIds.has(nodeId)) }))
        .filter((group) => group.nodeIds.length > 0),
      viewport: template.viewport ?? { x: -120, y: -80, scale: 0.86 },
    };
    historyPastRef.current = [...historyPastRef.current, cloneGraph(graph)].slice(-HISTORY_LIMIT);
    historyFutureRef.current = [];
    hasLocalEditsRef.current = true;
    setGraph(newGraph);
    persistGraph(newGraph);
    touchMeta();
    clearSelection();
  };

  const replaceGraph = (template: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; groups?: WorkflowGroup[]; viewport?: WorkflowViewport }) => {
    const nodes = template.nodes
      .filter((node): node is WorkflowNode => !!node && isKnownNodeKind(node.kind))
      .map(n => ({ ...n }));
    if (nodes.length === 0) return;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const nextGraph: GraphState = {
      nodes,
      edges: normalizeWorkflowEdges(nodes, (template.edges ?? []).map(e => ({ ...e }))),
      groups: (template.groups ?? [])
        .map(g => ({ ...g, nodeIds: [...g.nodeIds].filter((nodeId) => nodeIds.has(nodeId)) }))
        .filter((group) => group.nodeIds.length > 0),
      viewport: template.viewport ?? graph.viewport,
    };
    historyPastRef.current = [];
    historyFutureRef.current = [];
    hasLocalEditsRef.current = false;
    setGraph(nextGraph);
    persistGraph(nextGraph);
    touchMeta();
    clearSelection();
  };

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    groups: graph.groups,
    viewport: graph.viewport,
    selectedNodeIds,
    selectedGroupId,
    pendingConnection,
    selectionBox,
    activeNodeId,
    nodeMap,
    gridSnapEnabled,
    canUndo,
    canRedo,
    canPaste,
    setViewport,
    setGridSnapEnabled,
    setActiveNodeId,
    addNode,
    addNodeFromConnection,
    removeNode,
    removeGroup,
    removeSelected,
    selectSingleNode,
    selectGroup,
    clearSelection,
    selectAllNodes,
    startNodeDrag,
    startGroupDrag,
    moveDrag,
    endDrag,
    startPan,
    panTo,
    endPan,
    zoomAt,
    startConnection,
    moveConnection,
    commitConnection,
    cancelConnection,
    deleteEdge,
    startSelection,
    moveSelection,
    endSelection,
    createGroupFromSelection,
    fitViewToContent,
    copySelection,
    cutSelection,
    pasteFromClipboard,
    alignSelectedNodes,
    distributeSelectedNodes,
    autoArrange,
    undo,
    redo,
    updateNodeConfig,
    loadTemplate,
    replaceGraph,
  };
}

