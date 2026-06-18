import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createWorkflowNode } from './constants';
import { applyWorkflowOps, validateWorkflowConnection } from './ops';
import { WorkflowConnections } from './WorkflowConnections';
import { WorkflowContextMenu, type WorkflowContextMenuState } from './WorkflowContextMenu';
import { WorkflowCreateMenu, type WorkflowCreateMenuState } from './WorkflowCreateMenu';
import type { WorkflowSharedMedia } from './WorkflowConfigPanel';
import { WorkflowMiniMap } from './WorkflowMiniMap';
import { WorkflowNode } from './WorkflowNode';
import { WorkflowToolbar, type WorkflowTool } from './WorkflowToolbar';
import type { WorkflowConnection, WorkflowNode as WorkflowNodeData, WorkflowNodeType, WorkflowOp, WorkflowPoint, WorkflowProject, WorkflowSnapshot, WorkflowViewport } from './types';

type Frame = Pick<WorkflowProject, 'nodes' | 'connections'>;
type SelectionBox = { start: WorkflowPoint; current: WorkflowPoint; additive: boolean; initialIds: string[] };
type Interaction = { pointerId: number } & (
  | { type: 'node'; start: WorkflowPoint; positions: Map<string, WorkflowPoint>; frame: Frame; moved: boolean }
  | { type: 'resize'; id: string; start: WorkflowPoint; width: number; height: number; frame: Frame; moved: boolean }
  | { type: 'pan'; start: WorkflowPoint; viewport: WorkflowViewport }
  | { type: 'selection'; box: SelectionBox }
  | { type: 'connection'; sourceId: string });
type ConnectionDropTarget = { nodeId: string | null; isNearNode: boolean; reason?: string };

const BLOCKED_TARGET = 'button,textarea,input,select,video,audio,[contenteditable="true"],[role="dialog"],[data-workflow-overlay],.workflow-toolbar';
const EDITABLE_TARGET = 'textarea,input,select,video,audio,[contenteditable="true"]';
const SPACE_BLOCKED_TARGET = `${EDITABLE_TARGET},[role="menu"],[role="dialog"]`;
const CONNECTION_NODE_PADDING = 24;
const CONNECTION_HANDLE_RADIUS = 18;

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function InfiniteWorkflow({
  project,
  updateProject,
  onRunNode,
  onOpenAgent,
}: {
  project: WorkflowProject;
  updateProject: (patch: Partial<WorkflowProject>) => void;
  onRunNode: (nodeId: string) => void;
  onOpenAgent: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project);
  const viewportRef = useRef(project.viewport);
  const selectedIdsRef = useRef(project.selectedNodeIds || []);
  const interactionRef = useRef<Interaction | null>(null);
  const pendingMoveRef = useRef<{ clientX: number; clientY: number; pointerId: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const spacePressedRef = useRef(false);
  const clipboardRef = useRef<WorkflowNodeData[]>([]);
  const [tool, setTool] = useState<WorkflowTool>('select');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(project.selectedNodeIds || []);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [past, setPast] = useState<Frame[]>([]);
  const [future, setFuture] = useState<Frame[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<{ sourceId: string; point: WorkflowPoint; targetId: string | null } | null>(null);
  const [createMenu, setCreateMenu] = useState<WorkflowCreateMenuState | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkflowContextMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  projectRef.current = project;
  viewportRef.current = project.viewport;

  const patchProject = useCallback((patch: Partial<WorkflowProject>) => {
    projectRef.current = { ...projectRef.current, ...patch };
    if (patch.viewport) viewportRef.current = patch.viewport;
    updateProject(patch);
  }, [updateProject]);

  const selectNodes = useCallback((ids: string[]) => {
    if (sameIds(selectedIdsRef.current, ids) && sameIds(projectRef.current.selectedNodeIds || [], ids)) return;
    selectedIdsRef.current = ids;
    setSelectedNodeIds(ids);
    patchProject({ selectedNodeIds: ids });
  }, [patchProject]);

  useEffect(() => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    pendingMoveRef.current = null;
    setSelectedConnectionId(null);
    setPast([]);
    setFuture([]);
    setSelectionBox(null);
    setConnectionDrag(null);
    setCreateMenu(null);
    interactionRef.current = null;
  }, [project.id]);

  useEffect(() => {
    const ids = project.selectedNodeIds || [];
    if (sameIds(selectedIdsRef.current, ids)) return;
    selectedIdsRef.current = ids;
    setSelectedNodeIds(ids);
  }, [project.id, project.selectedNodeIds]);

  const currentFrame = useCallback((): Frame => ({
    nodes: projectRef.current.nodes,
    connections: projectRef.current.connections,
  }), []);

  const currentSnapshot = useCallback((): WorkflowSnapshot => ({
    projectId: projectRef.current.id,
    title: projectRef.current.title,
    nodes: projectRef.current.nodes,
    connections: projectRef.current.connections,
    selectedNodeIds: selectedIdsRef.current,
    viewport: viewportRef.current,
  }), []);

  const pushHistory = useCallback((frame: Frame) => {
    setPast(items => [...items.slice(-49), frame]);
    setFuture([]);
  }, []);

  const applyFrame = useCallback((frame: Frame) => {
    patchProject(frame);
    const existing = new Set(frame.nodes.map(node => node.id));
    selectNodes(selectedIdsRef.current.filter(id => existing.has(id)));
  }, [patchProject, selectNodes]);

  const commitFrame = useCallback((nodes: WorkflowNodeData[], connections: WorkflowConnection[]) => {
    pushHistory(currentFrame());
    patchProject({ nodes, connections });
  }, [currentFrame, patchProject, pushHistory]);

  const applyOps = useCallback((ops: WorkflowOp[]) => {
    const result = applyWorkflowOps(currentSnapshot(), ops);
    const rejection = result.rejections[0];
    if (rejection) {
      setNotice(rejection.reason);
      return false;
    }
    commitFrame(result.snapshot.nodes, result.snapshot.connections);
    selectNodes(result.snapshot.selectedNodeIds);
    setNotice(null);
    return true;
  }, [commitFrame, currentSnapshot, selectNodes]);

  const screenToWorkflow = useCallback((clientX: number, clientY: number): WorkflowPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    const viewport = viewportRef.current;
    return {
      x: (clientX - (rect?.left || 0) - viewport.x) / viewport.k,
      y: (clientY - (rect?.top || 0) - viewport.y) / viewport.k,
    };
  }, []);

  const localPoint = useCallback((clientX: number, clientY: number): WorkflowPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) };
  }, []);

  const openCreateMenu = useCallback((clientX: number, clientY: number, sourceId?: string) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const local = localPoint(clientX, clientY);
    setCreateMenu({
      world: screenToWorkflow(clientX, clientY),
      anchor: {
        x: Math.max(8, Math.min(local.x, (rect?.width || 1000) - 296)),
        y: Math.max(8, Math.min(local.y, (rect?.height || 700) - 360)),
      },
      sourceId,
    });
    setContextMenu(null);
  }, [localPoint, screenToWorkflow]);

  const getConnectionDropTarget = useCallback((clientX: number, clientY: number, sourceId: string): ConnectionDropTarget => {
    const world = screenToWorkflow(clientX, clientY);
    const scale = Math.max(viewportRef.current.k, 0.05);
    const padding = CONNECTION_NODE_PADDING / scale;
    const handleRadius = CONNECTION_HANDLE_RADIUS / scale;
    let bestId: string | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    let isNearNode = false;
    let reason: string | undefined;
    const snapshot = currentSnapshot();

    [...projectRef.current.nodes].reverse().forEach(node => {
      const anchorX = node.position.x;
      const anchorY = node.position.y + node.height / 2;
      const dx = world.x - anchorX;
      const dy = world.y - anchorY;
      const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
      const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
      const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;
      if (!hitsHandle && !hitsInside && !hitsExpanded) return;
      isNearNode = true;
      const validation = validateWorkflowConnection(snapshot, sourceId, node.id);
      if (!validation.ok) {
        reason ||= validation.reason;
        return;
      }
      const priority = hitsHandle ? 0 : hitsInside ? 1 : 2;
      if (priority < bestPriority) {
        bestId = node.id;
        bestPriority = priority;
      }
    });
    return { nodeId: bestId, isNearNode, reason };
  }, [currentSnapshot, screenToWorkflow]);

  const updateInteraction = useCallback((clientX: number, clientY: number, pointerId: number) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== pointerId) return;
    if (interaction.type === 'node') {
      const point = screenToWorkflow(clientX, clientY);
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      interaction.moved = dx !== 0 || dy !== 0;
      patchProject({ nodes: interaction.frame.nodes.map(node => {
        const start = interaction.positions.get(node.id);
        return start ? { ...node, position: { x: start.x + dx, y: start.y + dy } } : node;
      }) });
      return;
    }
    if (interaction.type === 'resize') {
      const point = screenToWorkflow(clientX, clientY);
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      const width = Math.max(180, interaction.width + dx);
      const height = Math.max(100, interaction.height + dy);
      interaction.moved = width !== interaction.width || height !== interaction.height;
      patchProject({ nodes: interaction.frame.nodes.map(node => node.id === interaction.id
        ? { ...node, width, height }
        : node) });
      return;
    }
    if (interaction.type === 'pan') {
      const point = localPoint(clientX, clientY);
      patchProject({ viewport: {
        ...interaction.viewport,
        x: interaction.viewport.x + point.x - interaction.start.x,
        y: interaction.viewport.y + point.y - interaction.start.y,
      } });
      return;
    }
    if (interaction.type === 'selection') {
      const current = screenToWorkflow(clientX, clientY);
      interaction.box = { ...interaction.box, current };
      const left = Math.min(interaction.box.start.x, current.x);
      const right = Math.max(interaction.box.start.x, current.x);
      const top = Math.min(interaction.box.start.y, current.y);
      const bottom = Math.max(interaction.box.start.y, current.y);
      const ids = projectRef.current.nodes
        .filter(node => node.position.x < right && node.position.x + node.width > left && node.position.y < bottom && node.position.y + node.height > top)
        .map(node => node.id);
      selectNodes(interaction.box.additive ? Array.from(new Set([...interaction.box.initialIds, ...ids])) : ids);
      setSelectionBox(interaction.box);
      return;
    }
    const dropTarget = getConnectionDropTarget(clientX, clientY, interaction.sourceId);
    setConnectionDrag({ sourceId: interaction.sourceId, point: screenToWorkflow(clientX, clientY), targetId: dropTarget.nodeId });
  }, [getConnectionDropTarget, localPoint, patchProject, screenToWorkflow, selectNodes]);

  const scheduleInteractionMove = useCallback((clientX: number, clientY: number, pointerId: number) => {
    if (interactionRef.current?.pointerId !== pointerId) return;
    pendingMoveRef.current = { clientX, clientY, pointerId };
    if (animationFrameRef.current !== null) return;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const pending = pendingMoveRef.current;
      pendingMoveRef.current = null;
      if (pending) updateInteraction(pending.clientX, pending.clientY, pending.pointerId);
    });
  }, [updateInteraction]);

  const flushPendingMove = useCallback(() => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    const pending = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (pending) updateInteraction(pending.clientX, pending.clientY, pending.pointerId);
  }, [updateInteraction]);

  const finishInteraction = useCallback((clientX: number, clientY: number, pointerId: number) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== pointerId) return;
    flushPendingMove();
    updateInteraction(clientX, clientY, pointerId);
    interactionRef.current = null;
    if (interaction.type === 'node' || interaction.type === 'resize') {
      if (interaction.moved) pushHistory(interaction.frame);
      return;
    }
    if (interaction.type === 'selection') {
      setSelectionBox(null);
      return;
    }
    if (interaction.type !== 'connection') return;

    const dropTarget = getConnectionDropTarget(clientX, clientY, interaction.sourceId);
    setConnectionDrag(null);
    if (dropTarget.nodeId) {
      applyOps([{ type: 'connect_nodes', fromNodeId: interaction.sourceId, toNodeId: dropTarget.nodeId }]);
    } else if (dropTarget.isNearNode) {
      setNotice(dropTarget.reason || '无法连接到该节点');
    } else {
      openCreateMenu(clientX, clientY, interaction.sourceId);
    }
  }, [applyOps, flushPendingMove, getConnectionDropTarget, openCreateMenu, pushHistory, updateInteraction]);

  const cancelInteraction = useCallback((pointerId?: number) => {
    const interaction = interactionRef.current;
    if (pointerId !== undefined && interaction?.pointerId !== pointerId) return;
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    animationFrameRef.current = null;
    pendingMoveRef.current = null;
    interactionRef.current = null;
    if (interaction?.type === 'node' || interaction?.type === 'resize') patchProject(interaction.frame);
    if (interaction?.type === 'pan') patchProject({ viewport: interaction.viewport });
    if (interaction?.type === 'selection') selectNodes(interaction.box.initialIds);
    setSelectionBox(null);
    setConnectionDrag(null);
    spacePressedRef.current = false;
  }, [patchProject, selectNodes]);

  useEffect(() => {
    const move = (event: PointerEvent) => scheduleInteractionMove(event.clientX, event.clientY, event.pointerId);
    const up = (event: PointerEvent) => finishInteraction(event.clientX, event.clientY, event.pointerId);
    const cancel = (event: PointerEvent) => cancelInteraction(event.pointerId);
    const blur = () => cancelInteraction();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur);
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
      pendingMoveRef.current = null;
    };
  }, [cancelInteraction, finishInteraction, scheduleInteractionMove]);

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast(items => items.slice(0, -1));
    setFuture(items => [currentFrame(), ...items].slice(0, 50));
    applyFrame(previous);
  }, [applyFrame, currentFrame, past]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture(items => items.slice(1));
    setPast(items => [...items.slice(-49), currentFrame()]);
    applyFrame(next);
  }, [applyFrame, currentFrame, future]);

  const copySelection = useCallback(() => {
    clipboardRef.current = projectRef.current.nodes.filter(node => selectedIdsRef.current.includes(node.id));
  }, []);

  const pasteSelection = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const nodes = clipboardRef.current.map(node => ({
      ...node,
      id: nanoid(),
      position: { x: node.position.x + 32, y: node.position.y + 32 },
      metadata: { ...node.metadata },
    }));
    commitFrame([...projectRef.current.nodes, ...nodes], projectRef.current.connections);
    selectNodes(nodes.map(node => node.id));
  }, [commitFrame, selectNodes]);

  const deleteSelection = useCallback(() => {
    if (selectedConnectionId) {
      commitFrame(projectRef.current.nodes, projectRef.current.connections.filter(connection => connection.id !== selectedConnectionId));
      setSelectedConnectionId(null);
      return;
    }
    if (selectedIdsRef.current.length) applyOps([{ type: 'delete_nodes', ids: selectedIdsRef.current }]);
  }, [applyOps, commitFrame, selectedConnectionId]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.code === 'Space') {
        if (target?.closest(SPACE_BLOCKED_TARGET)) return;
        event.preventDefault();
        spacePressedRef.current = true;
        return;
      }
      if (target?.closest(BLOCKED_TARGET)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && key === 'y') { event.preventDefault(); redo(); return; }
      if (modifier && key === 'c') { event.preventDefault(); copySelection(); return; }
      if (modifier && key === 'v') { event.preventDefault(); pasteSelection(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') {
        setCreateMenu(null);
        setContextMenu(null);
        cancelInteraction();
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === 'Space') spacePressedRef.current = false;
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('keyup', keyup);
    };
  }, [cancelInteraction, copySelection, deleteSelection, pasteSelection, redo, undo]);

  const addNode = useCallback((type: WorkflowNodeType, metadata: WorkflowNodeData['metadata'] = {}) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const center = screenToWorkflow((rect?.left || 0) + (rect?.width || 1000) / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
    applyOps([{ type: 'add_node', node: createWorkflowNode(nanoid(), type, { x: center.x - 170, y: center.y - 110 }, metadata) }]);
  }, [applyOps, screenToWorkflow]);

  const importFile = useCallback((file: File, type: 'image' | 'video') => {
    const reader = new FileReader();
    reader.onload = () => addNode(type, { href: String(reader.result || ''), mimeType: file.type, status: 'success' });
    reader.readAsDataURL(file);
  }, [addNode]);

  const createFromMenu = useCallback((type: WorkflowNodeType) => {
    if (!createMenu) return;
    const node = createWorkflowNode(nanoid(), type, createMenu.world);
    const success = createMenu.sourceId
      ? applyOps([{ type: 'create_connected_node', fromNodeId: createMenu.sourceId, node }])
      : applyOps([{ type: 'add_node', node }]);
    if (success) setCreateMenu(null);
  }, [applyOps, createMenu]);

  const fitView = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    const nodes = projectRef.current.nodes;
    if (!rect || nodes.length === 0) return;
    const minX = Math.min(...nodes.map(node => node.position.x));
    const minY = Math.min(...nodes.map(node => node.position.y));
    const maxX = Math.max(...nodes.map(node => node.position.x + node.width));
    const maxY = Math.max(...nodes.map(node => node.position.y + node.height));
    const k = Math.min(1.5, Math.max(0.12, Math.min((rect.width - 160) / Math.max(1, maxX - minX), (rect.height - 160) / Math.max(1, maxY - minY))));
    patchProject({ viewport: { x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k, k } });
  }, [patchProject]);

  const startPan = (clientX: number, clientY: number, pointerId: number) => {
    interactionRef.current = {
      type: 'pan',
      pointerId,
      start: localPoint(clientX, clientY),
      viewport: { ...viewportRef.current },
    };
  };

  const startNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNodeData) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(BLOCKED_TARGET))) return;
    event.stopPropagation();
    if (tool === 'pan' || spacePressedRef.current) {
      event.preventDefault();
      startPan(event.clientX, event.clientY, event.pointerId);
      return;
    }
    setContextMenu(null);
    setCreateMenu(null);
    setSelectedConnectionId(null);
    const modifier = event.shiftKey || event.ctrlKey || event.metaKey;
    let ids = selectedIdsRef.current;
    if (modifier) ids = ids.includes(node.id) ? ids.filter(id => id !== node.id) : [...ids, node.id];
    else if (!ids.includes(node.id)) ids = [node.id];
    selectNodes(ids);
    if (!ids.includes(node.id)) return;
    const frame = currentFrame();
    interactionRef.current = {
      type: 'node',
      pointerId: event.pointerId,
      start: screenToWorkflow(event.clientX, event.clientY),
      positions: new Map(frame.nodes.filter(item => ids.includes(item.id)).map(item => [item.id, { ...item.position }])),
      frame,
      moved: false,
    };
  };

  const isTrueBackground = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest(BLOCKED_TARGET)) return false;
    if (target.closest('[data-workflow-node-id],[data-workflow-connection-id]')) return false;
    return target === rootRef.current || target === worldRef.current || Boolean(target.closest('.workflow-world'));
  };

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTrueBackground(event.target)) return;
    setContextMenu(null);
    setCreateMenu(null);
    setNotice(null);
    setSelectedConnectionId(null);
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && tool === 'select') {
      event.preventDefault();
      const point = screenToWorkflow(event.clientX, event.clientY);
      const box = { start: point, current: point, additive: event.shiftKey, initialIds: [...selectedIdsRef.current] };
      interactionRef.current = { type: 'selection', pointerId: event.pointerId, box };
      setSelectionBox(box);
      if (!event.shiftKey) selectNodes([]);
      return;
    }
    if (event.button === 0 || event.button === 1) {
      event.preventDefault();
      startPan(event.clientX, event.clientY, event.pointerId);
      if (!event.shiftKey && !event.ctrlKey && !event.metaKey) selectNodes([]);
    }
  };

  const selectionStyle = selectionBox ? {
    left: Math.min(selectionBox.start.x, selectionBox.current.x),
    top: Math.min(selectionBox.start.y, selectionBox.current.y),
    width: Math.abs(selectionBox.current.x - selectionBox.start.x),
    height: Math.abs(selectionBox.current.y - selectionBox.start.y),
  } : undefined;
  const selectedNodes = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const gridSize = (project.backgroundMode === 'dots' ? 20 : 24) * project.viewport.k;

  return (
    <div
      ref={rootRef}
      data-testid="workflow-editor"
      className={`workflow-editor workflow-editor--${tool} workflow-bg--${project.backgroundMode}`}
      style={project.backgroundMode === 'none' ? { backgroundImage: 'none' } : {
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${project.viewport.x % gridSize}px ${project.viewport.y % gridSize}px`,
      }}
      onPointerDown={onSurfacePointerDown}
      onDoubleClick={event => {
        if (!isTrueBackground(event.target)) return;
        event.preventDefault();
        openCreateMenu(event.clientX, event.clientY);
      }}
      onWheel={event => {
        if (event.target instanceof Element && event.target.closest(BLOCKED_TARGET)) return;
        event.preventDefault();
        const rect = rootRef.current?.getBoundingClientRect();
        const world = screenToWorkflow(event.clientX, event.clientY);
        const k = Math.min(3, Math.max(0.12, viewportRef.current.k * Math.exp(-event.deltaY * 0.0015)));
        patchProject({ viewport: {
          x: event.clientX - (rect?.left || 0) - world.x * k,
          y: event.clientY - (rect?.top || 0) - world.y * k,
          k,
        } });
      }}
      onContextMenu={event => event.preventDefault()}
    >
      <WorkflowToolbar
        tool={tool}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onToolChange={setTool}
        onAddNode={addNode}
        onImport={importFile}
        onAddSharedMedia={(media: WorkflowSharedMedia) => addNode(media.type, { href: media.href, mimeType: media.mimeType, status: 'success' })}
        onUndo={undo}
        onRedo={redo}
        onFit={fitView}
        onToggleGrid={() => patchProject({ backgroundMode: projectRef.current.backgroundMode === 'none' ? 'dots' : projectRef.current.backgroundMode === 'dots' ? 'lines' : 'none' })}
        onOpenAgent={onOpenAgent}
      />
      <div ref={worldRef} className="workflow-world" style={{ transform: `translate(${project.viewport.x}px, ${project.viewport.y}px) scale(${project.viewport.k})` }}>
        <WorkflowConnections
          nodes={project.nodes}
          connections={project.connections}
          selectedId={selectedConnectionId}
          active={connectionDrag}
          onSelect={id => { setSelectedConnectionId(id); selectNodes([]); setContextMenu(null); }}
          onContextMenu={(event, id) => {
            setSelectedConnectionId(id);
            selectNodes([]);
            setContextMenu({ type: 'connection', id, x: event.clientX, y: event.clientY });
          }}
        />
        {project.nodes.map(node => (
          <WorkflowNode
            key={node.id}
            node={node}
            selected={selectedNodes.has(node.id)}
            onPointerDown={event => startNodeDrag(event, node)}
            onConnectStart={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              setCreateMenu(null);
              setContextMenu(null);
              setSelectedConnectionId(null);
              interactionRef.current = { type: 'connection', pointerId: event.pointerId, sourceId: node.id };
              setConnectionDrag({ sourceId: node.id, point: screenToWorkflow(event.clientX, event.clientY), targetId: null });
            }}
            onResizeStart={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const frame = currentFrame();
              interactionRef.current = { type: 'resize', pointerId: event.pointerId, id: node.id, start: screenToWorkflow(event.clientX, event.clientY), width: node.width, height: node.height, frame, moved: false };
            }}
            onChangeText={content => patchProject({ nodes: projectRef.current.nodes.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, content } } : item) })}
            onChangeMetadata={metadata => patchProject({
              nodes: projectRef.current.nodes.map(item => item.id === node.id
                ? { ...item, metadata: { ...item.metadata, ...metadata, config: metadata.config ? { ...item.metadata.config, ...metadata.config } : item.metadata.config } }
                : item),
            })}
            onRun={() => onRunNode(node.id)}
            onContextMenu={event => {
              setSelectedConnectionId(null);
              selectNodes([node.id]);
              setContextMenu({ type: 'node', id: node.id, x: event.clientX, y: event.clientY });
            }}
          />
        ))}
        {selectionStyle && <div className="workflow-selection-box" style={selectionStyle} />}
      </div>
      <WorkflowMiniMap nodes={project.nodes} viewport={project.viewport} onCenter={(x, y) => {
        const rect = rootRef.current?.getBoundingClientRect();
        patchProject({ viewport: { ...viewportRef.current, x: (rect?.width || 1000) / 2 - x * viewportRef.current.k, y: (rect?.height || 700) / 2 - y * viewportRef.current.k } });
      }} />
      <div className="workflow-zoom" data-workflow-overlay>{Math.round(project.viewport.k * 100)}%</div>
      {notice && <div role="status" aria-live="polite" data-workflow-overlay style={{ position: 'absolute', zIndex: 80, right: 14, top: 58, maxWidth: 320, padding: '7px 10px', border: '1px solid var(--wf-border)', borderRadius: 7, color: 'var(--wf-text)', background: 'var(--wf-panel)', fontSize: 12 }}>{notice}</div>}
      {createMenu && <WorkflowCreateMenu state={createMenu} onCreate={createFromMenu} onClose={() => setCreateMenu(null)} />}
      {contextMenu && (
        <WorkflowContextMenu
          state={contextMenu}
          onCopy={() => {
            if (contextMenu.type === 'node') clipboardRef.current = projectRef.current.nodes.filter(node => node.id === contextMenu.id);
            setContextMenu(null);
          }}
          onRun={() => { if (contextMenu.type === 'node') onRunNode(contextMenu.id); setContextMenu(null); }}
          onDelete={() => {
            if (contextMenu.type === 'node') applyOps([{ type: 'delete_nodes', ids: [contextMenu.id] }]);
            else {
              commitFrame(projectRef.current.nodes, projectRef.current.connections.filter(connection => connection.id !== contextMenu.id));
              setSelectedConnectionId(null);
            }
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}
