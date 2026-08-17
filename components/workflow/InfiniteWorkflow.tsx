import { nanoid } from 'nanoid';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronRight, ChevronsDown, Maximize2, Plus, Star, Undo2 } from 'lucide-react';
import type { AssetLibrary, PromptEnhanceMode, PromptEnhanceResult, UserApiKey } from '../../types';
import type { RouteFallbackResolution } from '../../services/routeMapping';
import { STUDIO_MEDIA_DRAG_TYPE } from '../studio/StudioMediaBrowser';
import type { AssetSuggestion } from '../MentionList';
import type { MentionData } from '../MediaMentionExtension';
import { createWorkflowNode, WORKFLOW_NODE_SPECS } from './constants';
import { applyWorkflowDraftChangeSet, recordWorkflowDraftSnapshotChange, redoWorkflowDraftChangeSet, undoWorkflowDraftChangeSet } from './draftAuthority';
import {
  discardWorkflowMediaRecord,
  fitWorkflowMediaSize,
  ingestWorkflowMedia,
  loadWorkflowMediaBlob,
  pruneWorkflowMedia,
  registerWorkflowMediaTransientReferences,
  releaseWorkflowMediaRecord,
  unregisterWorkflowMediaTransientReferences,
  useWorkflowMediaUrl,
  workflowMediaType,
  type WorkflowMediaRecord,
} from './media';
import { summarizeWorkflowOps, validateWorkflowConnection } from './ops';
import { buildWorkflowPromptPasteOps } from './promptPaste';
import { WorkflowConnections } from './WorkflowConnections';
import { WorkflowContextMenu, type WorkflowContextMenuState } from './WorkflowContextMenu';
import { WorkflowCreateMenu, type WorkflowCreateMenuState } from './WorkflowCreateMenu';
import type { WorkflowSharedMedia } from './WorkflowConfigPanel';
import { WorkflowMiniMap } from './WorkflowMiniMap';
import { WorkflowNode } from './WorkflowNode';
import { MediaPreviewModal } from './MediaPreviewModal';
import { WorkflowNodePromptBar, type WorkflowModelOptions } from './WorkflowNodePromptBar';
import { WorkflowNodeToolbar, type WorkflowImageToolHandlers, type WorkflowVideoToolHandlers, type WorkflowAudioToolHandlers } from './WorkflowNodeToolbar';
import { WorkflowImageToolDialogs, type WorkflowImageToolConfirmation, type WorkflowImageToolState } from './WorkflowImageToolDialogs';
import { WorkflowVideoToolDialogs, type WorkflowVideoToolConfirmation, type WorkflowVideoToolState } from './WorkflowVideoToolDialogs';
import { WorkflowAudioToolDialogs, type WorkflowAudioToolConfirmation, type WorkflowAudioToolState } from './WorkflowAudioToolDialogs';
import { WorkflowConfigPanel } from './WorkflowConfigPanel';
import { ScriptNodeEditor } from './ScriptNodeEditor';
import { SlashMenu } from './SlashMenu';
import { WorkflowToolbar, type WorkflowTool } from './WorkflowToolbar';
import { useProductionProjectionAdapter } from './useProductionProjectionAdapter';
import { composeImageGrid } from './gridComposer';
import { LIGHTING_PRESETS, buildRelightPrompt } from './LightingPresets';
import type { WorkflowConnection, WorkflowNode as WorkflowNodeData, WorkflowNodeType, WorkflowOp, WorkflowPoint, WorkflowProject, WorkflowSnapshot, WorkflowViewport, ScriptShot, SlashCommand } from './types';
import {
  runWorkflowCropOperation,
  runWorkflowImageEditOperation,
  runWorkflowRemoveBackgroundOperation,
  runWorkflowRotateOperation,
  runWorkflowSplitGridOperation,
  runWorkflowSplitLayersOperation,
  runWorkflowUpscaleOperation,
  type WorkflowImageToolOutcome,
  type WorkflowImageOperationRuntime,
} from '../../services/workflowImageOperations';
import {
  runWorkflowVideoAvSplitOperation,
  runWorkflowVideoExtractFrameOperation,
  runWorkflowVideoMergeOperation,
  runWorkflowVideoTrimOperation,
} from '../../services/workflowVideoOperations';
import { runWorkflowAudioSpeedOperation, runWorkflowAudioStemSplitOperation, runWorkflowAudioTrimOperation } from '../../services/workflowAudioOperations';
import { exportMediaArchive } from '../../utils/batchMediaExport';
import { usePromptHistoryStore } from '../../stores/usePromptHistoryStore';
import { useClipboardStore, type ClipItem } from '../../stores/useClipboardStore';

type Frame = Pick<WorkflowProject, 'nodes' | 'connections'>;
type ImageToolTransaction = { id: string; projectId: string; nodeId: string; frame: Frame };
type SelectionBox = { start: WorkflowPoint; current: WorkflowPoint; additive: boolean; initialIds: string[] };
type Interaction = { pointerId: number } & (
  | { type: 'node'; start: WorkflowPoint; positions: Map<string, WorkflowPoint>; frame: Frame; moved: boolean; batchId?: string }
  | { type: 'resize'; id: string; start: WorkflowPoint; width: number; height: number; frame: Frame; moved: boolean }
  | { type: 'pan'; start: WorkflowPoint; viewport: WorkflowViewport }
  | { type: 'selection'; box: SelectionBox }
  | { type: 'connection'; originId: string; direction: 'out' | 'in' });
type ConnectionDropTarget = { nodeId: string | null; isNearNode: boolean; reason?: string };

const NODE_ACTION_TARGET = 'button,textarea,input,select,[contenteditable="true"],[role="dialog"],[data-workflow-overlay],.workflow-toolbar';
const BLOCKED_TARGET = `${NODE_ACTION_TARGET},video,audio`;
const EDITABLE_TARGET = 'textarea,input,select,video,audio,[contenteditable="true"]';
const SPACE_BLOCKED_TARGET = `${EDITABLE_TARGET},[role="menu"],[role="dialog"]`;
const CONNECTION_NODE_PADDING = 24;
const CONNECTION_HANDLE_RADIUS = 18;
const AUTO_LAYOUT_GAP_X = 100;
const AUTO_LAYOUT_GAP_Y = 40;
const AUTO_LAYOUT_DEFAULT_W = 280;
const AUTO_LAYOUT_DEFAULT_H = 200;

function computeHierarchicalLayout(nodes: WorkflowNodeData[], connections: WorkflowConnection[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (!nodes.length) return positions;
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  connections.forEach(conn => {
    (outgoing.get(conn.fromNodeId) || (outgoing.set(conn.fromNodeId, []).get(conn.fromNodeId) as string[])).push(conn.toNodeId);
    (incoming.get(conn.toNodeId) || (incoming.set(conn.toNodeId, []).get(conn.toNodeId) as string[])).push(conn.fromNodeId);
  });
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  connections.forEach(conn => { hasIncoming.add(conn.toNodeId); hasOutgoing.add(conn.fromNodeId); });
  const isolatedIds = nodes.map(node => node.id).filter(id => !hasIncoming.has(id) && !hasOutgoing.has(id));
  const layer = new Map<string, number>();
  const computeLayer = (id: string, visiting = new Set<string>()): number => {
    if (layer.has(id)) return layer.get(id) as number;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = incoming.get(id) || [];
    const l = preds.length ? 1 + Math.max(...preds.map(p => computeLayer(p, visiting))) : 0;
    layer.set(id, l);
    visiting.delete(id);
    return l;
  };
  nodes.forEach(node => { if (hasIncoming.has(node.id) || hasOutgoing.has(node.id)) computeLayer(node.id); });
  const layers = new Map<number, string[]>();
  layer.forEach((l, id) => { (layers.get(l) || (layers.set(l, []).get(l) as string[])).push(id); });
  const maxLayer = layers.size ? Math.max(...layers.keys()) : -1;
  if (isolatedIds.length) layers.set(maxLayer + 1, isolatedIds);
  layers.forEach((ids, l) => {
    const x = l * (AUTO_LAYOUT_DEFAULT_W + AUTO_LAYOUT_GAP_X);
    let y = 0;
    ids.forEach(id => {
      const node = nodes.find(n => n.id === id);
      const h = node?.height || AUTO_LAYOUT_DEFAULT_H;
      positions.set(id, { x, y });
      y += h + AUTO_LAYOUT_GAP_Y;
    });
  });
  return positions;
}

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

function WorkflowVideoPreview({ node, className }: { node: WorkflowNodeData; className?: string }) {
  const poster = useWorkflowMediaUrl(node.metadata.posterStorageKey, node.metadata.poster);
  return poster.url
    ? <img src={poster.url} alt={`${node.title} 视频封面`} className={className} draggable={false} loading="lazy" data-workflow-media-preview />
    : <div className={`${className || ''} workflow-video-placeholder`} role="img" aria-label={`${node.title} 视频预览`} data-testid="workflow-video-placeholder" data-workflow-media-preview>视频预览</div>;
}

function WorkflowBatchStack({ head, count, onPointerDown, onExpand }: {
  head: WorkflowNodeData;
  count: number;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onExpand: () => void;
}) {
  const media = useWorkflowMediaUrl(
    head.type === 'video' ? undefined : head.metadata.storageKey,
    head.type === 'video' ? undefined : head.metadata.href,
  );
  return (
    <motion.div
      className="workflow-batch-stack"
      style={{ x: head.position.x, y: head.position.y, width: head.width, height: head.height }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 380, damping: 24, mass: 0.8 }}
      whileHover={{ scale: 1.02 }}
      onPointerDown={onPointerDown}
    >
      <div className="workflow-batch-stack__layer" style={{ transform: 'translate(7px, 7px)' }} />
      <div className="workflow-batch-stack__layer" style={{ transform: 'translate(3.5px, 3.5px)' }} />
      {head.type === 'video'
        ? <WorkflowVideoPreview node={head} className="workflow-batch-stack__preview" />
        : media.url && <img src={media.url} alt={head.title} className="workflow-batch-stack__preview" draggable={false} />}
      <div className="workflow-batch-stack__title"><span>{head.title}</span></div>
      <button type="button" className="workflow-batch-stack__expand" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onExpand(); }} aria-label={`展开 ${count} 个结果`}>
        <span>{count}张</span><ChevronRight size={16} />
      </button>
    </motion.div>
  );
}

function WorkflowBatchThumb({ node, active, primary, onSelect }: { node: WorkflowNodeData; active: boolean; primary: boolean; onSelect: () => void }) {
  const media = useWorkflowMediaUrl(
    node.type === 'video' ? undefined : node.metadata.storageKey,
    node.type === 'video' ? undefined : node.metadata.href,
  );
  return <button type="button" className={`workflow-batch-gallery__thumb${active ? ' is-active' : ''}`} onPointerDown={event => event.stopPropagation()} onClick={onSelect} title={`${node.title}${primary ? ' · 主图' : ''}`}>
    {node.type === 'video' ? <WorkflowVideoPreview node={node} /> : media.url && <img src={media.url} alt={node.title} />}
    {primary && <Check size={11} className="workflow-batch-gallery__primary-mark" />}
  </button>;
}

function WorkflowBatchGallery({ group, selectedId, onSelect, onCollapse, onSetPrimary, onPointerDown }: {
  group: WorkflowNodeData[];
  selectedId?: string;
  onSelect: (nodeId: string) => void;
  onCollapse: () => void;
  onSetPrimary: (nodeId: string) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const root = group.find(node => node.batchIndex === 0) || group[0];
  const primaryId = root.metadata.primaryImageId || root.id;
  const selected = group.find(node => node.id === selectedId) || group.find(node => node.id === primaryId) || root;
  const media = useWorkflowMediaUrl(
    selected.type === 'video' ? undefined : selected.metadata.storageKey,
    selected.type === 'video' ? undefined : selected.metadata.href,
  );
  const index = Math.max(0, group.findIndex(node => node.id === selected.id));
  return <motion.div className="workflow-batch-gallery" style={{ x: root.position.x, y: root.position.y, width: root.width, height: root.height }} initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .94 }} transition={{ type: 'spring', stiffness: 360, damping: 28 }} onPointerDown={onPointerDown}>
    {selected.type === 'video'
      ? <WorkflowVideoPreview node={selected} className="workflow-batch-gallery__media" />
      : media.url && <img src={media.url} alt={selected.title} className="workflow-batch-gallery__media" draggable={false} />}
    <div className="workflow-batch-stack__title"><span>{selected.title}</span></div>
    <button type="button" className="workflow-batch-stack__expand" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onCollapse(); }}><span>{group.length}张</span><ChevronsDown size={15} /></button>
    {selected.id !== primaryId && <button type="button" className="workflow-batch-gallery__set-primary" data-workflow-overlay onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSetPrimary(selected.id); }}><Star size={13} />设为主图</button>}
    <div className="workflow-batch-gallery__rail" data-workflow-overlay onPointerDown={event => event.stopPropagation()}>
      <span className="workflow-batch-gallery__counter">{index + 1} / {group.length}</span>
      <div className="workflow-batch-gallery__thumbs">{group.map(node => <WorkflowBatchThumb key={node.id} node={node} active={node.id === selected.id} primary={node.id === primaryId} onSelect={() => onSelect(node.id)} />)}</div>
    </div>
  </motion.div>;
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
  confirmRouteFallback,
  dynamicModelOptions = { text: [], image: [], video: [] },
  onOpenSettings,
  onEnhancePrompt,
  isEnhancingPrompt,
  agentOpen,
  rightPanelInset,
  assetLibrary,
  focusNodeRequest,
  onOpenAssets,
}: {
  project: WorkflowProject;
  updateProject: (patch: Partial<WorkflowProject>) => void;
  onRunNode: (nodeId: string) => void;
  onStopNode?: (nodeId: string) => void;
  onSaveWorkflowMedia?: (nodeId: string) => void;
  onReversePrompt?: (imageHref: string, mimeType: string, width?: number, height?: number) => Promise<string>;
  imageTools?: WorkflowImageToolHandlers;
  onOpenAgent?: () => void;
  agentOpen?: boolean;
  rightPanelInset?: number;
  t?: (key: string, ...args: any[]) => string;
  theme?: 'light' | 'dark';
  language?: 'en' | 'zho';
  userApiKeys?: UserApiKey[];
  confirmRouteFallback?: (resolution: RouteFallbackResolution) => boolean | Promise<boolean>;
  dynamicModelOptions?: WorkflowModelOptions;
  onOpenSettings?: () => void;
  onEnhancePrompt?: (payload: { prompt: string; mode: PromptEnhanceMode; stylePreset?: string }) => Promise<PromptEnhanceResult>;
  isEnhancingPrompt?: boolean;
  assetLibrary?: AssetLibrary;
  focusNodeRequest?: { nodeId: string; nonce: number };
  onOpenAssets?: () => void;
}) {
  useProductionProjectionAdapter(project.id);
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef(project);
  const viewportRef = useRef(project.viewport);
  const selectedIdsRef = useRef(project.selectedNodeIds || []);
  const interactionRef = useRef<Interaction | null>(null);
  const pendingMoveRef = useRef<{ clientX: number; clientY: number; pointerId: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const focusAnimRef = useRef<number | null>(null);
  const spacePressedRef = useRef(false);
  const createMenuOpenerRef = useRef<HTMLElement | null>(null);
  const clipboardRef = useRef<WorkflowNodeData[]>([]);
  const mountedRef = useRef(true);
  const mousePosRef = useRef({ x: 0, y: 0 });
  const replaceSequenceRef = useRef(new Map<string, number>());
  const mediaReferenceOwnerRef = useRef(`workflow-editor-${nanoid()}`);
  const [tool, setTool] = useState<WorkflowTool>('select');
  const [wheelMode, setWheelMode] = useState<'pan' | 'zoom'>('pan');
  const [minimapOpen, setMinimapOpen] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [edgesVisible, setEdgesVisible] = useState(true);
  const snapEnabledRef = useRef(false);
  snapEnabledRef.current = snapEnabled;
  const [snapGuides, setSnapGuides] = useState<{ x?: number[]; y?: number[] } | null>(null);
  const [layoutToast, setLayoutToast] = useState<{ prev: WorkflowNodeData[]; deadline: number } | null>(null);
  const [clipboardVersion, setClipboardVersion] = useState(0);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(project.selectedNodeIds || []);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [connectionDrag, setConnectionDrag] = useState<{ sourceId: string; point: WorkflowPoint; targetId: string | null; direction: 'out' | 'in'; local: WorkflowPoint } | null>(null);
  const [createMenu, setCreateMenu] = useState<WorkflowCreateMenuState | null>(null);
  const [contextMenu, setContextMenu] = useState<WorkflowContextMenuState | null>(null);
  const [renameSignal, setRenameSignal] = useState<{ nodeId: string; nonce: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusBadge, setFocusBadge] = useState(false);
  const [overlayHidden, setOverlayHidden] = useState(false);
  const [promptFocusSignal, setPromptFocusSignal] = useState(0);
  const [imageTool, setImageTool] = useState<WorkflowImageToolState | null>(null);
  const [imageToolBusy, setImageToolBusy] = useState(false);
  const [imageToolError, setImageToolError] = useState<string | null>(null);
  const [videoTool, setVideoTool] = useState<WorkflowVideoToolState | null>(null);
  const [videoToolBusy, setVideoToolBusy] = useState(false);
  const [videoToolError, setVideoToolError] = useState<string | null>(null);
  const [audioTool, setAudioTool] = useState<WorkflowAudioToolState | null>(null);
  const [audioToolBusy, setAudioToolBusy] = useState(false);
  const [audioToolError, setAudioToolError] = useState<string | null>(null);
  const [storyboardNodeIds, setStoryboardNodeIds] = useState<string[] | null>(null);
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const [batchPreviewIds, setBatchPreviewIds] = useState<Record<string, string>>({});
  const [scriptEditorNodeId, setScriptEditorNodeId] = useState<string | null>(null);
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number } | null>(null);
  const [previewNode, setPreviewNode] = useState<WorkflowNodeData | null>(null);
  const [activeMedia, setActiveMedia] = useState<{ projectId: string; nodeId: string } | null>(null);
  const slashMenuRef = useRef<{ x: number; y: number } | null>(null);
  slashMenuRef.current = slashMenu;
  const toggleBatch = useCallback((batchId: string) => {
    setActiveMedia(null);
    setExpandedBatches(prev => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
      return next;
    });
  }, []);
  const imageToolBusyRef = useRef(false);
  const imageToolTransactionRef = useRef<ImageToolTransaction | null>(null);
  const videoToolBusyRef = useRef(false);
  const videoToolTransactionRef = useRef<ImageToolTransaction | null>(null);
  const audioToolBusyRef = useRef(false);
  const audioToolTransactionRef = useRef<ImageToolTransaction | null>(null);

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
    const onMove = (e: MouseEvent) => { mousePosRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    registerWorkflowMediaTransientReferences(mediaReferenceOwnerRef.current, [
      project.nodes,
      ...(project.draftChangeSets || []).flatMap(changeSet => changeSet.nodeChanges.flatMap(change => [
        change.before ? [change.before] : [],
        change.after ? [change.after] : [],
      ])),
      clipboardRef.current,
    ]);
    void pruneWorkflowMedia();
  }, [clipboardVersion, project.draftChangeSets, project.nodes]);

  const patchProject = useCallback((patch: Partial<WorkflowProject>) => {
    const previousNodes = projectRef.current.nodes;
    projectRef.current = { ...projectRef.current, ...patch };
    if (patch.nodes) {
      registerWorkflowMediaTransientReferences(mediaReferenceOwnerRef.current, [
        previousNodes,
        projectRef.current.nodes,
      ]);
    }
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
    if (focusAnimRef.current !== null) window.cancelAnimationFrame(focusAnimRef.current);
    focusAnimRef.current = null;
    pendingMoveRef.current = null;
    setSelectedConnectionId(null);
    setSelectionBox(null);
    setConnectionDrag(null);
    setCreateMenu(null);
    setImageTool(null);
    setImageToolBusy(false);
    setImageToolError(null);
    imageToolBusyRef.current = false;
    imageToolTransactionRef.current = null;
    setActiveMedia(null);
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

  useEffect(() => {
    if (!activeMedia) return;
    const activeNode = project.nodes.find(node => node.id === activeMedia.nodeId);
    if (activeMedia.projectId !== project.id
      || activeNode?.type !== 'video'
      || activeNode.isVisible === false
      || !(activeNode.metadata.storageKey || activeNode.metadata.href || activeNode.metadata.artifactRef?.taskId)) {
      setActiveMedia(null);
    }
  }, [activeMedia, project.id, project.nodes]);

  useEffect(() => {
    if (imageTool || videoTool || audioTool || previewNode) setActiveMedia(null);
  }, [audioTool, imageTool, previewNode, videoTool]);

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

  const applyDraftProject = useCallback((next: WorkflowProject) => {
    patchProject({
      nodes: next.nodes,
      connections: next.connections,
      selectedNodeIds: next.selectedNodeIds,
      draftVersion: next.draftVersion,
      draftChangeSets: next.draftChangeSets,
      draftRedoStack: next.draftRedoStack,
    });
    selectedIdsRef.current = next.selectedNodeIds;
    setSelectedNodeIds(next.selectedNodeIds);
  }, [patchProject]);

  const pushHistory = useCallback((frame: Frame, nextFrame: Frame = currentFrame(), intent = '编辑画布') => {
    const recorded = recordWorkflowDraftSnapshotChange(projectRef.current, frame, nextFrame, { actor: 'ui', intent });
    if (recorded.ok === false) return false;
    applyDraftProject(recorded.project);
    return true;
  }, [applyDraftProject, currentFrame]);

  const commitFrame = useCallback((nodes: WorkflowNodeData[], connections: WorkflowConnection[]) => {
    pushHistory(currentFrame(), { nodes, connections });
  }, [currentFrame, pushHistory]);

  const autoLayout = useCallback(() => {
    const nodes = projectRef.current.nodes;
    if (!nodes.length) return;
    const positions = computeHierarchicalLayout(nodes, projectRef.current.connections);
    if (!positions.size) return;
    const prev = nodes.map(node => ({ ...node, position: { ...node.position } }));
    const next = nodes.map(node => {
      const p = positions.get(node.id);
      return p ? { ...node, position: { x: p.x, y: p.y } } : node;
    });
    commitFrame(next, projectRef.current.connections);
    setLayoutToast({ prev, deadline: Date.now() + 6000 });
  }, [commitFrame]);

  const restoreLayout = useCallback(() => {
    setLayoutToast(prev => {
      if (!prev) return null;
      commitFrame(prev.prev, projectRef.current.connections);
      return null;
    });
  }, [commitFrame]);

  useEffect(() => {
    if (!layoutToast) return;
    const remaining = layoutToast.deadline - Date.now();
    if (remaining <= 0) { setLayoutToast(null); return; }
    const timer = window.setTimeout(() => setLayoutToast(null), remaining);
    return () => window.clearTimeout(timer);
  }, [layoutToast]);

  const imageToolRuntime = useMemo<WorkflowImageOperationRuntime>(() => ({
    userApiKeys,
    confirmRouteFallback,
    getProject: () => projectRef.current,
    onProjectChange: next => {
      if (next.id !== projectRef.current.id) return;
      projectRef.current = next;
      patchProject({
        nodes: next.nodes,
        connections: next.connections,
        selectedNodeIds: next.selectedNodeIds,
        draftVersion: next.draftVersion,
        updatedAt: next.updatedAt,
      });
      selectedIdsRef.current = next.selectedNodeIds;
      setSelectedNodeIds(next.selectedNodeIds);
    },
  }), [confirmRouteFallback, patchProject, userApiKeys]);

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
      void runWorkflowRemoveBackgroundOperation(transaction.projectId, nodeId, imageToolRuntime).then(result => {
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
    rotate: id => openImageTool('rotate', id), splitGrid: id => openImageTool('splitGrid', id), annotate: id => openImageTool('annotate', id), relight: id => openImageTool('relight', id),
    storyboard: ids => { setStoryboardNodeIds(ids); openImageTool('storyboard', ids[0]); },
  }), [openImageTool]);

  const openVideoTool = useCallback((kind: WorkflowVideoToolState['kind'], nodeId: string) => {
    if (videoToolTransactionRef.current || videoTool || videoToolBusyRef.current) {
      setNotice('请先完成或关闭当前视频工具');
      return;
    }
    if (projectRef.current.nodes.find(node => node.id === nodeId)?.metadata.status === 'loading') return;
    setVideoToolError(null);
    const transaction = { id: nanoid(), projectId: projectRef.current.id, nodeId, frame: currentFrame() };
    videoToolTransactionRef.current = transaction;
    setVideoTool({ kind, nodeId });
  }, [currentFrame, videoTool]);

  const handleExtractFrame = useCallback(async (id: string, position: 'first' | 'current' | 'last', currentTimeSec?: number) => {
    if (videoToolBusyRef.current) return;
    const node = projectRef.current.nodes.find(item => item.id === id);
    if (!node || node.type !== 'video') return;
    const projectId = projectRef.current.id;
    const frame = currentFrame();
    videoToolBusyRef.current = true;
    setVideoToolBusy(true);
    setVideoToolError(null);
    try {
      const result = await runWorkflowVideoExtractFrameOperation(projectId, id, position, imageToolRuntime, currentTimeSec);
      if (result.status === 'committed' && projectRef.current.id === projectId) {
        pushHistory(frame);
        setNotice(position === 'first' ? '首帧已通过 Operation 导出' : position === 'last' ? '尾帧已通过 Operation 导出' : '当前帧已通过 Operation 导出');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '帧导出失败');
    } finally {
      videoToolBusyRef.current = false;
      setVideoToolBusy(false);
    }
  }, [currentFrame, imageToolRuntime, pushHistory]);

  const builtInVideoTools = useMemo<WorkflowVideoToolHandlers>(() => ({
    trim: id => openVideoTool('trim', id),
    avSplit: id => openVideoTool('av-split', id),
    merge: ids => { if (ids.length > 0) openVideoTool('merge', ids[0]); },
    extractFrame: handleExtractFrame,
    extractFrameAt: id => openVideoTool('extract-frame', id),
  }), [openVideoTool, handleExtractFrame]);

  const activeVideoToolNode = videoTool ? project.nodes.find(node => node.id === videoTool.nodeId) || null : null;
  const activeVideoToolMedia = useWorkflowMediaUrl(activeVideoToolNode?.metadata.storageKey, activeVideoToolNode?.metadata.href);

  const closeVideoTool = useCallback(() => {
    const transaction = videoToolTransactionRef.current;
    if (!videoTool || !transaction || videoToolBusyRef.current) return;
    setVideoTool(null);
    setVideoToolError(null);
    videoToolTransactionRef.current = null;
    videoToolBusyRef.current = false;
    setVideoToolBusy(false);
  }, [videoTool]);

  const confirmVideoTool = useCallback(async (confirmation: WorkflowVideoToolConfirmation) => {
    const transaction = videoToolTransactionRef.current;
    if (!videoTool || !transaction || videoToolBusyRef.current) return;
    const node = projectRef.current.nodes.find(item => item.id === videoTool.nodeId);
    if (!node) return;
    videoToolBusyRef.current = true;
    setVideoToolBusy(true);
    setVideoToolError(null);
    try {
      let result: WorkflowImageToolOutcome | null = null;
      let successNotice = '';
      if (confirmation.kind === 'trim') {
        result = await runWorkflowVideoTrimOperation(transaction.projectId, node.id, {
          startSec: confirmation.startSec,
          endSec: confirmation.endSec,
        }, imageToolRuntime);
        successNotice = '视频剪辑完成';
      } else if (confirmation.kind === 'av-split') {
        result = await runWorkflowVideoAvSplitOperation(transaction.projectId, node.id, imageToolRuntime);
        successNotice = '音视频分离完成';
      } else if (confirmation.kind === 'extract-frame') {
        result = await runWorkflowVideoExtractFrameOperation(transaction.projectId, node.id, confirmation.position, imageToolRuntime, confirmation.currentTimeSec);
        successNotice = `已提取 ${confirmation.currentTimeSec != null ? `${confirmation.currentTimeSec.toFixed(1)}s` : confirmation.position === 'last' ? '尾帧' : '首帧'}`;
      } else if (confirmation.kind === 'merge') {
        const selectedNodes = projectRef.current.nodes.filter(n => n.type === 'video' && (confirmation.nodeIds.length === 0 || confirmation.nodeIds.includes(n.id)));
        if (selectedNodes.length < 2) { setVideoToolError('至少需要选择 2 个视频节点'); return; }
        result = await runWorkflowVideoMergeOperation(transaction.projectId, selectedNodes.map(item => item.id), imageToolRuntime);
        successNotice = '视频拼接完成';
      }
      if (result?.status === 'committed' && result.project.id === transaction.projectId && projectRef.current.id === transaction.projectId) {
        pushHistory(transaction.frame);
        setNotice(successNotice);
        setVideoTool(null);
        videoToolTransactionRef.current = null;
      } else if (result?.status === 'stale') {
        setVideoTool(null);
        setVideoToolError(null);
        videoToolTransactionRef.current = null;
      }
    } catch (error) {
      setVideoToolError(error instanceof Error ? error.message : '视频处理失败');
    } finally {
      videoToolBusyRef.current = false;
      setVideoToolBusy(false);
    }
  }, [imageToolRuntime, pushHistory, videoTool]);

  const openAudioTool = useCallback((kind: WorkflowAudioToolState['kind'], nodeId: string) => {
    if (audioToolTransactionRef.current || audioTool || audioToolBusyRef.current) {
      setNotice('请先完成或关闭当前音频工具');
      return;
    }
    if (projectRef.current.nodes.find(node => node.id === nodeId)?.metadata.status === 'loading') return;
    setAudioToolError(null);
    const transaction = { id: nanoid(), projectId: projectRef.current.id, nodeId, frame: currentFrame() };
    audioToolTransactionRef.current = transaction;
    setAudioTool({ kind, nodeId });
  }, [currentFrame, audioTool]);

  const builtInAudioTools = useMemo<WorkflowAudioToolHandlers>(() => ({
    trim: id => openAudioTool('trim', id),
    speed: id => openAudioTool('speed', id),
    stemSplit: id => openAudioTool('stem-split', id),
  }), [openAudioTool]);

  const activeAudioToolNode = audioTool ? project.nodes.find(node => node.id === audioTool.nodeId) || null : null;
  const activeAudioToolMedia = useWorkflowMediaUrl(activeAudioToolNode?.metadata.storageKey, activeAudioToolNode?.metadata.href);

  const closeAudioTool = useCallback(() => {
    const transaction = audioToolTransactionRef.current;
    if (!audioTool || !transaction || audioToolBusyRef.current) return;
    setAudioTool(null);
    setAudioToolError(null);
    audioToolTransactionRef.current = null;
    audioToolBusyRef.current = false;
    setAudioToolBusy(false);
  }, [audioTool]);

  const confirmAudioTool = useCallback(async (confirmation: WorkflowAudioToolConfirmation) => {
    const transaction = audioToolTransactionRef.current;
    if (!audioTool || !transaction || audioToolBusyRef.current) return;
    const node = projectRef.current.nodes.find(item => item.id === audioTool.nodeId);
    if (!node) return;
    audioToolBusyRef.current = true;
    setAudioToolBusy(true);
    setAudioToolError(null);
    try {
      let result: WorkflowImageToolOutcome;
      let successNotice: string;
      if (confirmation.kind === 'trim') {
        result = await runWorkflowAudioTrimOperation(transaction.projectId, node.id, {
          startSec: confirmation.startSec,
          endSec: confirmation.endSec,
        }, imageToolRuntime);
        successNotice = '音频截取完成';
      } else if (confirmation.kind === 'speed') {
        result = await runWorkflowAudioSpeedOperation(transaction.projectId, node.id, confirmation.speed, imageToolRuntime);
        successNotice = `音频变速完成 (${confirmation.speed.toFixed(2)}x)`;
      } else {
        result = await runWorkflowAudioStemSplitOperation(transaction.projectId, node.id, imageToolRuntime);
        successNotice = '人声/伴奏分离完成';
      }
      if (result.status === 'committed' && result.project.id === transaction.projectId && projectRef.current.id === transaction.projectId) {
        pushHistory(transaction.frame);
        setNotice(successNotice);
        setAudioTool(null);
        audioToolTransactionRef.current = null;
      } else if (result.status === 'stale') {
        setAudioTool(null);
        setAudioToolError(null);
        audioToolTransactionRef.current = null;
      }
    } catch (error) {
      setAudioToolError(error instanceof Error ? error.message : '音频处理失败');
    } finally {
      audioToolBusyRef.current = false;
      setAudioToolBusy(false);
    }
  }, [audioTool, imageToolRuntime, pushHistory]);

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
        // 裁剪走显式 Operation：源图片 → Operation → 结果图片，不再原地覆盖源媒体。
        const result = await runWorkflowCropOperation(transaction.projectId, node.id, confirmation.crop, imageToolRuntime);
        if (!ownsImageToolTransaction(transaction)) return;
        if (result.status === 'committed' && result.project.id === transaction.projectId && result.project.nodes.some(item => item.id === transaction.nodeId)) {
          pushHistory(transaction.frame);
          setNotice('图片裁剪完成');
          setImageTool(null);
          releaseImageToolTransaction(transaction);
        }
        else if (result?.status === 'stale') { setImageTool(null); setImageToolError(null); releaseImageToolTransaction(transaction); }
        return;
      }
      if (confirmation.kind === 'rotate') {
        const result = await runWorkflowRotateOperation(transaction.projectId, node.id, confirmation.action, imageToolRuntime);
        if (!ownsImageToolTransaction(transaction)) return;
        if (result.status === 'committed') { pushHistory(transaction.frame); setNotice('旋转镜像完成'); setImageTool(null); releaseImageToolTransaction(transaction); }
        else { setImageTool(null); setImageToolError(null); releaseImageToolTransaction(transaction); }
        return;
      }
      if (confirmation.kind === 'splitGrid') {
        const result = await runWorkflowSplitGridOperation(transaction.projectId, node.id, { rows: confirmation.rows, cols: confirmation.cols }, imageToolRuntime);
        if (!ownsImageToolTransaction(transaction)) return;
        if (result.status === 'committed') { pushHistory(transaction.frame); setNotice(`宫格切分完成 (${confirmation.rows * confirmation.cols} 张)`); setImageTool(null); releaseImageToolTransaction(transaction); }
        else { setImageTool(null); setImageToolError(null); releaseImageToolTransaction(transaction); }
        return;
      }
      if (confirmation.kind === 'annotate') {
        const result = await runWorkflowImageEditOperation(transaction.projectId, node.id, '根据标注修改图片', 'annotate', { href: confirmation.annotatedDataUrl, mimeType: 'image/png' }, imageToolRuntime);
        if (!ownsImageToolTransaction(transaction)) return;
        if (result?.status === 'committed') { pushHistory(transaction.frame); setImageTool(null); releaseImageToolTransaction(transaction); }
        else if (result?.status === 'stale') { setImageTool(null); setImageToolError(null); releaseImageToolTransaction(transaction); }
        return;
      }
      if (confirmation.kind === 'relight') {
        const preset = LIGHTING_PRESETS.find(p => p.id === confirmation.preset)!;
        const prompt = buildRelightPrompt(preset, confirmation.intensity, confirmation.color, confirmation.smart);
        const result = await runWorkflowImageEditOperation(transaction.projectId, node.id, prompt, 'relight', undefined, imageToolRuntime);
        if (!ownsImageToolTransaction(transaction)) return;
        if (result?.status === 'committed') { pushHistory(transaction.frame); setImageTool(null); releaseImageToolTransaction(transaction); }
        else if (result?.status === 'stale') { setImageTool(null); setImageToolError(null); releaseImageToolTransaction(transaction); }
        return;
      }
      if (confirmation.kind === 'storyboard') {
        const ids = storyboardNodeIds || [];
        const sourceNodes = projectRef.current.nodes.filter(n => ids.includes(n.id) && n.type === 'image');
        if (sourceNodes.length < 2) { setImageToolError('至少需要 2 张图片'); return; }
        const sources = sourceNodes.map(n => ({ storageKey: n.metadata.storageKey, href: n.metadata.href }));
        const labels = confirmation.showIndex ? sourceNodes.map((_, i) => `#${i + 1}`) : undefined;
        const composedBlob = await composeImageGrid(sources, { cols: confirmation.cols, labels });
        const record = await ingestWorkflowMedia(new File([composedBlob], 'storyboard.png', { type: 'image/png' }));
        if (!ownsImageToolTransaction(transaction)) { await discardWorkflowMediaRecord(record.storageKey); return; }
        const lastNode = sourceNodes[sourceNodes.length - 1];
        const size = fitWorkflowMediaSize('image', record.naturalWidth || 1024, record.naturalHeight || 768);
        pushHistory(transaction.frame, {
          nodes: [...projectRef.current.nodes, { ...createWorkflowNode(nanoid(), 'image', { x: lastNode.position.x + lastNode.width + 40, y: lastNode.position.y }, { ...record, name: 'storyboard.png', status: 'success' }), ...size }],
          connections: projectRef.current.connections,
        }, '创建分镜组拼图');
        releaseWorkflowMediaRecord(record.storageKey);
        setNotice('分镜组拼接完成');
        setStoryboardNodeIds(null);
        setImageTool(null);
        releaseImageToolTransaction(transaction);
        return;
      }
      let result: WorkflowImageToolOutcome | null = null;
      if (confirmation.kind === 'upscale') result = await runWorkflowUpscaleOperation(transaction.projectId, node.id, { targetLongEdge: confirmation.targetLongEdge, algorithm: confirmation.algorithm }, imageToolRuntime);
      if (confirmation.kind === 'split') result = await runWorkflowSplitLayersOperation(transaction.projectId, node.id, imageToolRuntime);
      if (confirmation.kind === 'outpaint') result = await runWorkflowImageEditOperation(transaction.projectId, node.id, `向${{ left: '左侧', right: '右侧', top: '上方', bottom: '下方', all: '四周' }[confirmation.direction]}扩展画面。${confirmation.prompt}`, 'outpaint', undefined, imageToolRuntime);
      if (confirmation.kind === 'mask') result = await runWorkflowImageEditOperation(transaction.projectId, node.id, confirmation.prompt, 'mask', { href: confirmation.maskDataUrl, mimeType: 'image/png' }, imageToolRuntime);
      if (!ownsImageToolTransaction(transaction)) return;
      if (result?.status === 'committed' && result.project.id === transaction.projectId && projectRef.current.id === transaction.projectId && result.project.nodes.some(item => item.id === transaction.nodeId)) {
        pushHistory(transaction.frame);
        if (confirmation.kind === 'upscale') setNotice('高清放大完成');
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
    // 自动命名：未自定义标题的新节点按「类型 + 序号」命名，避免画布上全是「图片」「视频」
    const snapshot = projectRef.current;
    const renamedOps = ops.map(op => {
      if (op.type !== 'add_node') return op;
      const specTitle = WORKFLOW_NODE_SPECS[op.node.type].title;
      if (op.node.title !== specTitle) return op;
      const count = snapshot.nodes.filter(node => node.type === op.node.type).length + 1;
      return { ...op, node: { ...op.node, title: `${specTitle} ${count}` } };
    });
    const result = applyWorkflowDraftChangeSet(projectRef.current, {
      actor: 'ui',
      intent: summarizeWorkflowOps(renamedOps) || '编辑画布',
      ops: renamedOps,
    });
    if (result.ok === false) {
      setNotice(result.error.message);
      return false;
    }
    applyDraftProject(result.project);
    setNotice(null);
    result.runRequests.forEach(({ nodeId }) => onRunNode(nodeId));
    return true;
  }, [applyDraftProject, onRunNode]);

  const assetFolders = useMemo(() => assetLibrary?.folders || [], [assetLibrary]);
  const assetSuggestions = useMemo<AssetSuggestion[]>(() => (assetLibrary?.items || []).map(item => ({
    id: item.id,
    name: item.name || '未命名',
    folderIds: item.folderIds,
    tags: item.tags,
    thumbnail: item.dataUrl,
    elementType: (item.mimeType.startsWith('video/') ? 'video' : 'image') as 'image' | 'video',
  })), [assetLibrary]);

  const handleResolvePastedMentions = useCallback((mentions: MentionData[], targetNodeId: string): Array<MentionData | null> => {
    const snapshot = currentSnapshot();
    const result = buildWorkflowPromptPasteOps({
      targetNodeId,
      snapshot,
      assets: assetLibrary?.items || [],
      mentions,
      createId: nanoid,
    });
    if (result.ops.length > 0 && !applyOps(result.ops)) return mentions.map(() => null);
    selectNodes([targetNodeId]);
    return result.resolvedMentions as Array<MentionData | null>;
  }, [applyOps, assetLibrary, currentSnapshot, selectNodes]);

  const handleSelectAsset = useCallback((assetId: string, fromNodeId: string): string | undefined => {
    const snapshot = currentSnapshot();
    const targetNode = snapshot.nodes.find(n => n.id === fromNodeId);
    if (!targetNode) return undefined;
    const asset = assetLibrary?.items.find(a => a.id === assetId);
    if (!asset) return undefined;

    const upstreamConn = snapshot.connections.filter(c => c.toNodeId === fromNodeId);
    for (const conn of upstreamConn) {
      const upstreamNode = snapshot.nodes.find(n => n.id === conn.fromNodeId);
      if (upstreamNode?.metadata.assetId === assetId && upstreamNode.metadata.sourceType === 'assetLibrary') {
        const order = targetNode.metadata.imageReferenceOrder || [];
        const mentions = targetNode.metadata.mentionedNodeIds || [];
        if (!order.includes(upstreamNode.id) || !mentions.includes(upstreamNode.id)) applyOps([{ type: 'update_node', id: fromNodeId, metadata: {
          imageReferenceOrder: [...order.filter(id => id !== upstreamNode.id), upstreamNode.id],
          mentionedNodeIds: [...mentions.filter(id => id !== upstreamNode.id), upstreamNode.id],
        } }]);
        return upstreamNode.id;
      }
    }

    const nodeId = nanoid();
    const gapY = 120;
    const newNodeY = targetNode.position.y - 240 - gapY;
    const newNodeX = targetNode.position.x + (targetNode.width - 340) / 2;

    const mediaType = asset.mimeType.startsWith('video/') ? 'video' : 'image';
    const newNode = createWorkflowNode(nodeId, mediaType, { x: newNodeX, y: newNodeY }, {
      sourceType: 'assetLibrary',
      assetId,
      href: `asset-library:${assetId}`,
      name: asset.name || '素材引用',
      mimeType: asset.mimeType,
      naturalWidth: asset.width,
      naturalHeight: asset.height,
      status: 'success',
    });

    const currentOrder = targetNode.metadata.imageReferenceOrder || [];
    const newOrder = [...currentOrder, nodeId];
    const currentMentions = targetNode.metadata.mentionedNodeIds || [];

    const ops: WorkflowOp[] = [
      { type: 'add_node', node: newNode },
      { type: 'connect_nodes', fromNodeId: nodeId, toNodeId: fromNodeId },
      { type: 'update_node', id: fromNodeId, metadata: { imageReferenceOrder: newOrder, mentionedNodeIds: [...currentMentions, nodeId] } },
    ];

    const success = applyOps(ops);
    return success ? nodeId : undefined;
  }, [applyOps, assetLibrary, currentSnapshot]);

  const handleSelectWorkflowReference = useCallback((nodeId: string, targetNodeId: string): string | undefined => {
    const snapshot = currentSnapshot();
    const target = snapshot.nodes.find(node => node.id === targetNodeId);
    const source = snapshot.nodes.find(node => node.id === nodeId);
    if (!target || !source || source.id === target.id || !['image', 'video', 'audio'].includes(source.type)) return undefined;
    const alreadyConnected = snapshot.connections.some(connection => connection.fromNodeId === nodeId && connection.toNodeId === targetNodeId);
    const nextOrder = [...(target.metadata.imageReferenceOrder || []).filter(id => id !== nodeId), nodeId];
    const nextMentions = [...(target.metadata.mentionedNodeIds || []).filter(id => id !== nodeId), nodeId];
    const ops: WorkflowOp[] = [];
    if (!alreadyConnected) ops.push({ type: 'connect_nodes', fromNodeId: nodeId, toNodeId: targetNodeId });
    ops.push({ type: 'update_node', id: targetNodeId, metadata: { imageReferenceOrder: nextOrder, mentionedNodeIds: nextMentions } });
    return applyOps(ops) ? nodeId : undefined;
  }, [applyOps, currentSnapshot]);

  const handleAddReferenceFiles = useCallback(async (files: File[], targetNodeId: string) => {
    const expectedProjectId = projectRef.current.id;
    const records: WorkflowMediaRecord[] = [];
    try {
      for (const file of files.filter(file => file.type.startsWith('image/'))) records.push(await ingestWorkflowMedia(file));
      if (!records.length) throw new Error('请选择图片文件');
      if (!mountedRef.current || projectRef.current.id !== expectedProjectId) throw new Error('工作流已切换，请重新上传');
      const snapshot = currentSnapshot();
      const target = snapshot.nodes.find(node => node.id === targetNodeId);
      if (!target) throw new Error('当前生成节点已不存在');
      const nodes = records.map((record, index) => {
        const { type, ...metadata } = record;
        const size = fitWorkflowMediaSize(type, record.naturalWidth, record.naturalHeight);
        const x = target.position.x + target.width / 2 + (index - (records.length - 1) / 2) * (size.width + 24) - size.width / 2;
        return { ...createWorkflowNode(nanoid(), type, { x, y: target.position.y - size.height - 100 }, { ...metadata, status: 'success' }), ...size, freeResize: false };
      });
      const ids = nodes.map(item => item.id);
      const ops: WorkflowOp[] = nodes.map(node => ({ type: 'add_node', node }));
      ids.forEach(id => ops.push({ type: 'connect_nodes', fromNodeId: id, toNodeId: targetNodeId }));
      ops.push({ type: 'update_node', id: targetNodeId, metadata: {
        imageReferenceOrder: [...(target.metadata.imageReferenceOrder || []), ...ids],
        mentionedNodeIds: [...(target.metadata.mentionedNodeIds || []), ...ids],
      } });
      if (!applyOps(ops)) throw new Error('参考图节点连接失败');
      records.forEach(record => releaseWorkflowMediaRecord(record.storageKey));
    } catch (error) {
      await Promise.all(records.map(record => discardWorkflowMediaRecord(record.storageKey)));
      setNotice(error instanceof Error ? error.message : '参考图上传失败');
    }
  }, [applyOps, currentSnapshot]);

  const handleScriptBatchGenerate = useCallback((scriptNodeId: string, mode: 'image' | 'video') => {
    const snapshot = currentSnapshot();
    const scriptNode = snapshot.nodes.find(n => n.id === scriptNodeId);
    if (!scriptNode || scriptNode.type !== 'script') return;
    const breakdown = scriptNode.metadata.scriptBreakdown;
    if (!breakdown || breakdown.shots.length === 0) return;

    const shotsToGenerate = breakdown.shots.filter(shot => {
      const existingId = mode === 'image' ? shot.imageNodeId : shot.videoNodeId;
      if (existingId && snapshot.nodes.some(n => n.id === existingId)) return false;
      const promptOverride = mode === 'image' ? shot.imagePromptOverride : shot.videoPromptOverride;
      return Boolean(promptOverride || shot.action || shot.scene);
    });
    if (shotsToGenerate.length === 0) return;

    const nodeWidth = mode === 'image' ? 340 : 420;
    const nodeHeight = mode === 'image' ? 240 : 236;
    const gapX = 20;
    const gapY = 20;
    const perRow = 5;
    const startX = scriptNode.position.x + scriptNode.width + 80;
    const startY = scriptNode.position.y;

    const rightEdge = Math.max(startX, ...snapshot.nodes
      .filter(n => n.position.x < startX + perRow * (nodeWidth + gapX) && n.position.x + n.width > startX)
      .map(n => n.position.x + n.width + gapX));
    const originX = rightEdge > startX ? rightEdge : startX;

    const ops: WorkflowOp[] = [];
    const newNodeIds: string[] = [];
    const batchId = nanoid();
    const updatedShots: ScriptShot[] = [...breakdown.shots];

    shotsToGenerate.forEach((shot, index) => {
      const col = index % perRow;
      const row = Math.floor(index / perRow);
      const nodeId = nanoid();
      newNodeIds.push(nodeId);
      const promptOverride = mode === 'image' ? shot.imagePromptOverride : shot.videoPromptOverride;
      const prompt = promptOverride || [shot.scene, shot.action, shot.emotion].filter(Boolean).join(', ');
      const newNode = createWorkflowNode(nodeId, mode, {
        x: originX + col * (nodeWidth + gapX),
        y: startY + row * (nodeHeight + gapY),
      }, { prompt, status: 'idle', referenceNodeIds: [scriptNodeId] });
      newNode.title = `分镜 ${shot.index + 1}`;
      ops.push({ type: 'add_node', node: newNode });
      ops.push({ type: 'connect_nodes', fromNodeId: scriptNodeId, toNodeId: nodeId });
      const shotIndex = updatedShots.findIndex(s => s.id === shot.id);
      if (shotIndex >= 0) {
        updatedShots[shotIndex] = mode === 'image'
          ? { ...updatedShots[shotIndex], imageNodeId: nodeId }
          : { ...updatedShots[shotIndex], videoNodeId: nodeId };
      }
    });

    ops.push({ type: 'update_node', id: scriptNodeId, metadata: { ...scriptNode.metadata, scriptBreakdown: { ...breakdown, shots: updatedShots } } });
    ops.push({ type: 'group_nodes', ids: newNodeIds, batchId, source: 'auto' });

    const success = applyOps(ops);
    if (success) {
      newNodeIds.forEach(id => void onRunNode(id));
      selectNodes(newNodeIds);
    }
  }, [applyOps, currentSnapshot, onRunNode, selectNodes]);

  const screenToWorkflow = useCallback((clientX: number, clientY: number): WorkflowPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    const viewport = viewportRef.current;
    return {
      x: (clientX - (rect?.left || 0) - viewport.x) / viewport.k,
      y: (clientY - (rect?.top || 0) - viewport.y) / viewport.k,
    };
  }, []);

  const worldToScreen = useCallback((world: WorkflowPoint): WorkflowPoint => {
    const viewport = viewportRef.current;
    return { x: world.x * viewport.k + viewport.x, y: world.y * viewport.k + viewport.y };
  }, []);

  const viewportCenter = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    const availableWidth = Math.max(360, (rect?.width || 1000) - (rightPanelInset || 0));
    return screenToWorkflow((rect?.left || 0) + availableWidth / 2, (rect?.top || 0) + (rect?.height || 700) / 2);
  }, [rightPanelInset, screenToWorkflow]);

  const focusNode = useCallback((id: string) => {
    const node = projectRef.current.nodes.find(n => n.id === id);
    if (!node) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const availableWidth = Math.max(360, rect.width - (rightPanelInset || 0));
    const padding = 120;
    const targetK = Math.min(1.5, Math.max(0.12, Math.min((availableWidth - padding) / Math.max(1, node.width), (rect.height - padding) / Math.max(1, node.height))));
    const nodeCenterX = node.position.x + node.width / 2;
    const nodeCenterY = node.position.y + node.height / 2;
    const targetX = availableWidth / 2 - nodeCenterX * targetK;
    const targetY = rect.height / 2 - nodeCenterY * targetK;
    const start = { ...viewportRef.current };
    const dx = targetX - start.x;
    const dy = targetY - start.y;
    const dk = targetK - start.k;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(dk) < 0.01) { setFocusBadge(true); return; }
    if (focusAnimRef.current !== null) window.cancelAnimationFrame(focusAnimRef.current);
    setFocusBadge(false);
    const duration = 420;
    const startTime = window.performance.now();
    const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const e = easeInOutCubic(t);
      patchProject({ viewport: { x: start.x + dx * e, y: start.y + dy * e, k: start.k + dk * e } });
      if (t < 1) {
        focusAnimRef.current = window.requestAnimationFrame(tick);
      } else {
        focusAnimRef.current = null;
        setFocusBadge(true);
      }
    };
    focusAnimRef.current = window.requestAnimationFrame(tick);
  }, [patchProject, rightPanelInset]);

  useEffect(() => {
    if (!focusNodeRequest) return;
    const node = projectRef.current.nodes.find(item => item.id === focusNodeRequest.nodeId);
    if (!node) return;
    selectNodes([node.id]);
    focusNode(node.id);
  }, [focusNode, focusNodeRequest, selectNodes]);

  const handleSlashCommand = useCallback((command: SlashCommand) => {
    setSlashMenu(null);
    const snapshot = currentSnapshot();
    const selectedNodes = selectedIdsRef.current
      .map(id => snapshot.nodes.find(n => n.id === id))
      .filter((n): n is WorkflowNodeData => Boolean(n));
    const sourceNodes = selectedNodes.filter(n => n.type === command.mode && n.metadata.status === 'success');
    if (sourceNodes.length < command.minSources) {
      setNotice(command.minSources === 1
        ? `请先选择至少 1 个已生成的${command.mode === 'image' ? '图片' : '视频'}节点作为源`
        : `请先选择至少 ${command.minSources} 个已生成的${command.mode === 'image' ? '图片' : '视频'}节点作为源`);
      return;
    }
    const usedSources = sourceNodes.slice(0, command.maxSources);
    const sourceIds = usedSources.map(n => n.id);
    const nodeWidth = command.mode === 'image' ? 340 : 420;
    const nodeHeight = command.mode === 'image' ? 240 : 236;
    const gapX = 20;
    const gapY = 20;
    const cols = command.gridCols;
    const center = viewportCenter();
    const totalWidth = cols * (nodeWidth + gapX) - gapX;
    const totalRows = Math.ceil(command.generateCount / cols);
    const totalHeight = totalRows * (nodeHeight + gapY) - gapY;
    const startX = center.x - totalWidth / 2;
    const startY = center.y - totalHeight / 2;
    const ops: WorkflowOp[] = [];
    const newNodeIds: string[] = [];
    const batchId = nanoid();
    for (let i = 0; i < command.generateCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const nodeId = nanoid();
      newNodeIds.push(nodeId);
      const prompt = command.promptBuilder(i, command.generateCount);
      const newNode = createWorkflowNode(nodeId, command.mode, {
        x: startX + col * (nodeWidth + gapX),
        y: startY + row * (nodeHeight + gapY),
      }, { prompt, status: 'idle', referenceNodeIds: sourceIds.length > 0 ? sourceIds : undefined, mentionedNodeIds: sourceIds.length > 0 ? sourceIds : undefined });
      newNode.title = `${command.label} ${i + 1}`;
      ops.push({ type: 'add_node', node: newNode });
      for (const sourceId of sourceIds) {
        ops.push({ type: 'connect_nodes', fromNodeId: sourceId, toNodeId: nodeId });
      }
    }
    ops.push({ type: 'group_nodes', ids: newNodeIds, batchId, source: 'auto' });
    const success = applyOps(ops);
    if (success) {
      newNodeIds.forEach(id => void onRunNode(id));
      selectNodes(newNodeIds);
    }
  }, [applyOps, currentSnapshot, onRunNode, selectNodes, viewportCenter]);

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
    if (event.dataTransfer?.types?.includes('Files')) {
      const dropTarget = event.target instanceof Element
        ? event.target.closest('.workflow-node--image, .workflow-node--video, .workflow-node--audio')
        : null;
      if (dropTarget) return;
    }
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
    const point = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
      ? screenToWorkflow(event.clientX, event.clientY)
      : viewportCenter();
    void addMediaAt(file, point);
  }, [addMediaAt, addSharedMediaAt, screenToWorkflow, viewportCenter]);

  const localPoint = useCallback((clientX: number, clientY: number): WorkflowPoint => {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left || 0), y: clientY - (rect?.top || 0) };
  }, []);

  const openCreateMenu = useCallback((clientX: number, clientY: number, sourceId?: string, targetId?: string) => {
    const rect = rootRef.current?.getBoundingClientRect();
    const local = localPoint(clientX, clientY);
    if ((!sourceId && !targetId) || !createMenuOpenerRef.current) createMenuOpenerRef.current = rootRef.current;
    setCreateMenu({
      world: screenToWorkflow(clientX, clientY),
      anchor: {
        x: Math.max(8, Math.min(local.x, (rect?.width || 1000) - 296)),
        y: Math.max(8, Math.min(local.y, (rect?.height || 700) - 360)),
      },
      sourceId,
      targetId,
    });
    setContextMenu(null);
  }, [localPoint, screenToWorkflow]);

  const getConnectionDropTarget = useCallback((clientX: number, clientY: number, originId: string, direction: 'out' | 'in'): ConnectionDropTarget => {
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
      const validation = direction === 'in'
        ? validateWorkflowConnection(snapshot, node.id, originId)
        : validateWorkflowConnection(snapshot, originId, node.id);
      if (validation.ok === false) {
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
      let dx = point.x - interaction.start.x;
      let dy = point.y - interaction.start.y;
      interaction.moved = dx !== 0 || dy !== 0;
      let snapGuidesState: { x?: number[]; y?: number[] } | null = null;
      if (snapEnabledRef.current && interaction.positions.size > 0) {
        const SNAP_THRESHOLD = 8;
        const draggedIds = new Set(interaction.positions.keys());
        const firstEntry = [...interaction.positions.entries()][0];
        const draggedNode = interaction.frame.nodes.find(n => n.id === firstEntry[0]);
        if (draggedNode) {
          const px = firstEntry[1].x + dx;
          const py = firstEntry[1].y + dy;
          const cx = px + draggedNode.width / 2;
          const cy = py + draggedNode.height / 2;
          const dragXLines = [px, px + draggedNode.width, cx];
          const dragYLines = [py, py + draggedNode.height, cy];
          let snapDx: number | null = null;
          let snapDy: number | null = null;
          let minDx = SNAP_THRESHOLD;
          let minDy = SNAP_THRESHOLD;
          const guideXs: number[] = [];
          const guideYs: number[] = [];
          for (const other of interaction.frame.nodes) {
            if (draggedIds.has(other.id)) continue;
            const ox = other.position.x;
            const oy = other.position.y;
            const ocx = ox + other.width / 2;
            const ocy = oy + other.height / 2;
            const otherXLines = [ox, ox + other.width, ocx];
            const otherYLines = [oy, oy + other.height, ocy];
            for (let i = 0; i < dragXLines.length; i++) {
              for (let j = 0; j < otherXLines.length; j++) {
                const dist = Math.abs(dragXLines[i] - otherXLines[j]);
                if (dist < minDx) { minDx = dist; snapDx = otherXLines[j] - dragXLines[i]; guideXs.length = 0; guideXs.push(otherXLines[j]); }
                else if (dist < SNAP_THRESHOLD * 0.5 && snapDx !== null) { guideXs.push(otherXLines[j]); }
              }
            }
            for (let i = 0; i < dragYLines.length; i++) {
              for (let j = 0; j < otherYLines.length; j++) {
                const dist = Math.abs(dragYLines[i] - otherYLines[j]);
                if (dist < minDy) { minDy = dist; snapDy = otherYLines[j] - dragYLines[i]; guideYs.length = 0; guideYs.push(otherYLines[j]); }
                else if (dist < SNAP_THRESHOLD * 0.5 && snapDy !== null) { guideYs.push(otherYLines[j]); }
              }
            }
          }
          const guides: { x?: number[]; y?: number[] } = {};
          if (snapDx !== null) { dx += snapDx; guides.x = guideXs; }
          if (snapDy !== null) { dy += snapDy; guides.y = guideYs; }
          if (guides.x || guides.y) snapGuidesState = guides;
        }
      }
      setSnapGuides(snapGuidesState);
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
    const dropTarget = getConnectionDropTarget(clientX, clientY, interaction.originId, interaction.direction);
    setConnectionDrag({ sourceId: interaction.originId, point: screenToWorkflow(clientX, clientY), targetId: dropTarget.nodeId, direction: interaction.direction, local: localPoint(clientX, clientY) });
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
    setSnapGuides(null);
    if (interaction.type === 'node' || interaction.type === 'resize') {
      if (interaction.moved) pushHistory(interaction.frame);
      return;
    }
    if (interaction.type === 'selection') {
      setSelectionBox(null);
      return;
    }
    if (interaction.type !== 'connection') return;

    const dropTarget = getConnectionDropTarget(clientX, clientY, interaction.originId, interaction.direction);
    setConnectionDrag(null);
    if (dropTarget.nodeId) {
      createMenuOpenerRef.current = null;
      if (interaction.direction === 'in') {
        applyOps([{ type: 'connect_nodes', fromNodeId: dropTarget.nodeId, toNodeId: interaction.originId }]);
      } else {
        applyOps([{ type: 'connect_nodes', fromNodeId: interaction.originId, toNodeId: dropTarget.nodeId }]);
      }
    } else if (dropTarget.isNearNode) {
      createMenuOpenerRef.current = null;
      setNotice(dropTarget.reason || '无法连接到该节点');
    } else if (interaction.direction === 'in') {
      openCreateMenu(clientX, clientY, undefined, interaction.originId);
    } else {
      openCreateMenu(clientX, clientY, interaction.originId, undefined);
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
    setSnapGuides(null);
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
    const result = undoWorkflowDraftChangeSet(projectRef.current);
    if (result.ok === false) return;
    applyDraftProject(result.project);
  }, [applyDraftProject]);

  const redo = useCallback(() => {
    const result = redoWorkflowDraftChangeSet(projectRef.current);
    if (result.ok === false) return;
    applyDraftProject(result.project);
  }, [applyDraftProject]);

  const syncToSharedClipboard = useCallback((nodes: WorkflowNodeData[]) => {
    const mediaNodes = nodes.filter(node => (node.type === 'image' || node.type === 'video') && (node.metadata.storageKey || node.metadata.href));
    if (mediaNodes.length === 0) return;
    void (async () => {
      const items: ClipItem[] = [];
      for (const node of mediaNodes) {
        try {
          const blob = await loadWorkflowMediaBlob(node.metadata.storageKey, node.metadata.href);
          items.push({
            id: nanoid(),
            kind: node.type as 'image' | 'video',
            blob,
            mimeType: node.metadata.mimeType || (node.type === 'image' ? 'image/png' : 'video/mp4'),
            name: node.metadata.name || node.title || `workflow-${node.type}`,
            naturalWidth: node.metadata.naturalWidth,
            naturalHeight: node.metadata.naturalHeight,
            sourceView: 'workflow',
          });
        } catch { /* skip unreadable */ }
      }
      if (items.length === 0) return;
      useClipboardStore.getState().setItems(items);
      const firstImage = items.find(item => item.kind === 'image');
      if (firstImage && navigator.clipboard?.write) {
        try {
          const ci = new ClipboardItem({ [firstImage.mimeType]: firstImage.blob });
          await navigator.clipboard.write([ci]);
        } catch { /* ignore */ }
      }
    })();
  }, []);

  const copySelection = useCallback(() => {
    clipboardRef.current = projectRef.current.nodes.filter(node => selectedIdsRef.current.includes(node.id));
    setClipboardVersion(version => version + 1);
    syncToSharedClipboard(clipboardRef.current);
  }, [syncToSharedClipboard]);

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
    const clipItems = useClipboardStore.getState().items;
    if (clipItems.length > 0) {
      const rect = rootRef.current?.getBoundingClientRect();
      const mouse = mousePosRef.current;
      const inBounds = rect && mouse.x >= rect.left && mouse.x <= rect.right && mouse.y >= rect.top && mouse.y <= rect.bottom;
      const basePoint = inBounds ? screenToWorkflow(mouse.x, mouse.y) : viewportCenter();
      for (let i = 0; i < clipItems.length; i++) {
        const item = clipItems[i];
        const offset = i * 32;
        const file = new File([item.blob], item.name, { type: item.mimeType });
        await addMediaAt(file, { x: basePoint.x + offset, y: basePoint.y + offset }, expectedProjectId);
      }
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
          const blob = await item.getType('text/plain');
          const text = typeof blob.text === 'function'
            ? await blob.text()
            : await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(reader.error || new Error('无法读取剪贴板文本'));
                reader.readAsText(blob);
              });
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
  }, [addMediaAt, applyOps, commitFrame, screenToWorkflow, selectNodes, viewportCenter]);

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
      if (event.key === 'Escape') setActiveMedia(null);
      if (target?.closest(BLOCKED_TARGET)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if (modifier && key === 'y') { event.preventDefault(); redo(); return; }
      if (modifier && key === 'c') { event.preventDefault(); copySelection(); return; }
      if (modifier && key === 'v') { event.preventDefault(); void pasteSelection(); return; }
      if (modifier && key === 'a') { event.preventDefault(); selectNodes(projectRef.current.nodes.filter(node => node.isVisible !== false).map(node => node.id)); return; }
      if (modifier && key === 'g') {
        event.preventDefault();
        const ids = selectedIdsRef.current;
        if (ids.length >= 2) applyOps([{ type: 'group_nodes', ids, batchId: nanoid(), source: 'manual' }]);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
      if (event.key === '/' && !modifier && !slashMenuRef.current) {
        event.preventDefault();
        const rect = rootRef.current?.getBoundingClientRect();
        setSlashMenu({ x: (rect?.width || 1000) / 2 - 160, y: (rect?.height || 700) / 2 - 200 });
        return;
      }
      if (event.key === 'Escape') {
        if (slashMenuRef.current) { setSlashMenu(null); return; }
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
  }, [applyOps, cancelInteraction, closeCreateMenu, copySelection, deleteSelection, pasteSelection, redo, selectNodes, undo]);

  const addNode = useCallback((type: WorkflowNodeType, metadata: WorkflowNodeData['metadata'] = {}) => {
    const center = viewportCenter();
    applyOps([{ type: 'add_node', node: createWorkflowNode(nanoid(), type, { x: center.x - 170, y: center.y - 110 }, metadata) }]);
  }, [applyOps, viewportCenter]);

  const replaceMedia = useCallback(async (node: WorkflowNodeData, file: File) => {
    if (node.isLocked) return;
    setActiveMedia(current => current?.nodeId === node.id ? null : current);
    const expectedProjectId = projectRef.current.id;
    const sequence = (replaceSequenceRef.current.get(node.id) || 0) + 1;
    replaceSequenceRef.current.set(node.id, sequence);
    let record: WorkflowMediaRecord | undefined;
    try {
      if (workflowMediaType(file) !== node.type) throw new Error(`请选择${node.type === 'image' ? '图片' : node.type === 'video' ? '视频' : '音频'}文件`);
      commitFrame(projectRef.current.nodes.map(item => item.id === node.id
        ? { ...item, metadata: { ...item.metadata, uploading: true, uploadBytes: file.size } }
        : item), projectRef.current.connections);
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
        metadata: { ...item.metadata, ...metadata, href: undefined, error: undefined, uploading: false },
      } : item);
      commitFrame(updated, projectRef.current.connections);
      releaseWorkflowMediaRecord(record.storageKey);
      setNotice(null);
    } catch (error) {
      if (record) await discardWorkflowMediaRecord(record.storageKey);
      if (mountedRef.current
        && projectRef.current.id === expectedProjectId
        && replaceSequenceRef.current.get(node.id) === sequence) {
        commitFrame(projectRef.current.nodes.map(item => item.id === node.id
          ? { ...item, metadata: { ...item.metadata, uploading: false } }
          : item), projectRef.current.connections);
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
      posterStorageKey: _posterStorageKey,
      name: _name,
      mimeType: _mimeType,
      bytes: _bytes,
      naturalWidth: _naturalWidth,
      naturalHeight: _naturalHeight,
      durationMs: _durationMs,
      href: _href,
      artifactRef: _artifactRef,
      poster: _poster,
      error: _error,
      ...metadata
    } = node.metadata;
    setActiveMedia(current => current?.nodeId === node.id ? null : current);
    commitFrame(projectRef.current.nodes.map(item => item.id === node.id
      ? { ...item, metadata: { ...metadata, status: 'idle' as const } }
      : item), projectRef.current.connections);
  }, [commitFrame]);

  const createFromMenu = useCallback((type: WorkflowNodeType) => {
    if (!createMenu) return;
    const node = createWorkflowNode(nanoid(), type, createMenu.world);
    let success: boolean;
    if (createMenu.sourceId) {
      success = applyOps([{ type: 'create_connected_node', fromNodeId: createMenu.sourceId, node }]);
    } else if (createMenu.targetId) {
      success = applyOps([
        { type: 'add_node', node },
        { type: 'connect_nodes', fromNodeId: node.id, toNodeId: createMenu.targetId },
      ]);
    } else {
      success = applyOps([{ type: 'add_node', node }]);
    }
    if (success) closeCreateMenu();
  }, [applyOps, closeCreateMenu, createMenu]);

  const fitView = useCallback(() => {
    setFocusBadge(false);
    const rect = rootRef.current?.getBoundingClientRect();
    const nodes = projectRef.current.nodes.filter(node => node.isVisible !== false);
    if (!rect || nodes.length === 0) return;
    const availableWidth = Math.max(360, rect.width - (rightPanelInset || 0));
    const minX = Math.min(...nodes.map(node => node.position.x));
    const minY = Math.min(...nodes.map(node => node.position.y));
    const maxX = Math.max(...nodes.map(node => node.position.x + node.width));
    const maxY = Math.max(...nodes.map(node => node.position.y + node.height));
    const k = Math.min(1.5, Math.max(0.12, Math.min((availableWidth - 160) / Math.max(1, maxX - minX), (rect.height - 160) / Math.max(1, maxY - minY))));
    patchProject({ viewport: { x: availableWidth / 2 - ((minX + maxX) / 2) * k, y: rect.height / 2 - ((minY + maxY) / 2) * k, k } });
  }, [patchProject, rightPanelInset]);

  const zoomBy = useCallback((factor: number) => {
    setFocusBadge(false);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vp = viewportRef.current;
    const k = Math.min(2.5, Math.max(0.12, vp.k * factor));
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    patchProject({ viewport: { x: cx - ((cx - vp.x) / vp.k) * k, y: cy - ((cy - vp.y) / vp.k) * k, k } });
  }, [patchProject]);
  const zoomIn = useCallback(() => zoomBy(1.2), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / 1.2), [zoomBy]);
  const zoomReset = useCallback(() => {
    setFocusBadge(false);
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    patchProject({ viewport: { x: rect.width / 2, y: rect.height / 2, k: 1 } });
  }, [patchProject]);

  const startPan = (clientX: number, clientY: number, pointerId: number) => {
    closeCreateMenu();
    setContextMenu(null);
    setSelectedConnectionId(null);
    setConnectionDrag(null);
    setFocusBadge(false);
    interactionRef.current = {
      type: 'pan',
      pointerId,
      start: localPoint(clientX, clientY),
      viewport: { ...viewportRef.current },
    };
  };

  const startBatchDrag = (event: ReactPointerEvent<HTMLDivElement>, batchId: string, batchNodes: WorkflowNodeData[]) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (tool === 'pan' || spacePressedRef.current) {
      startPan(event.clientX, event.clientY, event.pointerId);
      setOverlayHidden(true);
      return;
    }
    setContextMenu(null);
    closeCreateMenu();
    setSelectedConnectionId(null);
    const frame = currentFrame();
    interactionRef.current = {
      type: 'node',
      pointerId: event.pointerId,
      start: screenToWorkflow(event.clientX, event.clientY),
      positions: new Map(batchNodes.map(item => [item.id, { ...item.position }])),
      frame,
      moved: false,
      batchId,
    };
    setOverlayHidden(true);
  };

  const startNodeDrag = (event: ReactPointerEvent<HTMLDivElement>, node: WorkflowNodeData) => {
    if (event.button !== 0) return;
    if (focusAnimRef.current !== null) { window.cancelAnimationFrame(focusAnimRef.current); focusAnimRef.current = null; }
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
    if (activeMedia && (ids.length !== 1 || ids[0] !== activeMedia.nodeId)) setActiveMedia(null);
    selectNodes(ids);
    if (!ids.includes(node.id) || node.isLocked) return;
    if (target?.closest('video,audio,[data-workflow-media-preview]')) {
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
    if (focusAnimRef.current !== null) { window.cancelAnimationFrame(focusAnimRef.current); focusAnimRef.current = null; }
    setContextMenu(null);
    closeCreateMenu();
    setSlashMenu(null);
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
      })), `Flovart-Workflow-${project.title}`, project.title);
      setNotice(`已按工作流顺序导出 ${count} 个媒体文件。`);
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
  const workflowWidth = Math.max(360, (rootRect?.width || 1000) - (rightPanelInset || 0));
  const overlayCenter = overlayBounds ? project.viewport.x + ((overlayBounds.left + overlayBounds.right) / 2) * project.viewport.k : 0;
  const toolbarLeft = Math.max(8, Math.min(overlayCenter, workflowWidth - 8));
  const toolbarTop = overlayBounds ? Math.max(8, project.viewport.y + overlayBounds.top * project.viewport.k - Math.max(72, 56 + 28 * project.viewport.k)) : 0;
  // PromptBar 让位行程减半：右侧面板弹出时只左移一半距离，避免过度偏移
  const promptWorkflowWidth = Math.max(360, (rootRect?.width || 1000) - Math.round((rightPanelInset || 0) / 2));
  const promptWidth = Math.min(880, Math.max(360, promptWorkflowWidth - 16));
  const promptLeft = Math.max(8, Math.min(overlayCenter - promptWidth / 2, promptWorkflowWidth - promptWidth - 8));
  const configLeft = Math.max(8, Math.min(overlayCenter - 210, workflowWidth - 428));
  const promptTop = overlayBounds ? (() => {
    const rootHeight = rootRect?.height || 700;
    const estimatedPromptHeight = 176;
    const below = project.viewport.y + overlayBounds.bottom * project.viewport.k + 12;
    const dockSafeTop = rootHeight - 60;
    if (below + estimatedPromptHeight <= dockSafeTop) return below;
    return Math.max(8, toolbarTop - estimatedPromptHeight - 8);
  })() : 0;
  const gridSize = (project.backgroundMode === 'dots' ? 20 : 24) * project.viewport.k;

  const batchGroups = useMemo(() => {
    const groups = new Map<string, WorkflowNodeData[]>();
    for (const node of project.nodes) {
      if (node.batchId && node.isVisible !== false) {
        const group = groups.get(node.batchId) || [];
        group.push(node);
        groups.set(node.batchId, group);
      }
    }
    return groups;
  }, [project.nodes]);

  const hiddenByBatch = useMemo(() => {
    const hidden = new Set<string>();
    for (const [batchId, group] of batchGroups) {
      if (group.length > 1 && (!expandedBatches.has(batchId) || group.length > 4)) {
        for (const node of group) hidden.add(node.id);
      }
    }
    return hidden;
  }, [batchGroups, expandedBatches]);

  const collapsedBatches = useMemo(() => {
    const result: { batchId: string; head: WorkflowNodeData; count: number }[] = [];
    for (const [batchId, group] of batchGroups) {
      if (group.length > 1 && !expandedBatches.has(batchId)) {
        const root = group.find(n => n.batchIndex === 0) || group[0];
        const primaryId = root?.metadata.primaryImageId;
        const head = (primaryId && group.find(n => n.id === primaryId)) || root;
        result.push({ batchId, head, count: group.length });
      }
    }
    return result;
  }, [batchGroups, expandedBatches]);

  const expandedBatchGalleries = useMemo(() => [...batchGroups].flatMap(([batchId, group]) => (
    group.length > 4 && expandedBatches.has(batchId)
      ? [{ batchId, group: [...group].sort((left, right) => (left.batchIndex ?? 0) - (right.batchIndex ?? 0)) }]
      : []
  )), [batchGroups, expandedBatches]);

  const { pendingInsert: wfPendingInsert, consumeInsert: wfConsumeInsert } = usePromptHistoryStore();
  useEffect(() => {
    if (!wfPendingInsert) return;
    const target = selectedNodeData.length === 1 && ['image', 'video', 'text'].includes(selectedNodeData[0].type) ? selectedNodeData[0] : null;
    if (target) {
      applyOps([{ type: 'update_node', id: target.id, metadata: { prompt: wfPendingInsert.text, richTextDocument: undefined } }]);
      setPromptFocusSignal(value => value + 1);
    }
    wfConsumeInsert();
  }, [wfPendingInsert, wfConsumeInsert, selectedNodeData, applyOps]);

  // Native wheel listener with passive:false so Ctrl+scroll zooms the workflow surface instead of the browser.
  // React's synthetic onWheel is passive on the root and silently ignores preventDefault.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(BLOCKED_TARGET)) return;
      event.preventDefault();
      if (focusAnimRef.current !== null) { window.cancelAnimationFrame(focusAnimRef.current); focusAnimRef.current = null; }
      setFocusBadge(false);
      if (event.ctrlKey || wheelMode === 'zoom') {
        const rect = root.getBoundingClientRect();
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
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [wheelMode, patchProject, screenToWorkflow]);

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
        if (tool === 'pan' || !isTrueBackground(event.target)) return;
        event.preventDefault();
        openCreateMenu(event.clientX, event.clientY);
      }}
      onContextMenu={event => event.preventDefault()}
    >
      <WorkflowToolbar
        tool={tool}
        canUndo={Boolean(project.draftChangeSets?.some(changeSet => changeSet.status === 'completed' || changeSet.status === 'partial'))}
        canRedo={Boolean(project.draftRedoStack?.length)}
        onToolChange={setTool}
        onAddNode={addNode}
        onAddSharedMedia={media => { void addSharedMedia(media); }}
        onOpenAssets={onOpenAssets}
        onUndo={undo}
        onRedo={redo}
        onFit={fitView}
        onToggleGrid={() => patchProject({ backgroundMode: projectRef.current.backgroundMode === 'none' ? 'dots' : projectRef.current.backgroundMode === 'dots' ? 'lines' : 'none' })}
        onOpenAgent={onOpenAgent}
        agentOpen={agentOpen}
        wheelMode={wheelMode}
        setWheelMode={setWheelMode}
        minimapOpen={minimapOpen}
        onToggleMinimap={() => setMinimapOpen(open => !open)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(snap => !snap)}
        edgesVisible={edgesVisible}
        onToggleEdges={() => setEdgesVisible(v => !v)}
        onAutoLayout={autoLayout}
        zoomLevel={project.viewport.k}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        rightInset={rightPanelInset}
      />
      <div ref={worldRef} className="workflow-world" style={{ transform: `translate(${project.viewport.x}px, ${project.viewport.y}px) scale(${project.viewport.k})` }}>
        <WorkflowConnections
          nodes={project.nodes.filter(node => node.isVisible !== false)}
          connections={edgesVisible === false ? [] : project.connections.filter(connection => {
            const from = project.nodes.find(node => node.id === connection.fromNodeId);
            const to = project.nodes.find(node => node.id === connection.toNodeId);
            return from?.isVisible !== false && to?.isVisible !== false && !hiddenByBatch.has(connection.fromNodeId) && !hiddenByBatch.has(connection.toNodeId);
          })}
          selectedId={selectedConnectionId}
          active={connectionDrag}
          onSelect={id => { setSelectedConnectionId(id); selectNodes([]); setContextMenu(null); }}
          onContextMenu={(event, id) => {
            setSelectedConnectionId(id);
            selectNodes([]);
            setContextMenu({ type: 'connection', id, x: event.clientX, y: event.clientY });
          }}
        />
        {snapGuides && (
          <svg className="workflow-snap-guides" aria-hidden width={10000} height={10000} style={{ position: 'absolute', left: -5000, top: -5000, pointerEvents: 'none', overflow: 'visible' }}>
            {snapGuides.x?.map((x, i) => (
              <line key={`vx${i}`} x1={x + 5000} y1={0} x2={x + 5000} y2={10000} stroke="#3b82f6" strokeWidth={1 / project.viewport.k} strokeDasharray={`${4 / project.viewport.k} ${4 / project.viewport.k}`} />
            ))}
            {snapGuides.y?.map((y, i) => (
              <line key={`hy${i}`} x1={0} y1={y + 5000} x2={10000} y2={y + 5000} stroke="#3b82f6" strokeWidth={1 / project.viewport.k} strokeDasharray={`${4 / project.viewport.k} ${4 / project.viewport.k}`} />
            ))}
          </svg>
        )}
        <AnimatePresence>
        {collapsedBatches.map(({ batchId, head, count }) => (
          <WorkflowBatchStack
            key={`batch-stack-${batchId}`}
            head={head}
            count={count}
            onPointerDown={event => { const group = batchGroups.get(batchId) || []; if (group.length) startBatchDrag(event, batchId, group); }}
            onExpand={() => toggleBatch(batchId)}
          />
        ))}
        {expandedBatchGalleries.map(({ batchId, group }) => (
          <WorkflowBatchGallery
            key={`batch-gallery-${batchId}`}
            group={group}
            selectedId={batchPreviewIds[batchId]}
            onSelect={nodeId => setBatchPreviewIds(current => ({ ...current, [batchId]: nodeId }))}
            onCollapse={() => toggleBatch(batchId)}
            onSetPrimary={nodeId => applyOps([{ type: 'set_batch_primary', batchId, nodeId }])}
            onPointerDown={event => startBatchDrag(event, batchId, group)}
          />
        ))}
        {project.nodes.filter(node => node.isVisible !== false && !hiddenByBatch.has(node.id)).map(node => {
          const batch = node.batchId ? batchGroups.get(node.batchId) : undefined;
          const batchRoot = batch?.find(item => item.batchIndex === 0) || batch?.[0];
          const primaryId = batchRoot?.metadata.primaryImageId || batchRoot?.id;
          const expandedBatch = Boolean(node.batchId && batch && batch.length > 1 && expandedBatches.has(node.batchId));
          return <WorkflowNode
            key={node.id}
            node={node}
            selected={selectedNodes.has(node.id)}
            mediaActive={activeMedia?.projectId === project.id && activeMedia.nodeId === node.id}
            onActivateMedia={node.type === 'video' && (node.metadata.storageKey || node.metadata.href || node.metadata.artifactRef?.taskId)
              ? () => {
                setActiveMedia({ projectId: project.id, nodeId: node.id });
              }
              : undefined}
            onDeactivateMedia={() => setActiveMedia(active => active?.projectId === project.id && active.nodeId === node.id ? null : active)}
            onExtractFrame={node.type === 'video' ? (position, currentTimeSec) => void handleExtractFrame(node.id, position, currentTimeSec) : undefined}
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
              interactionRef.current = { type: 'connection', pointerId: event.pointerId, originId: node.id, direction: 'out' };
              setConnectionDrag({ sourceId: node.id, point: screenToWorkflow(event.clientX, event.clientY), targetId: null, direction: 'out', local: localPoint(event.clientX, event.clientY) });
            }}
            onConnectStartTarget={event => {
              if (event.button !== 0) return;
              if (tool === 'pan' || spacePressedRef.current || node.isLocked) return;
              event.preventDefault();
              event.stopPropagation();
              closeCreateMenu();
              setContextMenu(null);
              setSelectedConnectionId(null);
              createMenuOpenerRef.current = event.currentTarget;
              interactionRef.current = { type: 'connection', pointerId: event.pointerId, originId: node.id, direction: 'in' };
              setConnectionDrag({ sourceId: node.id, point: screenToWorkflow(event.clientX, event.clientY), targetId: null, direction: 'in', local: localPoint(event.clientX, event.clientY) });
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
            onChangeText={content => { if (!node.isLocked) applyOps([{ type: 'update_node', id: node.id, metadata: { content } }]); }}
            onChangeMetadata={metadata => { if (!node.isLocked) applyOps([{ type: 'update_node', id: node.id, metadata }]); }}
            onRun={() => { if (!node.isLocked) onRunNode(node.id); }}
            onReplaceMedia={file => { if (!node.isLocked) void replaceMedia(node, file); }}
            onRemoveMedia={() => { if (!node.isLocked) removeMedia(node); }}
            onContextMenu={event => {
              setSelectedConnectionId(null);
              selectNodes([node.id]);
              setContextMenu({ type: 'node', id: node.id, x: event.clientX, y: event.clientY });
            }}
            batchCount={expandedBatch ? batch?.length : undefined}
            isBatchPrimary={expandedBatch ? node.id === primaryId : undefined}
            onCollapseBatch={expandedBatch ? () => toggleBatch(node.batchId!) : undefined}
            onSetBatchPrimary={expandedBatch && node.id !== primaryId ? () => applyOps([{ type: 'set_batch_primary', batchId: node.batchId!, nodeId: node.id }]) : undefined}
            onDoubleClick={node.type === 'script' ? () => setScriptEditorNodeId(node.id) : undefined}
            onPreviewMedia={setPreviewNode}
            onChangeTitle={title => { if (!node.isLocked) applyOps([{ type: 'update_node', id: node.id, patch: { title } }]); }}
            renameSignal={renameSignal?.nodeId === node.id ? renameSignal.nonce : undefined}
            onFocusNode={() => focusNode(node.id)}
          />;
        })}
        </AnimatePresence>
        {selectionStyle && <div className="workflow-selection-box" style={selectionStyle} />}
      </div>
      {!overlayHidden && overlayBounds && selectedNodeData.length > 0 && selectedNodeData.every(node => !node.isLocked) && <>
        <div data-workflow-overlay style={{ position: 'absolute', zIndex: 70, left: toolbarLeft, top: toolbarTop, transform: 'translateX(-50%)' }}>
          <WorkflowNodeToolbar
            nodes={selectedNodeData}
            onCopy={ids => { const nodes = projectRef.current.nodes.filter(node => ids.includes(node.id)); clipboardRef.current = nodes; setClipboardVersion(version => version + 1); syncToSharedClipboard(nodes); }}
            onDelete={ids => applyOps([{ type: 'delete_nodes', ids }])}
            onExport={nodes => { void exportSelectedMedia(nodes); }}
            onRun={id => onRunNode(id)}
            onStop={onStopNode}
            onPromptFocus={() => setPromptFocusSignal(value => value + 1)}
            onSaveMedia={onSaveWorkflowMedia}
            onGroup={ids => applyOps([{ type: 'group_nodes', ids, batchId: nanoid(), source: 'manual' }])}
            onUngroup={ids => applyOps([{ type: 'ungroup_nodes', ids }])}
            onExecuteGroup={ids => applyOps([{ type: 'execute_group', nodeIds: ids }])}
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
            videoTools={builtInVideoTools}
            videoToolBusy={Boolean(videoTool || videoToolBusy)}
            audioTools={builtInAudioTools}
            audioToolBusy={Boolean(audioTool || audioToolBusy)}
            onReplaceMedia={(id, file) => { const node = projectRef.current.nodes.find(item => item.id === id); if (node) void replaceMedia(node, file); }}
            onPreviewMedia={(id) => { const target = projectRef.current.nodes.find(n => n.id === id); if (target) setPreviewNode(target); }}
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
        {selectedNodeData.length === 1 && selectedNodeData[0].type === 'config' && <div data-workflow-overlay style={{ position: 'absolute', zIndex: 69, left: configLeft, top: promptTop, width: 420 }} onWheel={event => event.stopPropagation()}>
          <WorkflowConfigPanel node={selectedNodeData[0]} nodes={project.nodes} connections={project.connections} onChange={metadata => applyOps([{ type: 'update_node', id: selectedNodeData[0].id, metadata }])} onRun={() => onRunNode(selectedNodeData[0].id)} onStop={onStopNode ? () => onStopNode(selectedNodeData[0].id) : undefined} />
        </div>}
        {selectedNodeData.length === 1 && ['image', 'video', 'text', 'operation'].includes(selectedNodeData[0].type) && <div data-workflow-overlay style={{ position: 'absolute', zIndex: 69, left: promptLeft, top: promptTop }}>
      <WorkflowNodePromptBar width={promptWidth} node={selectedNodeData[0]} nodes={project.nodes} connections={project.connections} t={t} theme={theme} language={language} userApiKeys={userApiKeys} dynamicModelOptions={dynamicModelOptions} onOpenSettings={onOpenSettings} onEnhancePrompt={onEnhancePrompt} isEnhancingPrompt={isEnhancingPrompt} onChange={metadata => applyOps([{ type: 'update_node', id: selectedNodeData[0].id, metadata }])} onRun={() => onRunNode(selectedNodeData[0].id)} onStop={onStopNode ? () => onStopNode(selectedNodeData[0].id) : undefined} focusSignal={promptFocusSignal} onDisconnectReference={fromNodeId => { const targetId = selectedNodeData[0].id; const conn = project.connections.find(c => c.toNodeId === targetId && c.fromNodeId === fromNodeId); if (!conn) return; applyOps([{ type: 'delete_connections', ids: [conn.id] }]); }} assetFolders={assetFolders} assetItems={assetSuggestions} assetLibrary={assetLibrary} onSelectWorkflowReference={selectedNodeData[0] ? (nodeId => handleSelectWorkflowReference(nodeId, selectedNodeData[0].id)) : undefined} onAddReferenceFiles={selectedNodeData[0] ? (files => handleAddReferenceFiles(files, selectedNodeData[0].id)) : undefined} onSelectAsset={selectedNodeData[0] ? (assetId => handleSelectAsset(assetId, selectedNodeData[0].id)) : undefined} onResolvePastedMentions={mentions => handleResolvePastedMentions(mentions, selectedNodeData[0].id)} onPasteUnresolvedMentions={labels => setNotice(`未能唯一匹配引用：${labels.map(label => `@${label}`).join('、')}，已保留为普通文字。`)} skillEnabled={false} />
        </div>}
      </>}
      {minimapOpen && <WorkflowMiniMap nodes={project.nodes.filter(node => node.isVisible !== false)} viewport={project.viewport} onCenter={(x, y) => {
        setFocusBadge(false);
        const rect = rootRef.current?.getBoundingClientRect();
        patchProject({ viewport: { ...viewportRef.current, x: (rect?.width || 1000) / 2 - x * viewportRef.current.k, y: (rect?.height || 700) / 2 - y * viewportRef.current.k } });
      }} />}
      {notice && <div role="status" aria-live="polite" data-workflow-overlay style={{ position: 'absolute', zIndex: 80, right: 14, top: 58, maxWidth: 320, padding: '7px 10px', border: '1px solid var(--wf-border)', borderRadius: 7, color: 'var(--wf-text)', background: 'var(--wf-panel)', fontSize: 12 }}>{notice}</div>}
      <AnimatePresence>
        {focusBadge && (
          <motion.button
            type="button"
            data-workflow-overlay
            aria-label="还原缩放"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.7 }}
            onPointerDown={event => event.stopPropagation()}
            onClick={() => fitView()}
            style={{ position: 'absolute', zIndex: 70, bottom: 28, left: '50%', translate: '-50% 0', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', border: 'none', borderRadius: 999, color: 'var(--wf-text-soft, var(--wf-text))', background: 'transparent', fontSize: 12, cursor: 'pointer' }}
          >
            <Maximize2 size={13} strokeWidth={2} />
            还原缩放
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {layoutToast && (
          <motion.div
            data-workflow-overlay
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 30, mass: 0.7 }}
            onPointerDown={event => event.stopPropagation()}
            style={{ position: 'absolute', zIndex: 80, bottom: 14, right: 14, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 12px', borderRadius: 999, border: '1px solid var(--wf-border)', color: 'var(--wf-text)', background: 'var(--wf-panel)', fontSize: 12, boxShadow: 'var(--isl-shadow-sm, 0 4px 14px rgba(0,0,0,0.08))' }}
          >
            <span>已整理节点</span>
            <button type="button" onClick={restoreLayout} aria-label="还原整理" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, border: '1px solid var(--wf-border)', background: 'transparent', color: 'var(--wf-text)', fontSize: 11, cursor: 'pointer' }}>
              <Undo2 size={12} strokeWidth={2.4} />还原
            </button>
            <button type="button" onClick={() => setLayoutToast(null)} aria-label="保留整理结果" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, border: 'none', background: 'var(--wf-accent, #2563eb)', color: '#fff', fontSize: 11, cursor: 'pointer' }}>
              <Check size={12} strokeWidth={2.6} />保留
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {connectionDrag && (
          <motion.div
            className="workflow-connection-bubble"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1, x: connectionDrag.local.x, y: connectionDrag.local.y }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={{ type: 'spring', stiffness: 600, damping: 32, mass: 0.6 }}
            data-direction={connectionDrag.direction}
          >
            <Plus size={16} strokeWidth={2.4} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {createMenu && <WorkflowCreateMenu state={createMenu} onCreate={createFromMenu} onClose={closeCreateMenu} />}
      </AnimatePresence>
      {contextMenu && (() => {
          const ctxNode = contextMenu.type === 'node' ? projectRef.current.nodes.find(n => n.id === contextMenu.id) : null;
          const batch = ctxNode?.batchId ? batchGroups.get(ctxNode.batchId) : null;
          const canSetPrimary = Boolean(ctxNode && ctxNode.type === 'image' && batch && batch.length > 1 && ctxNode.id !== (batch.find(n => n.batchIndex === 0)?.metadata.primaryImageId));
          return (
        <WorkflowContextMenu
          state={contextMenu}
          onSetPrimary={canSetPrimary ? (() => {
            if (!ctxNode?.batchId) return;
            applyOps([{ type: 'set_batch_primary', batchId: ctxNode.batchId, nodeId: ctxNode.id }]);
            setContextMenu(null);
          }) : undefined}
          onCopy={() => {
            if (contextMenu.type === 'node') {
              const nodes = projectRef.current.nodes.filter(node => node.id === contextMenu.id);
              clipboardRef.current = nodes;
              setClipboardVersion(version => version + 1);
              syncToSharedClipboard(nodes);
            }
            setContextMenu(null);
          }}
          onDuplicate={contextMenu.type === 'node' && ctxNode && !ctxNode.isLocked ? (() => {
            const duplicate = { ...ctxNode, id: nanoid(), position: { x: ctxNode.position.x + 32, y: ctxNode.position.y + 32 }, metadata: { ...ctxNode.metadata } };
            commitFrame([...projectRef.current.nodes, duplicate], projectRef.current.connections);
            selectNodes([duplicate.id]);
            setContextMenu(null);
          }) : undefined}
          onSaveMedia={contextMenu.type === 'node' && ctxNode && ['image', 'video', 'audio'].includes(ctxNode.type) && (ctxNode.metadata.storageKey || ctxNode.metadata.href || ctxNode.metadata.artifactRef?.taskId) && onSaveWorkflowMedia ? (() => { onSaveWorkflowMedia(ctxNode.id); setContextMenu(null); }) : undefined}
          onRun={() => { if (contextMenu.type === 'node' && !projectRef.current.nodes.find(node => node.id === contextMenu.id)?.isLocked) onRunNode(contextMenu.id); setContextMenu(null); }}
          onRename={contextMenu.type === 'node' && ctxNode && !ctxNode.isLocked ? (() => { setRenameSignal({ nodeId: ctxNode.id, nonce: Date.now() }); setContextMenu(null); }) : undefined}
          onDelete={() => {
            if (contextMenu.type === 'node' && !projectRef.current.nodes.find(node => node.id === contextMenu.id)?.isLocked) applyOps([{ type: 'delete_nodes', ids: [contextMenu.id] }]);
            else {
              commitFrame(projectRef.current.nodes, projectRef.current.connections.filter(connection => connection.id !== contextMenu.id));
              setSelectedConnectionId(null);
            }
            setContextMenu(null);
          }}
        />
          );
        })()}
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
      <WorkflowVideoToolDialogs
        tool={videoTool}
        node={activeVideoToolNode}
        mediaUrl={activeVideoToolMedia.url || ''}
        busy={videoToolBusy}
        error={videoToolError || activeVideoToolMedia.error}
        onClose={closeVideoTool}
        onConfirm={confirmation => { void confirmVideoTool(confirmation); }}
      />
      <WorkflowAudioToolDialogs
        tool={audioTool}
        node={activeAudioToolNode}
        mediaUrl={activeAudioToolMedia.url || ''}
        busy={audioToolBusy}
        error={audioToolError || activeAudioToolMedia.error}
        onClose={closeAudioTool}
        onConfirm={confirmation => { void confirmAudioTool(confirmation); }}
      />
      {slashMenu && (
        <div data-workflow-overlay style={{ position: 'absolute', zIndex: 90, left: slashMenu.x, top: slashMenu.y }}>
          <SlashMenu onSelect={handleSlashCommand} onClose={() => setSlashMenu(null)} />
        </div>
      )}
      {scriptEditorNodeId && (() => {
        const scriptNode = projectRef.current.nodes.find(node => node.id === scriptEditorNodeId);
        if (!scriptNode) return null;
        return (
          <ScriptNodeEditor
            node={scriptNode}
            onChange={metadata => applyOps([{ type: 'update_node', id: scriptNode.id, metadata }])}
            onClose={() => setScriptEditorNodeId(null)}
            userApiKeys={userApiKeys}
            confirmRouteFallback={confirmRouteFallback}
            onOpenSettings={onOpenSettings}
            onBatchGenerate={mode => handleScriptBatchGenerate(scriptNode.id, mode)}
          />
        );
      })()}
      <MediaPreviewModal node={previewNode} onClose={() => setPreviewNode(null)} />
    </div>
  );
}
