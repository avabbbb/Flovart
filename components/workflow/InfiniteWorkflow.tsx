import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ModelPreference, UserApiKey } from '../../types';
import { STUDIO_MEDIA_DRAG_TYPE } from '../studio/StudioMediaBrowser';
import { createWorkflowNode } from './constants';
import {
  discardWorkflowMediaRecord,
  fitWorkflowMediaSize,
  ingestWorkflowMedia,
  cropWorkflowImage,
  loadWorkflowMediaBlob,
  pruneWorkflowMedia,
  registerWorkflowMediaTransientReferences,
  releaseWorkflowMediaRecord,
  unregisterWorkflowMediaTransientReferences,
  useWorkflowMediaUrl,
  workflowMediaType,
  type WorkflowMediaRecord,
} from './media';
import { applyWorkflowOps, validateWorkflowConnection } from './ops';
import { WorkflowConnections } from './WorkflowConnections';
import { WorkflowContextMenu, type WorkflowContextMenuState } from './WorkflowContextMenu';
import { WorkflowCreateMenu, type WorkflowCreateMenuState } from './WorkflowCreateMenu';
import type { WorkflowSharedMedia } from './WorkflowConfigPanel';
import { WorkflowMiniMap } from './WorkflowMiniMap';
import { WorkflowNode } from './WorkflowNode';
import { WorkflowNodePromptBar, type WorkflowModelOptions } from './WorkflowNodePromptBar';
import { WorkflowNodeToolbar, type WorkflowImageToolHandlers } from './WorkflowNodeToolbar';
import { WorkflowImageToolDialogs, type WorkflowImageToolConfirmation, type WorkflowImageToolState } from './WorkflowImageToolDialogs';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import { WorkflowToolbar, type WorkflowTool } from './WorkflowToolbar';
import type { WorkflowConnection, WorkflowNode as WorkflowNodeData, WorkflowNodeType, WorkflowOp, WorkflowPoint, WorkflowProject, WorkflowSnapshot, WorkflowViewport } from './types';
import { runWorkflowImageAgent, runWorkflowImageEdit, runWorkflowImageSplit, type WorkflowImageToolOutcome, type WorkflowImageToolRuntime } from '../../services/workflowImageTools';
import { exportMediaArchive } from '../../utils/batchMediaExport';

type Frame = Pick<WorkflowProject, 'nodes' | 'connections'>;
type ImageToolTransaction = { id: string; projectId: string; nodeId: string; frame: Frame };
type SelectionBox = { start: WorkflowPoint; current: WorkflowPoint; additive: boolean; initialIds: string[] };
type Interaction = { pointerId: number } & (
  | { type: 'node'; start: WorkflowPoint; positions: Map<string, WorkflowPoint>; frame: Frame; moved: boolean }
  | { type: 'resize'; id: string; start: WorkflowPoint; width: number; height: number; frame: Frame; moved: boolean }
  | { type: 'pan'; start: WorkflowPoint; viewport: WorkflowViewport }
  | { type: 'selection'; box: SelectionBox }
  | { type: 'connection'; sourceId: string });
type ConnectionDropTarget = { nodeId: string | null; isNearNode: boolean; reason?: string };

const NODE_ACTION_TARGET = 'button,textarea,input,select,[contenteditable="true"],[role="dialog"],[data-workflow-overlay],.workflow-toolbar';
const BLOCKED_TARGET = `${NODE_ACTION_TARGET},video,audio`;
const EDITABLE_TARGET = 'textarea,input,select,video,audio,[contenteditable="true"]';
const SPACE_BLOCKED_TARGET = `${EDITABLE_TARGET},[role="menu"],[role="dialog"]`;
const CONNECTION_NODE_PADDING = 24;
const CONNECTION_HANDLE_RADIUS = 18;

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function workflowDropFiles(dataTransfer: DataTransfer) {
  const files = Array.from(dataTransfer.files || []);
  if (files.length) return files;
  return Array.from(dataTransfer.items || [])
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => Boolean(file));
}

function workflowDropSharedMedia(dataTransfer: DataTransfer): WorkflowSharedMedia | null {
  try {
    const raw = dataTransfer.getData(STUDIO_MEDIA_DRAG_TYPE);
    if (!raw) return null;
    const media = JSON.parse(raw) as WorkflowSharedMedia;
    return media?.id && media?.href && ['image', 'video'].includes(media.type) ? media : null;
  } catch {
    return null;
  }
}

export function InfiniteWorkflow({
  project,
  updateProject,
  onRunNode,
  onStopNode,
  onSaveWorkflowMedia,
  onReversePrompt,
  imageTools,
  onOpenAgent,
  t = key => key,
  theme = 'light',
  language = 'zho',
  userApiKeys = [],
  modelPreference = { textModel: '', imageModel: '', videoModel: '' },
  dynamicModelOptions = { text: [], image: [], video: [] },
  onOpenSettings,
}: {
  project: WorkflowProject;
  updateProject: (patch: Partial<WorkflowProject>) => void;
  onRunNode: (nodeId: string) => void;
  onStopNode?: (nodeId: string) => void;
  onSaveWorkflowMedia?: (nodeId: string) => void;
  onReversePrompt?: (imageHref: string, mimeType: string, width?: number, height?: number) => Promise<string>;
  imageTools?: WorkflowImageToolHandlers;
  onOpenAgent?: () => void;
  t?: (key: string, ...args: any[]) => string;
  theme?: 'light' | 'dark';
  language?: 'en' | 'zho';
  userApiKeys?: UserApiKey[];
  modelPreference?: ModelPreference;
  dynamicModelOptions?: WorkflowModelOptions;
  onOpenSettings?: () => void;
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
  const createMenuOpenerRef = useRef<HTMLElement | null>(null);
  const clipboardRef = useRef<WorkflowNodeData[]>([]);
  const mountedRef = useRef(true);
  const replaceSequenceRef = useRef(new Map<string, number>());
  const mediaReferenceOwnerRef = useRef(`workflow-editor-${nanoid()}`);
  const [tool, setTool] = useState<WorkflowTool>('select');
  const [wheelMode, setWheelMode] = useState<'pan' | 'zoom'>('pan');
  const [clipboardVersion, setClipboardVersion] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(project.selectedNodeIds || []);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [past, setPast] = useState<Frame[]>([]);
  const [future, setFuture] = useState<Frame[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<{ sourceId: string; point: WorkflowPoint; targetId: string | null } | null>(null);
  const [createMenu, setCreateMenu] = useState<WorkflowCreateMenuState | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkflowContextMenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [promptFocusSignal, setPromptFocusSignal] = useState(0);
  const [imageTool, setImageTool] = useState<WorkflowImageToolState | null>(null);
  const [imageToolBusy, setImageToolBusy] = useState(false);
  const [imageToolError, setImageToolError] = useState<string | null>(null);
  const imageToolBusyRef = useRef(false);
  const imageToolTransactionRef = useRef<ImageToolTransaction | null>(null);

  projectRef.current = project;
  viewportRef.current = project.viewport;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      unregisterWorkflowMediaTransientReferences(mediaReferenceOwnerRef.current);
      void pruneWorkflowMedia();
    };
  }, []);

  useEffect(() => {
    registerWorkflowMediaTransientReferences(mediaReferenceOwnerRef.current, [
      project.nodes,
      ...past.map(frame => frame.nodes),
      ...future.map(frame => frame.nodes),
      clipboardRef.current,
    ]);
    void pruneWorkflowMedia();
  }, [clipboardVersion, future, past, project.nodes]);

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

  const closeCreateMenu = useCallback(() => {
    setCreateMenu(null);
    const opener = createMenuOpenerRef.current || rootRef.current;
    createMenuOpenerRef.current = null;
    opener?.focus({ preventScroll: true });
  }, []);

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
    setImageTool(null);
    setImageToolBusy(false);
    setImageToolError(null);
    imageToolBusyRef.current = false;
    imageToolTransactionRef.current = null;
    clipboardRef.current = [];
    setClipboardVersion(version => version + 1);
    replaceSequenceRef.current.clear();
    createMenuOpenerRef.current = null;
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

  const imageToolRuntime = useMemo<WorkflowImageToolRuntime>(() => ({
    userApiKeys,
    modelPreference,
    getProject: () => projectRef.current,
    onProjectChange: next => {
      if (next.id !== projectRef.current.id) return;
      projectRef.current = next;
      patchProject({ nodes: next.nodes, connections: next.connections, selectedNodeIds: next.selectedNodeIds });
      selectedIdsRef.current = next.selectedNodeIds;
      setSelectedNodeIds(next.selectedNodeIds);
    },
  }), [modelPreference, patchProject, userApiKeys]);

  const ownsImageToolTransaction = useCallback((transaction: ImageToolTransaction) => {
    const current = imageToolTransactionRef.current;
    return current?.id === transaction.id && current.projectId === transaction.projectId && current.nodeId === transaction.nodeId;
  }, []);

  const releaseImageToolTransaction = useCallback((transaction: ImageToolTransaction) => {
    if (!ownsImageToolTransaction(transaction)) return false;
    imageToolTransactionRef.current = null;
    imageToolBusyRef.current = false;
    setImageToolBusy(false);
    return true;
  }, [ownsImageToolTransaction]);

  const openImageTool = useCallback((kind: WorkflowImageToolState['kind'], nodeId: string) => {
    if (imageToolTransactionRef.current || imageTool || imageToolBusyRef.current) {
      setNotice('请先完成或关闭当前图片工具');
      return;
    }
    if (projectRef.current.nodes.find(node => node.id === nodeId)?.metadata.status === 'loading') return;
    setImageToolError(null);
    const transaction = { id: nanoid(), projectId: projectRef.current.id, nodeId, frame: currentFrame() };
    imageToolTransactionRef.current = transaction;
    if (kind === 'remove-background') {
      imageToolBusyRef.current = true;
      setImageToolBusy(true);
      void runWorkflowImageAgent(transaction.projectId, nodeId, kind, imageToolRuntime).then(result => {
        if (!ownsImageToolTransaction(transaction)) return;
        if (result.status === 'committed' && result.project.id === transaction.projectId && projectRef.current.id === transaction.projectId && result.project.nodes.some(node => node.id === transaction.nodeId)) {
          pushHistory(transaction.frame);
          setNotice('背景移除完成');
        }
      }).catch(error => {
        if (ownsImageToolTransaction(transaction)) setNotice(error instanceof Error ? error.message : '背景移除失败');
      }).finally(() => { releaseImageToolTransaction(transaction); });
      return;
    }
    setImageTool({ kind, nodeId });
  }, [currentFrame, imageTool, imageToolRuntime, ownsImageToolTransaction, pushHistory, releaseImageToolTransaction]);

  const builtInImageTools = useMemo<WorkflowImageToolHandlers>(() => ({
    crop: id => openImageTool('crop', id), filter: id => openImageTool('filter', id), upscale: id => openImageTool('upscale', id),
    removeBackground: id => openImageTool('remove-background', id), outpaint: id => openImageTool('outpaint', id), mask: id => openImageTool('mask', id), splitLayers: id => openImageTool('split', id),
  }), [openImageTool]);

  const activeImageToolNode = imageTool ? project.nodes.find(node => node.id === imageTool.nodeId) || null : null;
  const activeImageToolMedia = useWorkflowMediaUrl(activeImageToolNode?.metadata.storageKey, activeImageToolNode?.metadata.href);

  const previewImageFilters = useCallback((filters: NonNullable<WorkflowNodeData['metadata']['filters']>) => {
    if (!imageTool || imageTool.kind !== 'filter') return;
    const transaction = imageToolTransactionRef.current;
    if (!transaction || transaction.projectId !== projectRef.current.id || transaction.nodeId !== imageTool.nodeId) return;
    patchProject({ nodes: projectRef.current.nodes.map(node => node.id === imageTool.nodeId ? { ...node, metadata: { ...node.metadata, filters } } : node) });
  }, [imageTool, patchProject]);

  const closeImageTool = useCallback(() => {
    const transaction = imageToolTransactionRef.current;
    if (!imageTool || !transaction || imageToolBusyRef.current || transaction.projectId !== projectRef.current.id || transaction.nodeId !== imageTool.nodeId) return;
    if (imageTool.kind === 'filter') {
      const original = transaction.frame.nodes.find(node => node.id === imageTool.nodeId);
      if (original && projectRef.current.nodes.some(node => node.id === imageTool.nodeId)) {
        patchProject({ nodes: projectRef.current.nodes.map(node => node.id === imageTool.nodeId ? { ...node, metadata: { ...node.metadata, filters: original.metadata.filters } } : node) });
      }
    }
    setImageTool(null);
    setImageToolError(null);
    releaseImageToolTransaction(transaction);
  }, [imageTool, patchProject, releaseImageToolTransaction]);

  const confirmImageTool = useCallback(async (confirmation: WorkflowImageToolConfirmation) => {
    const transaction = imageToolTransactionRef.current;
    if (!imageTool || !transaction || imageToolBusyRef.current || transaction.projectId !== projectRef.current.id || transaction.nodeId !== imageTool.nodeId) return;
    const node = projectRef.current.nodes.find(item => item.id === imageTool.nodeId);
    if (!node) return;
    imageToolBusyRef.current = true;
    setImageToolBusy(true);
    setImageToolError(null);
    try {
      if (confirmation.kind === 'filter') {
        if (!ownsImageToolTransaction(transaction) || !projectRef.current.nodes.some(item => item.id === node.id)) return;
        patchProject({ nodes: projectRef.current.nodes.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, filters: confirmation.filters } } : item) });
        pushHistory(transaction.frame);
        setImageTool(null);
        releaseImageToolTransaction(transaction);
        return;
      }
      if (confirmation.kind === 'crop') {
        const blob = await loadWorkflowMediaBlob(node.metadata.storageKey, node.metadata.href);
        const cropped = await cropWorkflowImage(blob, confirmation.crop);
        const record = await ingestWorkflowMedia(new File([cropped], `crop-${node.metadata.name || 'image.png'}`, { type: cropped.type || node.metadata.mimeType || 'image/png' }));
        if (!ownsImageToolTransaction(transaction) || projectRef.current.id !== transaction.projectId || !projectRef.current.nodes.some(item => item.id === node.id)) {
          await discardWorkflowMediaRecord(record.storageKey);
          if (ownsImageToolTransaction(transaction)) {
            setImageTool(null);
            setImageToolError(null);
            releaseImageToolTransaction(transaction);
          }
          return;
        }
        const width = record.naturalWidth || node.width;
        const height = record.naturalHeight || node.height;
        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
        const size = fitWorkflowMediaSize('image', width, height);
        pushHistory(transaction.frame);
        patchProject({ nodes: projectRef.current.nodes.map(item => item.id === node.id ? { ...item, position: { x: center.x - size.width / 2, y: center.y - size.height / 2 }, width: size.width, height: size.height, metadata: { ...item.metadata, ...record, href: undefined } } : item) });
        releaseWorkflowMediaRecord(record.storageKey);
        setImageTool(null);
        releaseImageToolTransaction(transaction);
        return;
      }
      let result: WorkflowImageToolOutcome | null = null;
      if (confirmation.kind === 'upscale') result = await runWorkflowImageAgent(transaction.projectId, node.id, 'upscale', imageToolRuntime, { targetLongEdge: confirmation.targetLongEdge, algorithm: confirmation.algorithm });
      if (confirmation.kind === 'split') result = await runWorkflowImageSplit(transaction.projectId, node.id, imageToolRuntime);
      if (confirmation.kind === 'outpaint') result = await runWorkflowImageEdit(transaction.projectId, node.id, `向${{ left: '左侧', right: '右侧', top: '上方', bottom: '下方', all: '四周' }[confirmation.direction]}扩展画面。${confirmation.prompt}`, undefined, imageToolRuntime);
      if (confirmation.kind === 'mask') result = await runWorkflowImageEdit(transaction.projectId, node.id, confirmation.prompt, { href: confirmation.maskDataUrl, mimeType: 'image/png' }, imageToolRuntime);
      if (!ownsImageToolTransaction(transaction)) return;
      if (result?.status === 'committed' && result.project.id === transaction.projectId && projectRef.current.id === transaction.projectId && result.project.nodes.some(item => item.id === transaction.nodeId)) {
        pushHistory(transaction.frame);
        setImageTool(null);
        releaseImageToolTransaction(transaction);
      } else if (result?.status === 'stale') {
        setImageTool(null);
        setImageToolError(null);
        releaseImageToolTransaction(transaction);
      }
    } catch (error) {
      if (ownsImageToolTransaction(transaction)) setImageToolError(error instanceof Error ? error.message : '图片处理失败');
    } finally {
      if (ownsImageToolTransaction(transaction)) {
        imageToolBusyRef.current = false;
        setImageToolBusy(false);
      }
    }
  }, [imageTool, imageToolRuntime, ownsImageToolTransaction, patchProject, pushHistory, releaseImageToolTransaction]);

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

  const viewportCenter = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    return screenToWorkflow((rect?.left || 0) + (rect?.width || 1000) / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
  }, [screenToWorkflow]);

  const addMediaAt = useCallback(async (file: File, center: WorkflowPoint, expectedProjectId = projectRef.current.id) => {
    let record: WorkflowMediaRecord | undefined;
    try {
      record = await ingestWorkflowMedia(file);
      if (!mountedRef.current || projectRef.current.id !== expectedProjectId) {
        await discardWorkflowMediaRecord(record.storageKey);
        return;
      }
      const { type, ...metadata } = record;
      const size = fitWorkflowMediaSize(type, record.naturalWidth, record.naturalHeight);
      const node = {
        ...createWorkflowNode(nanoid(), type, { x: center.x - size.width / 2, y: center.y - size.height / 2 }, metadata),
        ...size,
        freeResize: false,
      };
      if (!applyOps([{ type: 'add_node', node }])) await discardWorkflowMediaRecord(record.storageKey);
      else releaseWorkflowMediaRecord(record.storageKey);
    } catch (error) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      if (mountedRef.current && projectRef.current.id === expectedProjectId) setNotice(error instanceof Error ? error.message : '媒体文件导入失败');
    }
  }, [applyOps]);

  const addSharedMediaAt = useCallback(async (media: WorkflowSharedMedia, center: WorkflowPoint) => {
    if (/^https?:\/\//i.test(media.href)) {
      const size = fitWorkflowMediaSize(media.type, media.width, media.height);
      const node = {
        ...createWorkflowNode(nanoid(), media.type, { x: center.x - size.width / 2, y: center.y - size.height / 2 }, {
          href: media.href,
          mimeType: media.mimeType,
          name: media.name,
          naturalWidth: media.width,
          naturalHeight: media.height,
          status: 'success',
        }),
        ...size,
        freeResize: false,
        title: media.name,
      };
      applyOps([{ type: 'add_node', node }]);
      return;
    }
    const expectedProjectId = projectRef.current.id;
    try {
      const blob = await loadWorkflowMediaBlob(undefined, media.href);
      if (!mountedRef.current || projectRef.current.id !== expectedProjectId) return;
      await addMediaAt(new File([blob], media.name, { type: blob.type || media.mimeType }), center, expectedProjectId);
    } catch (error) {
      if (mountedRef.current && projectRef.current.id === expectedProjectId) setNotice(error instanceof Error ? error.message : '共享素材导入失败');
    }
  }, [addMediaAt, applyOps]);

  const dropMedia = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const sharedMedia = workflowDropSharedMedia(event.dataTransfer);
    if (sharedMedia) {
      const point = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
        ? screenToWorkflow(event.clientX, event.clientY)
        : viewportCenter();
      void addSharedMediaAt(sharedMedia, point);
      return;
    }
    const files = workflowDropFiles(event.dataTransfer);
    const file = files.find(item => {
      try { workflowMediaType(item); return true; } catch { return false; }
    });
    if (!file) {
      if (files.length) setNotice('仅支持图片、视频或音频文件');
      return;
    }
    void addMediaAt(file, screenToWorkflow(event.clientX, event.clientY));
  }, [addMediaAt, addSharedMediaAt, screenToWorkflow, viewportCenter]);

  const localPoint = useCallback((clientX: number, clientY: number): WorkflowPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) };
  }, []);

  const openCreateMenu = useCallback((clientX: number, clientY: number, sourceId?: string) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const local = localPoint(clientX, clientY);
    if (!sourceId || !createMenuOpenerRef.current) createMenuOpenerRef.current = rootRef.current;
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
      let width = Math.max(180, interaction.width + dx);
      let height = Math.max(100, interaction.height + dy);
      const resizingNode = interaction.frame.nodes.find(node => node.id === interaction.id);
      if (resizingNode && (resizingNode.type === 'image' || resizingNode.type === 'video') && resizingNode.freeResize !== true) {
        const ratio = (resizingNode.metadata.naturalWidth || interaction.width) / (resizingNode.metadata.naturalHeight || interaction.height);
        height = width / ratio;
        if (height < 100) {
          height = 100;
          width = height * ratio;
        }
        width = Math.round(width);
        height = Math.round(height);
      }
      if (resizingNode?.type === 'audio') height = 120;
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
    setOverlayHidden(false);
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
      createMenuOpenerRef.current = null;
      applyOps([{ type: 'connect_nodes', fromNodeId: interaction.sourceId, toNodeId: dropTarget.nodeId }]);
    } else if (dropTarget.isNearNode) {
      createMenuOpenerRef.current = null;
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
    setOverlayHidden(false);
    if (interaction?.type === 'node' || interaction?.type === 'resize') patchProject(interaction.frame);
    if (interaction?.type === 'pan') patchProject({ viewport: interaction.viewport });
    if (interaction?.type === 'selection') selectNodes(interaction.box.initialIds);
    if (interaction?.type === 'connection') createMenuOpenerRef.current = null;
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
    setClipboardVersion(version => version + 1);
  }, []);

  const pasteSelection = useCallback(async () => {
    const expectedProjectId = projectRef.current.id;
    if (clipboardRef.current.length > 0) {
      const nodes = clipboardRef.current.map(node => ({
        ...node,
        id: nanoid(),
        position: { x: node.position.x + 32, y: node.position.y + 32 },
        metadata: { ...node.metadata },
      }));
      commitFrame([...projectRef.current.nodes, ...nodes], projectRef.current.connections);
      selectNodes(nodes.map(node => node.id));
      return;
    }
    try {
      const clipboard = navigator.clipboard;
      const items = clipboard?.read ? await clipboard.read() : [];
      if (!mountedRef.current || projectRef.current.id !== expectedProjectId) return;
      for (const item of items) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          await addMediaAt(new File([blob], `clipboard.${imageType.split('/')[1] || 'png'}`, { type: imageType }), viewportCenter(), expectedProjectId);
          return;
        }
        if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          if (text) {
            const center = viewportCenter();
            const node = createWorkflowNode(nanoid(), 'text', { x: center.x - 170, y: center.y - 110 }, { content: text });
            applyOps([{ type: 'add_node', node }]);
          }
          return;
        }
      }
      const text = clipboard?.readText ? await clipboard.readText() : '';
      if (text && mountedRef.current && projectRef.current.id === expectedProjectId) {
        const center = viewportCenter();
        applyOps([{ type: 'add_node', node: createWorkflowNode(nanoid(), 'text', { x: center.x - 170, y: center.y - 110 }, { content: text }) }]);
      }
    } catch (error) {
      if (mountedRef.current && projectRef.current.id === expectedProjectId) setNotice(error instanceof Error ? error.message : '无法读取剪贴板内容');
    }
  }, [addMediaAt, applyOps, commitFrame, selectNodes, viewportCenter]);

  const deleteSelection = useCallback(() => {
    if (selectedConnectionId) {
      commitFrame(projectRef.current.nodes, projectRef.current.connections.filter(connection => connection.id !== selectedConnectionId));
      setSelectedConnectionId(null);
      return;
    }
    const deletableIds = selectedIdsRef.current.filter(id => !projectRef.current.nodes.find(node => node.id === id)?.isLocked);
    if (deletableIds.length) applyOps([{ type: 'delete_nodes', ids: deletableIds }]);
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
      if (modifier && key === 'v') { event.preventDefault(); void pasteSelection(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === 'Escape') {
        closeCreateMenu();
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
  }, [cancelInteraction, closeCreateMenu, copySelection, deleteSelection, pasteSelection, redo, undo]);

  const addNode = useCallback((type: WorkflowNodeType, metadata: WorkflowNodeData['metadata'] = {}) => {
    const center = viewportCenter();
    applyOps([{ type: 'add_node', node: createWorkflowNode(nanoid(), type, { x: center.x - 170, y: center.y - 110 }, metadata) }]);
  }, [applyOps, viewportCenter]);

  const replaceMedia = useCallback(async (node: WorkflowNodeData, file: File) => {
    if (node.isLocked) return;
    const expectedProjectId = projectRef.current.id;
    const sequence = (replaceSequenceRef.current.get(node.id) || 0) + 1;
    replaceSequenceRef.current.set(node.id, sequence);
    let record: WorkflowMediaRecord | undefined;
    try {
      if (workflowMediaType(file) !== node.type) throw new Error(`请选择${node.type === 'image' ? '图片' : node.type === 'video' ? '视频' : '音频'}文件`);
      record = await ingestWorkflowMedia(file);
      const currentNode = projectRef.current.nodes.find(item => item.id === node.id);
      if (!mountedRef.current
        || projectRef.current.id !== expectedProjectId
        || replaceSequenceRef.current.get(node.id) !== sequence
        || !currentNode) {
        await discardWorkflowMediaRecord(record.storageKey);
        return;
      }
      const { type: _type, ...metadata } = record;
      const size = fitWorkflowMediaSize(currentNode.type as WorkflowMediaRecord['type'], record.naturalWidth, record.naturalHeight);
      const center = { x: currentNode.position.x + currentNode.width / 2, y: currentNode.position.y + currentNode.height / 2 };
      const updated = projectRef.current.nodes.map(item => item.id === node.id ? {
        ...item,
        ...size,
        position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
        metadata: { ...item.metadata, ...metadata, href: undefined, error: undefined },
      } : item);
      commitFrame(updated, projectRef.current.connections);
      releaseWorkflowMediaRecord(record.storageKey);
      setNotice(null);
    } catch (error) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      if (mountedRef.current
        && projectRef.current.id === expectedProjectId
        && replaceSequenceRef.current.get(node.id) === sequence) {
        setNotice(error instanceof Error ? error.message : '媒体文件替换失败');
      }
    }
  }, [commitFrame]);

  const addSharedMedia = useCallback(async (media: WorkflowSharedMedia) => {
    await addSharedMediaAt(media, viewportCenter());
  }, [addSharedMediaAt, viewportCenter]);

  const removeMedia = useCallback((node: WorkflowNodeData) => {
    if (node.isLocked) return;
    const {
      storageKey: _storageKey,
      name: _name,
      mimeType: _mimeType,
      bytes: _bytes,
      naturalWidth: _naturalWidth,
      naturalHeight: _naturalHeight,
      durationMs: _durationMs,
      href: _href,
      poster: _poster,
      error: _error,
      ...metadata
    } = node.metadata;
    commitFrame(projectRef.current.nodes.map(item => item.id === node.id
      ? { ...item, metadata: { ...metadata, status: 'idle' as const } }
      : item), projectRef.current.connections);
  }, [commitFrame]);

  const createFromMenu = useCallback((type: WorkflowNodeType) => {
    if (!createMenu) return;
    const node = createWorkflowNode(nanoid(), type, createMenu.world);
    const success = createMenu.sourceId
      ? applyOps([{ type: 'create_connected_node', fromNodeId: createMenu.sourceId, node }])
      : applyOps([{ type: 'add_node', node }]);
    if (success) closeCreateMenu();
  }, [applyOps, closeCreateMenu, createMenu]);

  const fitView = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    const nodes = projectRef.current.nodes.filter(node => node.isVisible !== false);
    if (!rect || nodes.length === 0) return;
    const minX = Math.min(...nodes.map(node => node.position.x));
    const minY = Math.min(...nodes.map(node => node.position.y));
    const maxX = Math.max(...nodes.map(node => node.position.x + node.width));
    const maxY = Math.max(...nodes.map(node => node.position.y + node.height));
    const k = Math.min(1.5, Math.max(0.12, Math.min((rect.width - 160) / Math.max(1, maxX - minX), (rect.height - 160) / Math.max(1, maxY - minY))));
    patchProject({ viewport: { x: rect.width / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k, k } });
  }, [patchProject]);

  const startPan = (clientX: number, clientY: number, pointerId: number) => {
    closeCreateMenu();
    setContextMenu(null);
    setSelectedConnectionId(null);
    setConnectionDrag(null);
    interactionRef.current = {
      type: 'pan',
      pointerId,
      start: localPoint(clientX, clientY),
      viewport: { ...viewportRef.current },
    };
  };

  const startNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNodeData) => {
    if (event.button !== 0) return;
    if (tool === 'pan' || spacePressedRef.current) {
      event.stopPropagation();
      event.preventDefault();
      startPan(event.clientX, event.clientY, event.pointerId);
      setOverlayHidden(true);
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(NODE_ACTION_TARGET)) return;
    event.stopPropagation();
    setContextMenu(null);
    closeCreateMenu();
    setSelectedConnectionId(null);
    const modifier = event.shiftKey || event.ctrlKey || event.metaKey;
    let ids = selectedIdsRef.current;
    if (modifier) ids = ids.includes(node.id) ? ids.filter(id => id !== node.id) : [...ids, node.id];
    else if (!ids.includes(node.id)) ids = [node.id];
    selectNodes(ids);
    if (!ids.includes(node.id) || node.isLocked) return;
    if (target?.closest('video,audio')) {
      setOverlayHidden(false);
      return;
    }
    const frame = currentFrame();
    interactionRef.current = {
      type: 'node',
      pointerId: event.pointerId,
      start: screenToWorkflow(event.clientX, event.clientY),
      positions: new Map(frame.nodes.filter(item => ids.includes(item.id)).map(item => [item.id, { ...item.position }])),
      frame,
      moved: false,
    };
    setOverlayHidden(true);
  };

  const isTrueBackground = (target: EventTarget | null) => {
    if (!(target instanceof Element) || target.closest(BLOCKED_TARGET)) return false;
    if (target.closest('[data-workflow-node-id],[data-workflow-connection-id]')) return false;
    return target === rootRef.current || target === worldRef.current || Boolean(target.closest('.workflow-world'));
  };

  const onSurfacePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isTrueBackground(event.target)) return;
    setContextMenu(null);
    closeCreateMenu();
    setNotice(null);
    setSelectedConnectionId(null);
    if (event.button === 0 && (event.ctrlKey || event.metaKey) && tool === 'select') {
      event.preventDefault();
      const point = screenToWorkflow(event.clientX, event.clientY);
      const box = { start: point, current: point, additive: event.shiftKey, initialIds: [...selectedIdsRef.current] };
      interactionRef.current = { type: 'selection', pointerId: event.pointerId, box };
      setOverlayHidden(true);
      setSelectionBox(box);
      if (!event.shiftKey) selectNodes([]);
      return;
    }
    if (event.button === 0 || event.button === 1) {
      event.preventDefault();
      startPan(event.clientX, event.clientY, event.pointerId);
      setOverlayHidden(true);
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
  const selectedNodeData = project.nodes.filter(node => node.isVisible !== false && selectedNodes.has(node.id));
  const exportSelectedMedia = async (nodes: WorkflowNodeData[]) => {
    const media = nodes.filter(node => node.type === 'image' || node.type === 'video' || node.type === 'audio');
    try {
      const count = await exportMediaArchive(media.map(node => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        name: node.metadata.name || node.title,
        mimeType: node.metadata.mimeType,
        loadBlob: () => loadWorkflowMediaBlob(node.metadata.storageKey, node.metadata.href),
      })), `Flovart-Workflow-${project.title}`);
      setNotice(`已按画布顺序导出 ${count} 个媒体文件。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '批量导出失败。');
    }
  };
  const overlayBounds = selectedNodeData.length ? selectedNodeData.reduce((bounds, node) => ({
    left: Math.min(bounds.left, node.position.x),
    top: Math.min(bounds.top, node.position.y),
    right: Math.max(bounds.right, node.position.x + node.width),
    bottom: Math.max(bounds.bottom, node.position.y + node.height),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }) : null;
  const rootRect = rootRef.current?.getBoundingClientRect();
  const overlayCenter = overlayBounds ? project.viewport.x + ((overlayBounds.left + overlayBounds.right) / 2) * project.viewport.k : 0;
  const toolbarLeft = Math.max(8, Math.min(overlayCenter - 180, (rootRect?.width || 1000) - 368));
  const toolbarTop = overlayBounds ? Math.max(8, project.viewport.y + overlayBounds.top * project.viewport.k - 60) : 0;
  const promptLeft = Math.max(8, Math.min(overlayCenter - 360, (rootRect?.width || 1000) - 728));
  const promptTop = overlayBounds ? Math.max(64, Math.min(project.viewport.y + overlayBounds.bottom * project.viewport.k + 12, (rootRect?.height || 700) - 190)) : 0;
  const gridSize = (project.backgroundMode === 'dots' ? 20 : 24) * project.viewport.k;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="workflow-editor"
      className={`workflow-editor workflow-editor--${tool} workflow-bg--${project.backgroundMode}`}
      style={project.backgroundMode === 'none' ? { backgroundImage: 'none' } : {
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${project.viewport.x % gridSize}px ${project.viewport.y % gridSize}px`,
      }}
      onPointerDown={onSurfacePointerDown}
      onDragEnterCapture={event => event.preventDefault()}
      onDragOverCapture={event => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }}
      onDropCapture={dropMedia}
      onDoubleClick={event => {
        if (!isTrueBackground(event.target)) return;
        event.preventDefault();
        openCreateMenu(event.clientX, event.clientY);
      }}
      onWheel={event => {
        if (event.target instanceof Element && event.target.closest(BLOCKED_TARGET)) return;
        event.preventDefault();
        if (event.ctrlKey || wheelMode === 'zoom') {
          const rect = rootRef.current?.getBoundingClientRect();
          const world = screenToWorkflow(event.clientX, event.clientY);
          const k = Math.min(3, Math.max(0.12, viewportRef.current.k * Math.exp(-event.deltaY * 0.0015)));
          patchProject({ viewport: {
            x: event.clientX - (rect?.left || 0) - world.x * k,
            y: event.clientY - (rect?.top || 0) - world.y * k,
            k,
          } });
        } else {
          patchProject({ viewport: {
            ...viewportRef.current,
            x: viewportRef.current.x - event.deltaX,
            y: viewportRef.current.y - event.deltaY,
          } });
        }
      }}
      onContextMenu={event => event.preventDefault()}
    >
      <WorkflowToolbar
        tool={tool}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        onToolChange={setTool}
        onAddNode={addNode}
        onAddSharedMedia={media => { void addSharedMedia(media); }}
        onUndo={undo}
        onRedo={redo}
        onFit={fitView}
        onToggleGrid={() => patchProject({ backgroundMode: projectRef.current.backgroundMode === 'none' ? 'dots' : projectRef.current.backgroundMode === 'dots' ? 'lines' : 'none' })}
        onOpenAgent={onOpenAgent}
        wheelMode={wheelMode}
        setWheelMode={setWheelMode}
      />
      <div ref={worldRef} className="workflow-world" style={{ transform: `translate(${project.viewport.x}px, ${project.viewport.y}px) scale(${project.viewport.k})` }}>
        <WorkflowConnections
          nodes={project.nodes.filter(node => node.isVisible !== false)}
          connections={project.connections.filter(connection => project.nodes.find(node => node.id === connection.fromNodeId)?.isVisible !== false && project.nodes.find(node => node.id === connection.toNodeId)?.isVisible !== false)}
          selectedId={selectedConnectionId}
          active={connectionDrag}
          onSelect={id => { setSelectedConnectionId(id); selectNodes([]); setContextMenu(null); }}
          onContextMenu={(event, id) => {
            setSelectedConnectionId(id);
            selectNodes([]);
            setContextMenu({ type: 'connection', id, x: event.clientX, y: event.clientY });
          }}
        />
        {project.nodes.filter(node => node.isVisible !== false).map(node => (
          <WorkflowNode
            key={node.id}
            node={node}
            selected={selectedNodes.has(node.id)}
            onPointerDown={event => startNodeDrag(event, node)}
            onConnectStart={event => {
              if (event.button !== 0) return;
              if (tool === 'pan' || spacePressedRef.current || node.isLocked) return;
              event.preventDefault();
              event.stopPropagation();
              closeCreateMenu();
              setContextMenu(null);
              setSelectedConnectionId(null);
              createMenuOpenerRef.current = event.currentTarget;
              interactionRef.current = { type: 'connection', pointerId: event.pointerId, sourceId: node.id };
              setConnectionDrag({ sourceId: node.id, point: screenToWorkflow(event.clientX, event.clientY), targetId: null });
            }}
            onResizeStart={event => {
              if (event.button !== 0) return;
              if (tool === 'pan' || spacePressedRef.current || node.isLocked) return;
              event.preventDefault();
              event.stopPropagation();
              const frame = currentFrame();
              interactionRef.current = { type: 'resize', pointerId: event.pointerId, id: node.id, start: screenToWorkflow(event.clientX, event.clientY), width: node.width, height: node.height, frame, moved: false };
              setOverlayHidden(true);
            }}
            onChangeText={content => { if (!node.isLocked) patchProject({ nodes: projectRef.current.nodes.map(item => item.id === node.id ? { ...item, metadata: { ...item.metadata, content } } : item) }); }}
            onChangeMetadata={metadata => !node.isLocked && patchProject({
              nodes: projectRef.current.nodes.map(item => item.id === node.id
                ? { ...item, metadata: { ...item.metadata, ...metadata, config: metadata.config ? { ...item.metadata.config, ...metadata.config } : item.metadata.config } }
                : item),
            })}
            onRun={() => { if (!node.isLocked) onRunNode(node.id); }}
            onReplaceMedia={file => { if (!node.isLocked) void replaceMedia(node, file); }}
            onRemoveMedia={() => { if (!node.isLocked) removeMedia(node); }}
            onContextMenu={event => {
              setSelectedConnectionId(null);
              selectNodes([node.id]);
              setContextMenu({ type: 'node', id: node.id, x: event.clientX, y: event.clientY });
            }}
          />
        ))}
        {selectionStyle && <div className="workflow-selection-box" style={selectionStyle} />}
      </div>
      {!overlayHidden && overlayBounds && selectedNodeData.length > 0 && selectedNodeData.every(node => !node.isLocked) && <>
        <div data-workflow-overlay style={{ position: 'absolute', zIndex: 70, left: toolbarLeft, top: toolbarTop }}>
          <WorkflowNodeToolbar
            nodes={selectedNodeData}
            onCopy={ids => { clipboardRef.current = projectRef.current.nodes.filter(node => ids.includes(node.id)); setClipboardVersion(version => version + 1); }}
            onDelete={ids => applyOps([{ type: 'delete_nodes', ids }])}
            onExport={nodes => { void exportSelectedMedia(nodes); }}
            onRun={id => onRunNode(id)}
            onStop={onStopNode}
            onPromptFocus={() => setPromptFocusSignal(value => value + 1)}
            onSaveMedia={onSaveWorkflowMedia}
            onReversePrompt={onReversePrompt ? (id, mediaUrl) => {
              const node = projectRef.current.nodes.find(item => item.id === id);
              if (!node || node.isLocked) return;
              void onReversePrompt(mediaUrl, node.metadata.mimeType || 'image/png', node.metadata.naturalWidth, node.metadata.naturalHeight)
                .then(prompt => {
                  if (!prompt || projectRef.current.nodes.find(item => item.id === id)?.isLocked) return;
                  applyOps([{ type: 'update_node', id, metadata: { ...node.metadata, prompt } }]);
                  setPromptFocusSignal(value => value + 1);
                })
                .catch(error => setNotice(error instanceof Error ? error.message : '反推 Prompt 失败'));
            } : undefined}
            imageTools={{ ...builtInImageTools, ...imageTools }}
            imageToolBusy={Boolean(imageTool || imageToolBusy || imageToolTransactionRef.current)}
            onReplaceMedia={(id, file) => { const node = projectRef.current.nodes.find(item => item.id === id); if (node) void replaceMedia(node, file); }}
            onToggleFreeResize={id => { const node = projectRef.current.nodes.find(item => item.id === id); if (node) applyOps([{ type: 'update_node', id, patch: { freeResize: !node.freeResize } }]); }}
            onLayer={position => {
              const selected = projectRef.current.nodes.filter(node => selectedNodes.has(node.id));
              const remaining = projectRef.current.nodes.filter(node => !selectedNodes.has(node.id));
              commitFrame(position === 'front' ? [...remaining, ...selected] : [...selected, ...remaining], projectRef.current.connections);
            }}
            onAlign={alignment => {
              if (selectedNodeData.length < 2) return;
              const horizontal = alignment === 'left' || alignment === 'horizontal-center' || alignment === 'right';
              const target = alignment === 'left' ? Math.min(...selectedNodeData.map(node => node.position.x))
                : alignment === 'right' ? Math.max(...selectedNodeData.map(node => node.position.x + node.width))
                  : alignment === 'horizontal-center' ? selectedNodeData.reduce((sum, node) => sum + node.position.x + node.width / 2, 0) / selectedNodeData.length
                    : alignment === 'top' ? Math.min(...selectedNodeData.map(node => node.position.y))
                      : alignment === 'bottom' ? Math.max(...selectedNodeData.map(node => node.position.y + node.height))
                        : selectedNodeData.reduce((sum, node) => sum + node.position.y + node.height / 2, 0) / selectedNodeData.length;
              commitFrame(projectRef.current.nodes.map(node => {
                if (!selectedNodes.has(node.id)) return node;
                return horizontal
                  ? { ...node, position: { ...node.position, x: alignment === 'left' ? target : alignment === 'right' ? target - node.width : target - node.width / 2 } }
                  : { ...node, position: { ...node.position, y: alignment === 'top' ? target : alignment === 'bottom' ? target - node.height : target - node.height / 2 } };
              }), projectRef.current.connections);
            }}
          />
        </div>
        {selectedNodeData.length === 1 && selectedNodeData[0].type === 'config' && <div data-workflow-overlay style={{ position: 'absolute', zIndex: 69, left: promptLeft, top: promptTop, width: 420 }} onWheel={event => event.stopPropagation()}>
          <WorkflowConfigPanel node={selectedNodeData[0]} nodes={project.nodes} onChange={metadata => applyOps([{ type: 'update_node', id: selectedNodeData[0].id, metadata: { ...selectedNodeData[0].metadata, ...metadata } }])} onRun={() => onRunNode(selectedNodeData[0].id)} onStop={onStopNode ? () => onStopNode(selectedNodeData[0].id) : undefined} />
        </div>}
        {selectedNodeData.length === 1 && ['image', 'video', 'text'].includes(selectedNodeData[0].type) && <div data-workflow-overlay style={{ position: 'absolute', zIndex: 69, left: promptLeft, top: promptTop }}>
          <WorkflowNodePromptBar node={selectedNodeData[0]} nodes={project.nodes} t={t} theme={theme} language={language} userApiKeys={userApiKeys} modelPreference={modelPreference} dynamicModelOptions={dynamicModelOptions} onOpenSettings={onOpenSettings} onChange={metadata => applyOps([{ type: 'update_node', id: selectedNodeData[0].id, metadata: { ...selectedNodeData[0].metadata, ...metadata } }])} onRun={() => onRunNode(selectedNodeData[0].id)} onStop={onStopNode ? () => onStopNode(selectedNodeData[0].id) : undefined} focusSignal={promptFocusSignal} />
        </div>}
      </>}
      <WorkflowMiniMap nodes={project.nodes.filter(node => node.isVisible !== false)} viewport={project.viewport} onCenter={(x, y) => {
        const rect = rootRef.current?.getBoundingClientRect();
        patchProject({ viewport: { ...viewportRef.current, x: (rect?.width || 1000) / 2 - x * viewportRef.current.k, y: (rect?.height || 700) / 2 - y * viewportRef.current.k } });
      }} />
      <div className="workflow-zoom" data-workflow-overlay>{Math.round(project.viewport.k * 100)}%</div>
      {notice && <div role="status" aria-live="polite" data-workflow-overlay style={{ position: 'absolute', zIndex: 80, right: 14, top: 58, maxWidth: 320, padding: '7px 10px', border: '1px solid var(--wf-border)', borderRadius: 7, color: 'var(--wf-text)', background: 'var(--wf-panel)', fontSize: 12 }}>{notice}</div>}
      {createMenu && <WorkflowCreateMenu state={createMenu} onCreate={createFromMenu} onClose={closeCreateMenu} />}
      {contextMenu && (
        <WorkflowContextMenu
          state={contextMenu}
          onCopy={() => {
            if (contextMenu.type === 'node') {
              clipboardRef.current = projectRef.current.nodes.filter(node => node.id === contextMenu.id);
              setClipboardVersion(version => version + 1);
            }
            setContextMenu(null);
          }}
          onRun={() => { if (contextMenu.type === 'node' && !projectRef.current.nodes.find(node => node.id === contextMenu.id)?.isLocked) onRunNode(contextMenu.id); setContextMenu(null); }}
          onDelete={() => {
            if (contextMenu.type === 'node' && !projectRef.current.nodes.find(node => node.id === contextMenu.id)?.isLocked) applyOps([{ type: 'delete_nodes', ids: [contextMenu.id] }]);
            else {
              commitFrame(projectRef.current.nodes, projectRef.current.connections.filter(connection => connection.id !== contextMenu.id));
              setSelectedConnectionId(null);
            }
            setContextMenu(null);
          }}
        />
      )}
      <WorkflowImageToolDialogs
        tool={imageTool}
        node={activeImageToolNode}
        mediaUrl={activeImageToolMedia.url || ''}
        busy={imageToolBusy}
        error={imageToolError || activeImageToolMedia.error}
        onClose={closeImageTool}
        onPreview={previewImageFilters}
        onConfirm={confirmation => { void confirmImageTool(confirmation); }}
      />
    </div>
  );
}
