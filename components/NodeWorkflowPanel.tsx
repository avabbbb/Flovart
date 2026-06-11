import React, { useEffect, useMemo, useRef, useState } from 'react';
import { inferProviderFromModel } from '../services/aiGateway';
import { findModelTemplateByModel } from '../services/modelTemplateRegistry';
import {
  appendTraceEvent,
  createRuntimeJob,
  createRuntimeSession,
  listTraceEventsForJob,
  updateRuntimeJob,
} from '../services/runtimeTraceStore';
import { createExecutionPlan, executeWorkflow } from '../services/workflowEngine';
import type { WorkflowExecutionScope } from '../services/workflowEngine';
import type {
  AssetCategory,
  AssetLibrary,
  ChatAttachment,
  GenerationHistoryItem,
  GenerationMode,
  PromptEnhanceMode,
  UserApiKey,
} from '../types';
import { NODE_DEFS } from './nodeflow/defs';
import { canConnectEdge, clampScale, getBezierPath, getPortPosition, normalizeWorkflowEdges, selectionBoxRect } from './nodeflow/graph';
import { getNodeInspectorSections } from './nodeflow/inspectorSchema';
import type { NodeInspectorField } from './nodeflow/inspectorSchema';
import { STARTER_WORKFLOW_TEMPLATES } from './nodeflow/starterTemplates';
import {
  matchesWorkflowTemplateFilter,
} from './nodeflow/templateFilters';
import type { WorkflowTemplateFilter } from './nodeflow/templateFilters';
import type { WorkflowTemplate } from './nodeflow/templates';
import {
  collectNodeInputValues,
  normalizeWorkflowProgressStatus,
} from './nodeflow/runDetails';
import {
  getPrimaryWorkflowValue,
  summarizeWorkflowValue,
} from './nodeflow/types';
import type {
  NodeIOMap,
  NodeConfig,
  WorkflowEdge,
  WorkflowGroup,
  NodeKind,
  NodePort,
  WorkflowViewport,
  WorkflowNode,
  WorkflowNodeRunState,
  WorkflowRunStatus,
  WorkflowValue,
} from './nodeflow/types';
import { useNodeWorkflowStore } from './nodeflow/useNodeWorkflowStore';
import { CanvasFloatingPanel, CanvasIconButton } from './canvas-ui/CanvasChrome';
import {
  createWorkflowTemplatePackage,
  serializeWorkflowTemplatePackage,
} from '../utils/workflowTemplatePackage';
import { CanvasElementPicker } from './nodeflow/CanvasElementPicker';
import { WorkflowKonvaShell } from './workflow/WorkflowKonvaShell';
import { useRuntimeStore } from '../stores/useRuntimeStore';
import { syncWorkflowGraphIntoRuntime } from '../services/projectRuntimeBridge';
import { selectWorkflowGraph } from '../utils/runtimeSelectors';

interface NodeWorkflowPanelProps {
  prompt: string;
  setPrompt: (value: string) => void;
  generationMode: GenerationMode;
  setGenerationMode: (mode: GenerationMode) => void;
  selectedImageModel?: string;
  selectedVideoModel?: string;
  imageModelOptions?: string[];
  videoModelOptions?: string[];
  onImageModelChange?: (model: string) => void;
  onVideoModelChange?: (model: string) => void;
  attachments?: ChatAttachment[] | null;
  canvasImages?: Array<{ id: string; name?: string; href: string; mimeType: string }> | null;
  canvasVideos?: Array<{ id: string; name?: string; href: string; mimeType: string; poster?: string; width?: number; height?: number; durationSec?: number; trimInSec?: number; trimOutSec?: number }> | null;
  onRemoveAttachment: (id: string) => void;
  onUploadFiles: (files: FileList | File[]) => void;
  onDropCanvasImage: (payload: { id: string; name?: string; href: string; mimeType: string }) => void;
  userApiKeys?: UserApiKey[] | null;
  assetLibrary?: Partial<AssetLibrary> | null;
  generationHistory?: GenerationHistoryItem[] | null;
  language?: 'en' | 'zho';
  onSwitchWorkspace?: (view: 'canvas' | 'workflow') => void;
  onPlaceWorkflowValue?: (value: WorkflowValue) => Promise<void> | void;
  onSaveWorkflowValueToAssets?: (value: WorkflowValue, node: WorkflowNode) => Promise<void> | void;
  workflowRenderer?: 'dom' | 'hybrid' | 'konva';
}

type CanvasVideo = NonNullable<NodeWorkflowPanelProps['canvasVideos']>[number];

type ContextMenuState = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  target: 'canvas' | 'node' | 'group';
  nodeId?: string;
  groupId?: string;
};

type ConnectionMenuState = {
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  fromNode: string;
  fromPort: string;
};

type ChainNodeOption = {
  id: string;
  label: string;
  badge: string;
  kind?: NodeKind;
  beta?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};

type WorkflowMentionItem = {
  id: string;
  label: string;
  reference: string;
  shortId: string;
  kind: NodeKind;
  badge: string;
};

type WorkflowRunEvent = {
  id: string;
  nodeId: string;
  status: WorkflowRunStatus;
  message: string;
  timestamp: number;
};

type ToolPanelTab = 'create' | 'nodes' | 'workflows' | 'assets' | 'history';
type AssetPanelFilter = 'all' | AssetCategory;

type DisplayMediaValue = Extract<WorkflowValue, { kind: 'image' | 'video' }>;

type SavedWorkflow = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  favorite?: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  groups: WorkflowGroup[];
  viewport?: WorkflowViewport;
};

type SharedAssetPanelItem = {
  id: string;
  name: string;
  category: AssetCategory;
  href: string;
  mimeType: string;
  width: number;
  height: number;
  createdAt: number;
};

const EMPTY_ASSET_LIBRARY: AssetLibrary = { character: [], scene: [], prop: [] };

function safeArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizeAssetLibrary(value: Partial<AssetLibrary> | null | undefined): AssetLibrary {
  return {
    character: safeArray(value?.character),
    scene: safeArray(value?.scene),
    prop: safeArray(value?.prop),
  };
}
const SAVED_WORKFLOWS_STORAGE_KEY = 'flovart.savedWorkflows.v1';

const NODE_LIBRARY_KINDS: NodeKind[] = [
  'imageGen',
  'videoGen',
];

const NODE_LIBRARY_LABELS: Partial<Record<NodeKind, string>> = {
  prompt: 'Text Prompt',
  loadImage: 'Image Input',
  loadVideo: 'Video Input',
  llm: 'Text AI',
  enhancer: 'Prompt Enhance',
  template: 'Text Template',
  imageGen: 'Image',
  videoGen: 'Video',
  videoEdit: 'Edit Video',
  generator: 'Generate',
  runningHub: 'RunningHub',
  httpRequest: 'HTTP Request',
  condition: 'Condition',
  switch: 'Switch',
  merge: 'Merge',
  upscale: 'Upscale',
  faceRestore: 'Face Restore',
  bgRemove: 'BG Remove',
  preview: 'Preview',
  saveToCanvas: 'Save to Canvas',
  saveToAssets: 'Save to Assets',
};

const NODE_KIND_BADGES: Partial<Record<NodeKind, string>> = {
  prompt: 'TXT',
  loadImage: 'IMG',
  loadVideo: 'VID',
  enhancer: 'FX',
  generator: 'GEN',
  imageGen: 'IMG',
  videoGen: 'VID',
  videoEdit: 'CUT',
  preview: 'OUT',
  saveToCanvas: 'PUT',
  saveToAssets: 'LIB',
  llm: 'LLM',
  template: 'TPL',
  runningHub: 'RH',
};

const ASSET_FILTER_OPTIONS: Array<{ value: AssetPanelFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'character', label: '角色' },
  { value: 'scene', label: '场景' },
  { value: 'prop', label: '道具' },
];

const TOOL_PANEL_TITLES: Record<ToolPanelTab, string> = {
  create: 'Create node',
  nodes: 'Workflow nodes',
  workflows: 'Saved workflows',
  assets: 'Shared asset library',
  history: 'Generation history',
};

const WORKFLOW_COPY = {
  en: {
    addNode: 'Add node',
    nodeRecords: 'Open workflow node records',
    openSavedWorkflows: 'Open saved workflows',
    openSharedAssets: 'Open shared asset library',
    openHistory: 'Open generation history',
    workflowNodes: 'Workflow nodes',
    savedWorkflows: 'Saved workflows',
    sharedAssets: 'Shared asset library',
    history: 'Generation history',
    nodePrompt: 'Node prompt',
    promptPlaceholder: 'Describe what you want to generate. Press / for commands, @ to reference nodes',
    runNode: 'Run selected workflow node',
    copyNode: 'Copy selected workflow node',
    deleteNode: 'Delete selected workflow node',
    uploadMedia: 'Double-click to upload media',
  },
  zho: {
    addNode: '添加节点',
    nodeRecords: '打开工作流节点记录',
    openSavedWorkflows: '打开已保存工作流',
    openSharedAssets: '打开共享素材库',
    openHistory: '打开生成历史',
    workflowNodes: '工作流节点',
    savedWorkflows: '已保存工作流',
    sharedAssets: '共享素材库',
    history: '生成历史',
    nodePrompt: '节点提示词',
    promptPlaceholder: '描述你想生成的画面内容，按 / 呼出指令，@ 引用节点',
    runNode: '运行选中的工作流节点',
    copyNode: '复制选中的工作流节点',
    deleteNode: '删除选中的工作流节点',
    uploadMedia: '双击上传素材',
  },
} as const;

const RUN_STATUS_STYLES: Record<WorkflowRunStatus, string> = {
  idle: 'bg-neutral-300',
  queued: 'bg-sky-400',
  running: 'bg-amber-400',
  success: 'bg-emerald-500',
  error: 'bg-rose-500',
  skipped: 'bg-neutral-200',
  pinned: 'bg-neutral-600',
};

const RUN_STATUS_NODE_CLASSES: Partial<Record<WorkflowRunStatus, string>> = {
  queued: 'is-queued',
  running: 'is-running',
  success: 'is-success',
  error: 'is-error',
  pinned: 'is-pinned',
};

const RUN_STATUS_EDGE_CLASSES: Partial<Record<WorkflowRunStatus, string>> = {
  queued: 'is-selected',
  running: 'is-running',
  success: 'is-success',
  error: 'is-error',
  pinned: 'is-pinned',
};

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

const TEMPLATE_FILTER_OPTIONS: Array<{
  value: WorkflowTemplateFilter;
  label: string;
}> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'utility', label: 'Utility' },
];

const MAX_RUN_EVENTS = 40;
const COMPOSER_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '2:1', '21:9'];
const COMPOSER_RESOLUTIONS = ['720P', '1080P', '2K', '4K', '8K'];
const COMPOSER_DURATIONS = [5, 8, 10, 15];
const COMPOSER_FPS = [24, 30, 60];
const COMPOSER_OUTPUT_COUNTS = [1, 2, 4];
const COMPOSER_COMMANDS = [
  { label: '/style', value: ' /style cinematic' },
  { label: '/camera', value: ' /camera slow push in' },
  { label: '/detail', value: ' /detail clean composition' },
];
const COMPACT_COMPOSER_WIDTH = 800;

function buildEnhancerSystemPrompt(mode: PromptEnhanceMode, stylePreset: string): string {
  if (mode === 'style') {
    return `Rewrite the user's creative prompt into a production-ready ${stylePreset} visual prompt. Keep subject intent unchanged, but improve scene specificity, composition, lighting, texture, and shot readability.`;
  }
  if (mode === 'precise') {
    return 'Rewrite the prompt into a precise production prompt. Remove ambiguity, keep structure tight, and make every visual instruction concrete.';
  }
  if (mode === 'translate') {
    return 'Translate the prompt into concise, production-ready English for image or video generation. Preserve all named entities and creative intent.';
  }
  return 'Rewrite the prompt into a stronger production-ready visual prompt with clearer subject, environment, composition, lighting, and style guidance.';
}

function getNodeTitle(kind: NodeKind, label?: string): string {
  return label?.trim() || NODE_DEFS[kind].title;
}

function getCompactNodeCaption(kind: NodeKind): string {
  if (kind === 'imageGen') return '图片节点 2';
  if (kind === 'videoGen') return '视频节点 2';
  return NODE_DEFS[kind].title;
}

function getCompactModelLabel(model?: string, mode: GenerationMode = 'image'): string {
  if (!model) return mode === 'video' ? 'Veo 3.1' : 'Lib Nano Pro';
  const normalized = model.toLowerCase();
  if (normalized.includes('veo')) return 'Veo 3.1';
  if (normalized.includes('gemini') || normalized.includes('nano')) return 'Lib Nano Pro';
  return model;
}

function getTrailingMentionQuery(value: string): string | null {
  const match = value.match(/(?:^|\s)@([^\s@]*)$/);
  return match ? match[1] : null;
}

function replaceTrailingMentionQuery(value: string, label: string): string {
  return value.replace(/(^|\s)@([^\s@]*)$/, `$1@${label} `);
}

function toWorkflowNodeReferenceLabel(label: string, nodeId: string): string {
  return `[${label}](workflow-node:${nodeId})`;
}

function isWorkflowCanvasControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest([
    '.workflow-node-card',
    '.workflow-port',
    '.workflow-floating-composer',
    '.workflow-context-menu',
    '.workflow-connection-menu',
    '.workflow-left-panel',
    '.workflow-tool-rail',
    '.workflow-bottom-controls',
    '.workflow-minimap',
    'button',
    'input',
    'textarea',
    'select',
    'a',
  ].join(','));
}

function formatVideoDuration(seconds?: number): string {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return 'Duration unknown';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.max(0, Math.round(seconds - minutes * 60));
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

function isMediaNodeKind(kind: NodeKind): boolean {
  return kind === 'imageGen' || kind === 'videoGen';
}

function isDisplayMediaValue(value: WorkflowValue | null | undefined): value is DisplayMediaValue {
  return value?.kind === 'image' || value?.kind === 'video';
}

function getConfigMediaValue(config?: NodeConfig): DisplayMediaValue | null {
  if (!config?.mediaKind || !config.mediaHref) return null;
  if (config.mediaKind === 'image') {
    return {
      kind: 'image',
      href: config.mediaHref,
      mimeType: config.mediaMimeType || 'image/png',
      width: config.mediaWidth,
      height: config.mediaHeight,
    };
  }
  return {
    kind: 'video',
    href: config.mediaHref,
    mimeType: config.mediaMimeType || 'video/mp4',
    width: config.mediaWidth,
    height: config.mediaHeight,
    posterHref: config.mediaPosterHref,
    durationSec: config.mediaDurationSec,
    trimInSec: config.mediaTrimInSec,
    trimOutSec: config.mediaTrimOutSec,
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function readImageDimensions(href: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    const timeout = window.setTimeout(() => resolve({}), 300);
    image.onload = () => {
      window.clearTimeout(timeout);
      resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    };
    image.onerror = () => {
      window.clearTimeout(timeout);
      resolve({});
    };
    image.src = href;
  });
}

function readVideoMetadata(href: string): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const timeout = window.setTimeout(() => resolve({}), 300);
    video.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      resolve({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
      });
    };
    video.onerror = () => {
      window.clearTimeout(timeout);
      resolve({});
    };
    video.src = href;
  });
}

function cloneWorkflowNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node) => ({
    ...node,
    config: node.config ? { ...node.config } : undefined,
  }));
}

function cloneWorkflowEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  return edges.map((edge) => ({ ...edge }));
}

function cloneWorkflowGroups(groups: WorkflowGroup[]): WorkflowGroup[] {
  return groups.map((group) => ({ ...group, nodeIds: [...group.nodeIds] }));
}

function sanitizeSavedWorkflow(raw: unknown): SavedWorkflow | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<SavedWorkflow>;
  if (!item.id || !item.name || !Array.isArray(item.nodes) || !Array.isArray(item.edges)) return null;
  const nodes = item.nodes.filter((node): node is WorkflowNode => (
    !!node
    && typeof node.id === 'string'
    && typeof node.kind === 'string'
    && node.kind in NODE_DEFS
    && typeof node.x === 'number'
    && typeof node.y === 'number'
  ));
  if (nodes.length === 0) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = normalizeWorkflowEdges(
    nodes,
    item.edges.filter((edge): edge is WorkflowEdge => !!edge && typeof edge.id === 'string'),
  );
  return {
    id: item.id,
    name: item.name,
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
    favorite: !!item.favorite,
    nodes: cloneWorkflowNodes(nodes),
    edges: cloneWorkflowEdges(edges),
    groups: Array.isArray(item.groups)
      ? item.groups
          .filter((group): group is WorkflowGroup => (
            !!group
            && typeof group.id === 'string'
            && Array.isArray(group.nodeIds)
          ))
          .map((group) => ({
            ...group,
            nodeIds: group.nodeIds.filter((nodeId) => nodeIds.has(nodeId)),
          }))
      : [],
    viewport: item.viewport
      && typeof item.viewport.x === 'number'
      && typeof item.viewport.y === 'number'
      && typeof item.viewport.scale === 'number'
      ? { ...item.viewport }
      : undefined,
  };
}

function loadSavedWorkflows(): SavedWorkflow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_WORKFLOWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSavedWorkflow).filter((item): item is SavedWorkflow => !!item);
  } catch {
    return [];
  }
}

function persistSavedWorkflows(items: SavedWorkflow[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SAVED_WORKFLOWS_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Keeping workflow editing usable is more important than surfacing quota errors here.
  }
}

function formatPanelTimestamp(timestamp: number): string {
  if (!timestamp) return '';
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function toTemplateFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'workflow-template'}.flovart.json`;
}

export const NodeWorkflowPanel: React.FC<NodeWorkflowPanelProps> = ({
  prompt,
  setPrompt,
  generationMode,
  setGenerationMode,
  selectedImageModel,
  selectedVideoModel,
  imageModelOptions = [],
  videoModelOptions = [],
  onImageModelChange,
  onVideoModelChange,
  attachments: attachmentsInput,
  canvasImages: canvasImagesInput,
  canvasVideos: canvasVideosInput,
  onRemoveAttachment,
  onUploadFiles,
  onDropCanvasImage,
  userApiKeys: userApiKeysInput,
  assetLibrary: assetLibraryInput = EMPTY_ASSET_LIBRARY,
  generationHistory: generationHistoryInput,
  language = 'en',
  onSwitchWorkspace,
  onPlaceWorkflowValue,
  onSaveWorkflowValueToAssets,
  workflowRenderer = 'dom',
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nodeMediaInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 1 });
  const minimapRef = useRef<SVGSVGElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const connectionMenuRef = useRef<HTMLDivElement>(null);
  const connectionMenuOpenRef = useRef(false);
  const importWorkflowInputRef = useRef<HTMLInputElement>(null);
  const store = useNodeWorkflowStore();
  const runtime = useRuntimeStore((state) => state.runtime);
  const replaceRuntime = useRuntimeStore((state) => state.replaceRuntime);
  const hydratedFromRuntimeRef = useRef(false);

  const [isExecuting, setIsExecuting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runMessage, setRunMessage] = useState('Ready');
  const [nodeRunState, setNodeRunState] = useState<Record<string, WorkflowNodeRunState>>({});
  const [runEvents, setRunEvents] = useState<WorkflowRunEvent[]>([]);
  const [enhanceMode, setEnhanceMode] = useState<PromptEnhanceMode>('smart');
  const [stylePreset, setStylePreset] = useState('cinematic');
  const [isPromptDropOver, setIsPromptDropOver] = useState(false);
  const [isImageDropOver, setIsImageDropOver] = useState(false);
  const [mediaUploadTargetId, setMediaUploadTargetId] = useState<string | null>(null);
  const [isMiniMapDragging, setIsMiniMapDragging] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [connectionMenu, setConnectionMenu] = useState<ConnectionMenuState | null>(null);
  const [templateFilter, setTemplateFilter] = useState<WorkflowTemplateFilter>('all');
  const [toolPanelTab, setToolPanelTab] = useState<ToolPanelTab>('create');
  const [isToolPanelOpen, setIsToolPanelOpen] = useState(false);
  const [assetPanelFilter, setAssetPanelFilter] = useState<AssetPanelFilter>('all');
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState<SavedWorkflow[]>(() => loadSavedWorkflows());
  const [workflowTitle, setWorkflowTitle] = useState('Untitled Flow');
  const [activeTraceMeta, setActiveTraceMeta] = useState<{ sessionId: string; jobId: string; eventCount: number } | null>(null);
  const [canvasPickerAnchor, setCanvasPickerAnchor] = useState<{ nodeId: string; type: 'image' | 'video'; rect: DOMRect } | null>(null);
  const activeTraceRef = useRef<{ sessionId: string; jobId: string } | null>(null);
  const copy = WORKFLOW_COPY[language] || WORKFLOW_COPY.en;
  const attachments = useMemo(() => safeArray(attachmentsInput), [attachmentsInput]);
  const canvasImages = useMemo(() => safeArray(canvasImagesInput), [canvasImagesInput]);
  const canvasVideos = useMemo(() => safeArray(canvasVideosInput), [canvasVideosInput]);
  const userApiKeys = useMemo(() => safeArray(userApiKeysInput), [userApiKeysInput]);
  const assetLibrary = useMemo(() => normalizeAssetLibrary(assetLibraryInput), [assetLibraryInput]);
  const generationHistory = useMemo(() => safeArray(generationHistoryInput), [generationHistoryInput]);

  useEffect(() => {
    if (hydratedFromRuntimeRef.current) return;
    hydratedFromRuntimeRef.current = true;
    const graph = selectWorkflowGraph(runtime);
    if (graph.nodes.length === 0) return;
    store.replaceGraph(graph);
  }, [runtime, store]);

  useEffect(() => {
    const current = useRuntimeStore.getState().runtime;
    replaceRuntime(syncWorkflowGraphIntoRuntime(current, {
      nodes: store.nodes,
      edges: store.edges,
      groups: store.groups,
      viewport: store.viewport,
    }));
  }, [
    replaceRuntime,
    store.edges,
    store.groups,
    store.nodes,
    store.viewport,
  ]);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setCanvasSize({
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      });
    };

    updateSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize);
      return () => window.removeEventListener('resize', updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const getToolPanelTitle = (tab: ToolPanelTab): string => {
    if (tab === 'nodes') return copy.workflowNodes;
    if (tab === 'workflows') return copy.savedWorkflows;
    if (tab === 'assets') return copy.sharedAssets;
    if (tab === 'history') return copy.history;
    return TOOL_PANEL_TITLES.create;
  };

  const selectedNode = store.selectedNodeIds.length > 0 ? store.nodeMap.get(store.selectedNodeIds[0]) ?? null : null;
  const selectedGroup = store.selectedGroupId
    ? store.groups.find((group) => group.id === store.selectedGroupId) ?? null
    : null;

  const updateConnectionMenu = (next: ConnectionMenuState | null) => {
    connectionMenuOpenRef.current = !!next;
    setConnectionMenu(next);
  };

  const getEffectiveNodeRuntime = (nodeId: string, config?: NodeConfig): WorkflowNodeRunState | null => {
    const runtime = nodeRunState[nodeId];
    if (runtime) return runtime;
    if (config?.pinnedOutputs) {
      return {
        status: 'pinned',
        outputs: config.pinnedOutputs,
        message: 'Pinned output',
        updatedAt: 0,
      };
    }
    return null;
  };

  const selectedNodeRuntime = selectedNode ? getEffectiveNodeRuntime(selectedNode.id, selectedNode.config) : null;
  const workflowProgress = useMemo(() => {
    const total = Math.max(1, store.nodes.length);
    const completed = store.nodes.filter((node) => {
      const status = getEffectiveNodeRuntime(node.id, node.config)?.status;
      return status === 'success' || status === 'pinned';
    }).length;
    return Math.round((completed / total) * 100);
  }, [nodeRunState, store.nodes]);

  const sharedAssetItems = useMemo<SharedAssetPanelItem[]>(() => (
    (['character', 'scene', 'prop'] as AssetCategory[]).flatMap((category) => (
      assetLibrary[category].map((item) => ({
        id: item.id,
        name: item.name || '未命名素材',
        category,
        href: item.dataUrl,
        mimeType: item.mimeType,
        width: item.width,
        height: item.height,
        createdAt: item.createdAt,
      }))
    ))
  ), [assetLibrary]);

  const filteredSharedAssets = useMemo(() => (
    assetPanelFilter === 'all'
      ? sharedAssetItems
      : sharedAssetItems.filter((item) => item.category === assetPanelFilter)
  ), [assetPanelFilter, sharedAssetItems]);

  const usableApiKeyOptions = useMemo(() => (
    userApiKeys
      .filter((apiKey) => apiKey.key && apiKey.status !== 'error')
      .map((apiKey) => ({
        value: apiKey.id,
        label: `${apiKey.name || apiKey.provider}${apiKey.isDefault ? ' - Default' : ''} (${apiKey.provider})`,
        name: apiKey.name,
        provider: apiKey.provider,
        isDefault: apiKey.isDefault,
      }))
  ), [userApiKeys]);

  const getNodeGenerationMode = (node: Pick<WorkflowNode, 'kind' | 'config'>): 'image' | 'video' => (
    node.config?.generationMode === 'video' || node.kind === 'videoGen'
      ? 'video'
      : 'image'
  );

  const getModelOptionsForNode = (node: Pick<WorkflowNode, 'kind' | 'config'>): string[] => {
    if (node.kind === 'videoGen') return videoModelOptions;
    if (node.kind === 'imageGen') return imageModelOptions;
    if (node.kind === 'generator') {
      return getNodeGenerationMode(node) === 'video' ? videoModelOptions : imageModelOptions;
    }
    return [];
  };

  const updateNodeModel = (node: Pick<WorkflowNode, 'id' | 'kind' | 'config'>, model: string) => {
    if (!model) {
      store.updateNodeConfig(node.id, { model: undefined, provider: undefined });
      return;
    }
    store.updateNodeConfig(node.id, {
      model,
      provider: inferProviderFromModel(model),
    });
  };

  const updateNodeGenerationMode = (node: Pick<WorkflowNode, 'id' | 'config'>, mode: 'image' | 'video') => {
    const model = mode === 'video' ? selectedVideoModel : selectedImageModel;
    store.updateNodeConfig(node.id, {
      generationMode: mode,
      model,
      provider: model ? inferProviderFromModel(model) : undefined,
    });
  };

  const getNodePromptValue = (node: WorkflowNode | null | undefined): string => (
    node?.config?.prompt ?? (node?.kind === 'prompt' ? prompt : '')
  );

  const updateNodePrompt = (node: WorkflowNode, value: string) => {
    store.updateNodeConfig(node.id, { prompt: value });
    if (node.kind === 'prompt') {
      setPrompt(value);
    }
  };

  const insertComposerText = (node: WorkflowNode, value: string) => {
    updateNodePrompt(node, `${getNodePromptValue(node)}${value}`);
  };

  const workflowMentionItems = useMemo<WorkflowMentionItem[]>(() => {
    const counts = new Map<NodeKind, number>();
    return store.nodes.map((item) => {
      const nextCount = (counts.get(item.kind) ?? 0) + 1;
      counts.set(item.kind, nextCount);
      const baseLabel = NODE_LIBRARY_LABELS[item.kind] || getNodeTitle(item.kind, item.config?.label);
      const label = `${baseLabel} #${nextCount}`;
      return {
        id: item.id,
        label,
        reference: toWorkflowNodeReferenceLabel(label, item.id),
        shortId: item.id,
        kind: item.kind,
        badge: NODE_KIND_BADGES[item.kind] || 'NOD',
      };
    });
  }, [store.nodes]);

  const getFilteredWorkflowMentions = (node: WorkflowNode, query: string): WorkflowMentionItem[] => {
    const normalized = query.trim().toLowerCase();
    return workflowMentionItems
      .filter((item) => item.id !== node.id)
      .filter((item) => (
        !normalized
        || item.label.toLowerCase().includes(normalized)
        || item.kind.toLowerCase().includes(normalized)
        || item.badge.toLowerCase().includes(normalized)
        || item.id.toLowerCase().includes(normalized)
      ))
      .slice(0, 8);
  };

  const insertWorkflowMention = (node: WorkflowNode, item: WorkflowMentionItem) => {
    updateNodePrompt(node, replaceTrailingMentionQuery(getNodePromptValue(node), item.reference));
  };

  const resolveRunPrompt = (nodes: WorkflowNode[], focusNodeId?: string): string => {
    const focusNode = focusNodeId ? nodes.find((node) => node.id === focusNodeId) : null;
    return (
      focusNode?.config?.prompt?.trim()
      || prompt.trim()
      || nodes.find((node) => node.config?.prompt?.trim())?.config?.prompt?.trim()
      || ''
    );
  };

  const canRunScope = (scope: WorkflowExecutionScope, focusNodeId?: string): boolean => {
    if (isExecuting) return false;
    const plan = createExecutionPlan(preparedNodes, store.edges, scope, focusNodeId);
    return plan.nodes.length > 0;
  };

  const openToolPanel = (tab: ToolPanelTab, toggle = false) => {
    setToolPanelTab(tab);
    setIsToolPanelOpen((value) => (toggle ? !(value && toolPanelTab === tab) : true));
  };

  const saveCurrentWorkflow = () => {
    const now = Date.now();
    const name = workflowTitle.trim() || 'Untitled Flow';
    const snapshot: SavedWorkflow = {
      id: `workflow_${now}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      createdAt: now,
      updatedAt: now,
      favorite: false,
      nodes: cloneWorkflowNodes(store.nodes),
      edges: cloneWorkflowEdges(store.edges),
      groups: cloneWorkflowGroups(store.groups),
      viewport: { ...store.viewport },
    };
    setSavedWorkflows((prev) => {
      const next = [snapshot, ...prev].slice(0, 30);
      persistSavedWorkflows(next);
      return next;
    });
    setRunMessage(`Saved workflow: ${name}`);
  };

  const reuseSavedWorkflow = (workflow: SavedWorkflow) => {
    store.loadTemplate({
      nodes: cloneWorkflowNodes(workflow.nodes),
      edges: cloneWorkflowEdges(workflow.edges),
      groups: cloneWorkflowGroups(workflow.groups),
      viewport: workflow.viewport,
    });
    setWorkflowTitle(workflow.name);
    setRunError(null);
    setRunMessage(`Loaded saved workflow: ${workflow.name}. Undo restores the previous graph.`);
  };

  const exportSavedWorkflowTemplate = (workflow: SavedWorkflow) => {
    const pack = createWorkflowTemplatePackage({
      metadata: {
        name: workflow.name,
        description: `${workflow.name} workflow template`,
        tags: ['flovart', 'workflow'],
      },
      nodes: workflow.nodes,
      edges: workflow.edges,
      groups: workflow.groups,
      viewport: workflow.viewport,
      now: Date.now(),
    });
    const blob = new Blob([serializeWorkflowTemplatePackage(pack)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = toTemplateFilename(workflow.name);
    link.click();
    URL.revokeObjectURL(url);
    setRunMessage(`Exported template: ${workflow.name}`);
  };

  const toggleSavedWorkflowFavorite = (workflowId: string) => {
    setSavedWorkflows((prev) => {
      const next = prev.map((workflow) => (
        workflow.id === workflowId
          ? { ...workflow, favorite: !workflow.favorite, updatedAt: Date.now() }
          : workflow
      ));
      persistSavedWorkflows(next);
      return next;
    });
  };

  const useSharedAsset = (item: SharedAssetPanelItem) => {
    onDropCanvasImage({
      id: item.id,
      name: item.name,
      href: item.href,
      mimeType: item.mimeType,
    });
    setRunMessage(`Added asset to workflow prompt: ${item.name}`);
  };

  const applyHistoryItemToCanvas = (item: GenerationHistoryItem) => {
    if (!onPlaceWorkflowValue) return;
    void onPlaceWorkflowValue({
      kind: 'image',
      href: item.dataUrl,
      mimeType: item.mimeType,
      width: item.width,
      height: item.height,
    });
  };

  const appendRunEvent = (nodeId: string, status: WorkflowRunStatus, message: string, timestamp = Date.now()) => {
    setRunEvents((prev) => [
      ...prev.slice(-(MAX_RUN_EVENTS - 1)),
      {
        id: `${nodeId}-${timestamp}-${prev.length}`,
        nodeId,
        status,
        message,
        timestamp,
      },
    ]);
  };

  const syncActiveTraceMeta = (trace = activeTraceRef.current) => {
    if (!trace) {
      setActiveTraceMeta(null);
      return;
    }
    setActiveTraceMeta({
      sessionId: trace.sessionId,
      jobId: trace.jobId,
      eventCount: listTraceEventsForJob(trace.jobId).length,
    });
  };

  const resolveRunModelContext = (nodes: WorkflowNode[]) => {
    const configuredModelNode = nodes.find((node) => node.config?.model || node.config?.provider);
    const activeModel = configuredModelNode?.config?.model
      || (generationMode === 'video' ? selectedVideoModel : selectedImageModel)
      || undefined;
    const activeProvider = configuredModelNode?.config?.provider
      || (activeModel ? inferProviderFromModel(activeModel) : undefined);
    return { activeModel, activeProvider };
  };

  const getCanvasVideoForNode = (config?: NodeConfig): CanvasVideo | null => {
    if (config?.videoSourceId) {
      return canvasVideos.find((video) => video.id === config.videoSourceId) ?? null;
    }
    return canvasVideos[0] ?? null;
  };

  const renderProviderKeyStatus = (node: WorkflowNode) => {
    const needsKey = node.kind === 'llm'
      || node.kind === 'imageGen'
      || node.kind === 'videoGen'
      || node.kind === 'runningHub'
      || node.kind === 'generator';
    if (!needsKey) return null;

    const provider = node.config?.provider;
    const usableKeys = userApiKeys.filter((apiKey) => apiKey.key && apiKey.status !== 'error');
    const boundKey = node.config?.apiKeyRef
      ? userApiKeys.find((apiKey) => apiKey.id === node.config?.apiKeyRef)
      : undefined;
    const matchingKeys = provider
      ? usableKeys.filter((apiKey) => apiKey.provider === provider || apiKey.provider === 'custom')
      : usableKeys;
    const errorKeys = userApiKeys.filter((apiKey) => apiKey.status === 'error').length;
    const hasProblem = !!node.config?.apiKeyRef && (!boundKey?.key || boundKey.status === 'error');
    const statusText = hasProblem
      ? 'Bound key unavailable'
      : matchingKeys.length > 0
        ? `${matchingKeys.length} usable key${matchingKeys.length === 1 ? '' : 's'}`
        : 'No usable key found';

    return (
      <div className={joinClasses(
        'workflow-provider-status rounded-lg border p-3',
        (hasProblem || matchingKeys.length === 0) && 'is-warning',
      )}>
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-neutral-400">Provider Keys</div>
        <div className="space-y-1 text-xs text-neutral-600">
          <div>Status: {statusText}</div>
          <div>Provider: {provider || 'Auto'}</div>
          <div>Binding: {boundKey ? `${boundKey.name || boundKey.provider} (${boundKey.provider})` : 'Auto select'}</div>
          {errorKeys > 0 && <div className="workflow-provider-warning">{errorKeys} error key{errorKeys === 1 ? '' : 's'} skipped</div>}
        </div>
      </div>
    );
  };

  const preparedNodes = useMemo(() => {
    return store.nodes.map((node) => {
      const nextConfig = { ...node.config };
      if (node.kind === 'enhancer' && !nextConfig.systemPrompt) {
        nextConfig.systemPrompt = buildEnhancerSystemPrompt(enhanceMode, stylePreset);
      }
      if (node.kind === 'generator') {
        const nodeMode = nextConfig.generationMode || (generationMode === 'video' ? 'video' : 'image');
        nextConfig.generationMode = nodeMode;
        const fallbackModel = nodeMode === 'video' ? selectedVideoModel : selectedImageModel;
        if (!nextConfig.model && fallbackModel) nextConfig.model = fallbackModel;
        if (!nextConfig.provider && nextConfig.model) nextConfig.provider = inferProviderFromModel(nextConfig.model);
      }
      if (node.kind === 'imageGen') {
        if (!nextConfig.model && selectedImageModel) nextConfig.model = selectedImageModel;
        if (!nextConfig.provider && nextConfig.model) nextConfig.provider = inferProviderFromModel(nextConfig.model);
      }
      if (node.kind === 'videoGen') {
        if (!nextConfig.model && selectedVideoModel) nextConfig.model = selectedVideoModel;
        if (!nextConfig.provider && nextConfig.model) nextConfig.provider = inferProviderFromModel(nextConfig.model);
      }
      return { ...node, config: nextConfig };
    });
  }, [enhanceMode, generationMode, selectedImageModel, selectedVideoModel, store.nodes, stylePreset]);

  const nodeOutputsById = useMemo(() => {
    const outputs = new Map<string, NodeIOMap | undefined>();
    for (const node of preparedNodes) {
      outputs.set(node.id, getEffectiveNodeRuntime(node.id, node.config)?.outputs);
    }
    return outputs;
  }, [nodeRunState, preparedNodes]);

  const getNodeDisplayMedia = (node: WorkflowNode): DisplayMediaValue | null => {
    const runtime = getEffectiveNodeRuntime(node.id, node.config);
    const primaryValue = getPrimaryWorkflowValue(runtime?.outputs);
    const configuredMedia = getConfigMediaValue(node.config);
    const upstreamMedia = getPrimaryWorkflowValue(collectNodeInputValues(node.id, store.edges, nodeOutputsById));
    if (isDisplayMediaValue(primaryValue)) return primaryValue;
    if (isDisplayMediaValue(configuredMedia)) return configuredMedia;
    if (isDisplayMediaValue(upstreamMedia)) return upstreamMedia;
    return null;
  };

  const saveNodeMediaToAssets = (nodeId: string) => {
    if (!onSaveWorkflowValueToAssets) return;
    const node = store.nodeMap.get(nodeId);
    if (!node) return;
    const displayMedia = getNodeDisplayMedia(node);
    if (!displayMedia) return;
    void onSaveWorkflowValueToAssets(displayMedia, node);
    setRunMessage(`Added ${getNodeTitle(node.kind, node.config?.label)} to shared asset library.`);
  };

  const selectedNodeInputs = useMemo(() => {
    if (!selectedNode) return {} as NodeIOMap;
    return collectNodeInputValues(selectedNode.id, store.edges, nodeOutputsById);
  }, [nodeOutputsById, selectedNode, store.edges]);

  const selectedNodeEvents = useMemo(() => {
    if (!selectedNode) return [] as WorkflowRunEvent[];
    return runEvents
      .filter((event) => event.nodeId === selectedNode.id)
      .slice(-8)
      .reverse();
  }, [runEvents, selectedNode]);

  const recentRunEvents = useMemo(() => runEvents.slice(-10).reverse(), [runEvents]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - store.viewport.x) / store.viewport.scale,
      y: (clientY - rect.top - store.viewport.y) / store.viewport.scale,
    };
  };

  const edgePaths = useMemo(() => {
    return store.edges
      .map((edge) => {
        const from = store.nodeMap.get(edge.fromNode);
        const to = store.nodeMap.get(edge.toNode);
        if (!from || !to) return null;
        const fromIdx = NODE_DEFS[from.kind].outputs.findIndex((port) => port.key === edge.fromPort);
        const toIdx = NODE_DEFS[to.kind].inputs.findIndex((port) => port.key === edge.toPort);
        if (fromIdx < 0 || toIdx < 0) return null;
        const p1 = getPortPosition(from, fromIdx, true);
        const p2 = getPortPosition(to, toIdx, false);
        const fromStatus = getEffectiveNodeRuntime(from.id, from.config)?.status;
        const toStatus = getEffectiveNodeRuntime(to.id, to.config)?.status;
        const selected = store.selectedNodeIds.includes(from.id) || store.selectedNodeIds.includes(to.id);
        const statusClass = store.activeNodeId === from.id || store.activeNodeId === to.id
          ? 'is-running'
          : RUN_STATUS_EDGE_CLASSES[toStatus || fromStatus || 'idle']
            || (selected ? 'is-selected' : '');
        const stroke = statusClass === 'is-running'
          ? 'rgba(217, 119, 6, 0.9)'
          : statusClass === 'is-error'
            ? 'rgba(225, 29, 72, 0.78)'
            : statusClass === 'is-success'
              ? 'rgba(5, 150, 105, 0.7)'
              : statusClass === 'is-pinned'
                ? 'rgba(82, 82, 82, 0.72)'
                : statusClass === 'is-selected'
                  ? 'rgba(35, 131, 226, 0.82)'
                  : 'rgba(120, 113, 108, 0.48)';
        const strokeWidth = statusClass === 'is-running' ? 2.4 : statusClass ? 2.1 : 1.8;
        return { id: edge.id, d: getBezierPath(p1, p2), statusClass, stroke, strokeWidth };
      })
      .filter((item): item is { id: string; d: string; statusClass: string; stroke: string; strokeWidth: number } => !!item);
  }, [getEffectiveNodeRuntime, store.activeNodeId, store.edges, store.nodeMap, store.selectedNodeIds]);

  const pendingPath = useMemo(() => {
    if (!store.pendingConnection) return null;
    const source = store.nodeMap.get(store.pendingConnection.fromNode);
    if (!source) return null;
    const index = NODE_DEFS[source.kind].outputs.findIndex((port) => port.key === store.pendingConnection?.fromPort);
    if (index < 0) return null;
    const p1 = getPortPosition(source, index, true);
    const p2 = { x: store.pendingConnection.mouseX, y: store.pendingConnection.mouseY };
    return getBezierPath(p1, p2);
  }, [store.pendingConnection, store.nodeMap]);

  const runGraph = async (scope: WorkflowExecutionScope = 'workflow', focusNodeId?: string) => {
    if (isExecuting) return;
    const executionPlan = createExecutionPlan(preparedNodes, store.edges, scope, focusNodeId);
    if (executionPlan.nodes.length === 0) return;
    const runPrompt = resolveRunPrompt(executionPlan.nodes, focusNodeId);

    const runLabel = scope === 'node'
      ? 'Node execution'
      : scope === 'from-here'
        ? 'Execute from here'
        : 'Workflow';
    const initialTimestamp = Date.now();
    const runContext = resolveRunModelContext(executionPlan.nodes);
    const inputImageCount = attachments.filter((attachment) => attachment.mimeType.startsWith('image/')).length;
    const traceSession = createRuntimeSession({
      name: `${runLabel} session`,
      source: 'workflow',
      linkedBridge: 'none',
      keyContext: {
        sharedWithExtension: false,
        activeProvider: runContext.activeProvider,
        activeModel: runContext.activeModel,
      },
    });
    const traceJob = createRuntimeJob({
      sessionId: traceSession.sessionId,
      source: 'workflow',
      command: `workflow.run.${scope}`,
      status: 'queued',
      inputSummary: {
        scope,
        nodeCount: executionPlan.nodes.length,
        promptLength: runPrompt.length,
        inputImageCount,
        inputVideoCount: canvasVideos.length,
      },
    });
    activeTraceRef.current = {
      sessionId: traceSession.sessionId,
      jobId: traceJob.jobId,
    };
    appendTraceEvent({
      sessionId: traceSession.sessionId,
      jobId: traceJob.jobId,
      level: 'info',
      stage: 'workflow.queued',
      message: `Queued ${executionPlan.nodes.length} nodes for ${runLabel.toLowerCase()}`,
      timestamp: initialTimestamp,
      meta: {
        scope,
        nodeIds: executionPlan.nodes.map((node) => node.id),
      },
    });
    syncActiveTraceMeta(activeTraceRef.current);
    setIsExecuting(true);
    setRunError(null);
    setRunMessage(`Queueing ${runLabel.toLowerCase()}...`);
    setNodeRunState((prev) => {
      const next = scope === 'workflow' ? {} : { ...prev };
      for (const node of executionPlan.nodes) {
        next[node.id] = {
          status: 'queued',
          updatedAt: initialTimestamp,
          message: 'Queued',
        };
      }
      return next;
    });
    setRunEvents((prev) => {
      const retainedCount = Math.max(0, MAX_RUN_EVENTS - executionPlan.nodes.length);
      const base = scope === 'workflow' ? [] : prev.slice(-retainedCount);
      const queuedEvents = executionPlan.nodes.map((node, index) => ({
        id: `${node.id}-${initialTimestamp + index}-queued`,
        nodeId: node.id,
        status: 'queued' as WorkflowRunStatus,
        message: 'Queued',
        timestamp: initialTimestamp + index,
      }));
      return [...base, ...queuedEvents].slice(-MAX_RUN_EVENTS);
    });

    try {
      const result = await executeWorkflow(executionPlan.nodes, executionPlan.edges, {
        apiKeys: userApiKeys,
        inputPrompt: runPrompt,
        inputImages: attachments
          .filter((attachment) => attachment.mimeType.startsWith('image/'))
          .map((attachment) => attachment.href),
        inputVideos: canvasVideos.map((video) => ({
          id: video.id,
          kind: 'video',
          href: video.href,
          mimeType: video.mimeType,
          width: video.width,
          height: video.height,
          posterHref: video.poster,
          durationSec: video.durationSec,
          trimInSec: video.trimInSec,
          trimOutSec: video.trimOutSec,
          sourceVideoId: video.id,
        })),
        onProgress: (nodeId, status) => {
          const runtimeStatus = normalizeWorkflowProgressStatus(status);
          const node = preparedNodes.find((item) => item.id === nodeId);
          const trace = activeTraceRef.current;
          store.setActiveNodeId(runtimeStatus === 'running' ? nodeId : null);
          appendRunEvent(nodeId, runtimeStatus, status);
          setRunMessage(node ? `${getNodeTitle(node.kind, node.config?.label)} - ${status}` : status);
          if (trace) {
            if (runtimeStatus === 'running') {
              updateRuntimeJob(trace.jobId, { status: 'running' });
            }
            appendTraceEvent({
              sessionId: trace.sessionId,
              jobId: trace.jobId,
              nodeId,
              level: status.startsWith('retry') ? 'warn' : 'info',
              stage: `workflow.${runtimeStatus}`,
              message: status,
              meta: node ? {
                nodeKind: node.kind,
                nodeTitle: getNodeTitle(node.kind, node.config?.label),
              } : undefined,
            });
            syncActiveTraceMeta(trace);
          }
          setNodeRunState((prev) => ({
            ...prev,
            [nodeId]: {
              ...(prev[nodeId] ?? { updatedAt: Date.now() }),
              status: runtimeStatus,
              message: status,
              updatedAt: Date.now(),
            },
          }));
        },
        onNodeComplete: (nodeId, outputs) => {
          const primaryValue = getPrimaryWorkflowValue(outputs);
          const wasPinned = !!executionPlan.nodes.find((item) => item.id === nodeId)?.config?.pinnedOutputs;
          const trace = activeTraceRef.current;
          appendRunEvent(
            nodeId,
            wasPinned ? 'pinned' : 'success',
            wasPinned ? 'Pinned output reused' : summarizeWorkflowValue(primaryValue),
          );
          if (trace) {
            appendTraceEvent({
              sessionId: trace.sessionId,
              jobId: trace.jobId,
              nodeId,
              level: 'info',
              stage: wasPinned ? 'workflow.pinned' : 'workflow.success',
              message: wasPinned ? 'Pinned output reused' : summarizeWorkflowValue(primaryValue),
              meta: {
                outputKind: primaryValue?.kind || 'empty',
              },
            });
            syncActiveTraceMeta(trace);
          }
          setNodeRunState((prev) => ({
            ...prev,
            [nodeId]: {
              status: wasPinned ? 'pinned' : 'success',
              outputs,
              message: wasPinned ? 'Pinned output reused' : summarizeWorkflowValue(primaryValue),
              updatedAt: Date.now(),
            },
          }));
        },
        onError: (nodeId, error) => {
          const trace = activeTraceRef.current;
          setRunError(error);
          appendRunEvent(nodeId, 'error', error);
          if (trace) {
            appendTraceEvent({
              sessionId: trace.sessionId,
              jobId: trace.jobId,
              nodeId,
              level: 'error',
              stage: 'workflow.error',
              message: error,
            });
            syncActiveTraceMeta(trace);
          }
          setNodeRunState((prev) => ({
            ...prev,
            [nodeId]: {
              ...(prev[nodeId] ?? { updatedAt: Date.now() }),
              status: 'error',
              error,
              message: error,
              updatedAt: Date.now(),
            },
          }));
        },
        onPlaceOnCanvas: onPlaceWorkflowValue,
        onSaveToAssets: onSaveWorkflowValueToAssets,
        retryPolicy: {
          maxRetries: 0,
          backoffMs: 1200,
          backoffMultiplier: 2,
        },
      });
      store.setActiveNodeId(null);
      if (result.success) {
        setRunMessage(`${runLabel} completed`);
      } else {
        setRunError(result.errors[0]?.error || 'Execution failed. Check links and node parameters.');
        setRunMessage(result.errors[0]?.error || `${runLabel} failed`);
      }
      if (activeTraceRef.current) {
        updateRuntimeJob(activeTraceRef.current.jobId, {
          status: result.success ? 'success' : 'error',
          error: result.errors[0]?.error || null,
        });
        appendTraceEvent({
          sessionId: activeTraceRef.current.sessionId,
          jobId: activeTraceRef.current.jobId,
          level: result.success ? 'info' : 'error',
          stage: result.success ? 'workflow.complete' : 'workflow.failed',
          message: result.success ? `${runLabel} completed` : (result.errors[0]?.error || `${runLabel} failed`),
          meta: {
            errorCount: result.errors.length,
          },
        });
        syncActiveTraceMeta(activeTraceRef.current);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Execution failed. Check links and node parameters.';
      setRunError(message);
      setRunMessage(message);
      store.setActiveNodeId(null);
      if (activeTraceRef.current) {
        updateRuntimeJob(activeTraceRef.current.jobId, {
          status: 'error',
          error: message,
        });
        appendTraceEvent({
          sessionId: activeTraceRef.current.sessionId,
          jobId: activeTraceRef.current.jobId,
          level: 'error',
          stage: 'workflow.crash',
          message,
        });
        syncActiveTraceMeta(activeTraceRef.current);
      }
    } finally {
      setIsExecuting(false);
    }
  };

  const commitInspectorField = (nodeId: string, field: NodeInspectorField, rawValue: string) => {
    if (field.type === 'number') {
      if (rawValue === '') {
        const nextValue = field.allowEmpty ? undefined : field.defaultValue ?? 0;
        store.updateNodeConfig(nodeId, { [field.key]: nextValue } as Partial<NodeConfig>);
        return;
      }
      const parsed = Number(rawValue);
      if (Number.isNaN(parsed)) return;
      store.updateNodeConfig(nodeId, { [field.key]: parsed } as Partial<NodeConfig>);
      return;
    }

    if (field.type === 'select') {
      const nextValue = rawValue === '' && field.allowEmpty ? undefined : rawValue;
      store.updateNodeConfig(nodeId, { [field.key]: nextValue } as Partial<NodeConfig>);
      return;
    }

    store.updateNodeConfig(nodeId, { [field.key]: rawValue } as Partial<NodeConfig>);
  };

  const renderInspectorField = (
    node: { id: string; kind: NodeKind; config?: NodeConfig },
    field: NodeInspectorField,
  ) => {
    const value = node.config?.[field.key];
    const sharedLabel = (
      <label className="block text-[11px] text-white/60" htmlFor={`${node.id}-${String(field.key)}`}>
        {field.label}
      </label>
    );

    if (field.type === 'textarea') {
      return (
        <div key={String(field.key)} className="space-y-1.5">
          {sharedLabel}
          <textarea
            id={`${node.id}-${String(field.key)}`}
            value={(value as string | undefined) ?? field.defaultValue ?? ''}
            onChange={(event) => commitInspectorField(node.id, field, event.target.value)}
            className="w-full resize-none rounded border border-white/15 bg-black/20 px-2 py-2 text-xs outline-none"
            rows={field.rows ?? 5}
            placeholder={field.placeholder}
            title={field.title}
          />
        </div>
      );
    }

    if (field.key === 'model') {
      const modelOptions = getModelOptionsForNode(node);
      if (modelOptions.length > 0) {
        return (
          <div key={String(field.key)} className="space-y-1.5">
            {sharedLabel}
            <select
              id={`${node.id}-${String(field.key)}`}
              value={(value as string | undefined) ?? ''}
              onChange={(event) => updateNodeModel(node, event.target.value)}
              className="w-full rounded border border-white/15 bg-black/20 px-2 py-1.5 text-xs outline-none"
              title={field.title}
            >
              <option value="">Workspace default</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </div>
        );
      }
    }

    if (field.type === 'select') {
      const selectOptions = field.key === 'apiKeyRef'
        ? usableApiKeyOptions
            .filter(() => true)
            .map((apiKey) => ({
              value: apiKey.value,
              label: `${apiKey.name || apiKey.provider}${apiKey.isDefault ? ' 路 Default' : ''} (${apiKey.provider})`,
            }))
        : field.options;
      const resolvedSelectOptions = field.key === 'videoSourceId'
        ? canvasVideos.map((video) => ({
            value: video.id,
            label: video.name || `Canvas Video ${video.id.slice(-4)}`,
          }))
        : selectOptions;
      return (
        <div key={String(field.key)} className="space-y-1.5">
          {sharedLabel}
          <select
            id={`${node.id}-${String(field.key)}`}
            value={(value as string | undefined) ?? field.defaultValue ?? ''}
            onChange={(event) => commitInspectorField(node.id, field, event.target.value)}
            className="w-full rounded border border-white/15 bg-black/20 px-2 py-1.5 text-xs outline-none"
            title={field.title}
          >
            {field.allowEmpty && <option value="">{field.emptyLabel ?? 'Auto'}</option>}
            {resolvedSelectOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === 'number') {
      return (
        <div key={String(field.key)} className="space-y-1.5">
          {sharedLabel}
          <input
            id={`${node.id}-${String(field.key)}`}
            value={
              typeof value === 'number'
                ? value
                : field.allowEmpty
                  ? ''
                  : field.defaultValue ?? ''
            }
            onChange={(event) => commitInspectorField(node.id, field, event.target.value)}
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            className="w-full rounded border border-white/15 bg-black/20 px-2 py-1.5 text-xs outline-none"
            title={field.title}
          />
        </div>
      );
    }

    return (
      <div key={String(field.key)} className="space-y-1.5">
        {sharedLabel}
        <input
          id={`${node.id}-${String(field.key)}`}
          value={(value as string | undefined) ?? field.defaultValue ?? ''}
          onChange={(event) => commitInspectorField(node.id, field, event.target.value)}
          className="w-full rounded border border-white/15 bg-black/20 px-2 py-1.5 text-xs outline-none"
          placeholder={field.placeholder ?? (field.key === 'label' ? NODE_DEFS[node.kind].title : undefined)}
          title={field.title}
        />
      </div>
    );
  };

  const pinNodeOutput = (nodeId: string) => {
    const runtime = nodeRunState[nodeId];
    if (!runtime?.outputs) return;
    store.updateNodeConfig(nodeId, { pinnedOutputs: runtime.outputs });
    setNodeRunState((prev) => ({
      ...prev,
      [nodeId]: {
        ...runtime,
        status: 'pinned',
        message: 'Pinned output',
        updatedAt: Date.now(),
      },
    }));
  };

  const unpinNodeOutput = (nodeId: string) => {
    store.updateNodeConfig(nodeId, { pinnedOutputs: undefined });
    setNodeRunState((prev) => {
      const runtime = prev[nodeId];
      if (!runtime) return prev;
      return {
        ...prev,
        [nodeId]: {
          ...runtime,
          status: 'idle',
          message: 'Pin cleared',
          updatedAt: Date.now(),
        },
      };
    });
  };

  const renderMediaNodeCardBody = (
    node: WorkflowNode,
    displayMedia: DisplayMediaValue | null,
  ) => {
    const label = node.kind === 'videoGen' ? 'Video' : 'Image';

    return (
      <div
        className="workflow-media-node relative h-full"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => handleNodeMediaDrop(event, node)}
      >
        <div
          className="workflow-media-frame flex h-full min-h-[116px] items-center justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-50"
          title={copy.uploadMedia}
          onDoubleClick={(event) => {
            event.stopPropagation();
            openNodeMediaPicker(node);
          }}
        >
          {displayMedia?.kind === 'image' && (
            <img src={displayMedia.href} alt={`${label} media`} className="h-full w-full object-cover" />
          )}
          {displayMedia?.kind === 'video' && (
            <video
              src={displayMedia.href}
              poster={displayMedia.posterHref}
              muted
              playsInline
              controls
              className="h-full w-full bg-black object-cover"
            />
          )}
          {!displayMedia && (
            <div className="workflow-media-placeholder flex h-full w-full items-center justify-center text-neutral-400">
              {node.kind === 'videoGen' ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 8.5v7l6-3.5-6-3.5Z" fill="currentColor" opacity="0.72" />
                  <rect x="4.25" y="5.25" width="15.5" height="13.5" rx="2" stroke="currentColor" strokeWidth="1.5" opacity="0.38" />
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="m5 16 4-4 3 3 2-2 5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity="0.58" />
                  <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" opacity="0.42" />
                </svg>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderNodeActionMenu = (node: WorkflowNode) => (
    <div
      className="workflow-node-action-menu absolute left-1/2 top-[-38px] z-30 flex -translate-x-1/2 items-center gap-1 rounded-md border px-1 py-1"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="workflow-node-action-button"
        aria-label={copy.runNode}
        title={copy.runNode}
        disabled={!canRunScope('node', node.id)}
        onClick={() => runGraph('node', node.id)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="workflow-node-action-button"
        aria-label={copy.copyNode}
        title={copy.copyNode}
        onClick={() => {
          store.selectSingleNode(node.id, false);
          store.copySelection();
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="8" y="8" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
          <path d="M6 14H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="workflow-node-action-button is-danger"
        aria-label={copy.deleteNode}
        title={copy.deleteNode}
        onClick={() => store.removeNode(node.id)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 7h14M10 11v6M14 11v6M9 7l1-2h4l1 2M7 7l1 13h8l1-13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );

  const renderNodeRuntimeControls = (node: WorkflowNode) => {
    const modelOptions = getModelOptionsForNode(node);
    const canChooseModel = modelOptions.length > 0;
    const canChooseKey = ['generator', 'imageGen', 'videoGen', 'llm', 'runningHub'].includes(node.kind);
    if (!canChooseModel && !canChooseKey) return null;

    return (
      <div className="workflow-node-runtime-controls mb-2 space-y-1.5 rounded-lg border p-2">
        {node.kind === 'generator' && (
          <div className="grid grid-cols-2 gap-1">
            {(['image', 'video'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={joinClasses('rounded-md px-2 py-1 text-[10px] font-semibold', getNodeGenerationMode(node) === mode && 'is-active')}
                onClick={(e) => {
                  e.stopPropagation();
                  updateNodeGenerationMode(node, mode);
                }}
              >
                {mode === 'video' ? 'Video' : 'Image'}
              </button>
            ))}
          </div>
        )}
        {canChooseModel && (
          <select
            value={node.config?.model || ''}
            onChange={(e) => updateNodeModel(node, e.target.value)}
            className="w-full rounded-md border border-white/15 bg-black/20 px-2 py-1 text-[10px]"
            title="Node model"
          >
            <option value="">Default model</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        )}
        {canChooseKey && (
          <select
            value={node.config?.apiKeyRef || ''}
            onChange={(e) => store.updateNodeConfig(node.id, { apiKeyRef: e.target.value || undefined })}
            className="w-full rounded-md border border-white/15 bg-black/20 px-2 py-1 text-[10px]"
            title="Node API key"
          >
            <option value="">Auto API key</option>
            {usableApiKeyOptions.map((apiKey) => (
              <option key={apiKey.value} value={apiKey.value}>
                {apiKey.label}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const renderFloatingComposer = (node: WorkflowNode) => {
    const def = NODE_DEFS[node.kind];
    const promptValue = getNodePromptValue(node);
    const modelOptions = getModelOptionsForNode(node);
    const canChooseModel = modelOptions.length > 0;
    const isVideoNode = node.kind === 'videoGen'
      || node.kind === 'videoEdit'
      || (node.kind === 'generator' && getNodeGenerationMode(node) === 'video');
    const mentionQuery = getTrailingMentionQuery(promptValue);
    const workflowReferenceItems = mentionQuery == null ? [] : getFilteredWorkflowMentions(node, mentionQuery);
    const showCommandMenu = promptValue.trimEnd().endsWith('/');
    const showReferenceMenu = workflowReferenceItems.length > 0;
    const composerWidth = COMPACT_COMPOSER_WIDTH;
    const composerLeft = node.x + def.width / 2 - composerWidth / 2;
    const composerTop = node.y + def.height + 12;

    return (
      <div
        key={`composer-${node.id}`}
        className="workflow-floating-composer absolute z-40 rounded-xl border p-3"
        style={{ left: composerLeft, top: composerTop, width: composerWidth }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsPromptDropOver(true);
        }}
        onDragLeave={() => setIsPromptDropOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsPromptDropOver(false);
          handleDropPayload(e);
        }}
      >
        <div className={joinClasses('workflow-composer-input relative rounded-xl border', isPromptDropOver && 'is-drop-over')}>
          <textarea
            value={promptValue}
            onChange={(e) => updateNodePrompt(node, e.target.value)}
            aria-label={copy.nodePrompt}
            className="workflow-composer-textarea h-28 w-full resize-none bg-transparent px-3 py-3 text-[14px] leading-6 outline-none"
            placeholder={copy.promptPlaceholder}
            title={copy.nodePrompt}
          />
          {(showCommandMenu || showReferenceMenu) && (
            <div className="workflow-composer-suggest absolute left-3 top-12 z-10 w-[260px] rounded-xl border p-1.5">
              {showCommandMenu && COMPOSER_COMMANDS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="block w-full rounded-lg px-2.5 py-2 text-left text-[12px]"
                  onClick={() => insertComposerText(node, item.value)}
                >
                  {item.label}
                </button>
              ))}
              {showReferenceMenu && workflowReferenceItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px]"
                  aria-label={`Reference workflow node ${item.label}`}
                  onClick={() => insertWorkflowMention(node, item)}
                >
                  <span className="workflow-reference-badge inline-flex h-5 min-w-8 items-center justify-center rounded px-1 text-[9px] font-bold">
                    {item.badge}
                  </span>
                  <span className="min-w-0 flex-1 truncate">@{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          {canChooseModel && (
            <select
              value={node.config?.model || ''}
              onChange={(e) => updateNodeModel(node, e.target.value)}
            className="workflow-composer-select h-9 rounded-xl px-3"
            title="Node model"
          >
              <option value="">
                {getCompactModelLabel(
                  node.config?.model || (isVideoNode ? selectedVideoModel : selectedImageModel),
                  isVideoNode ? 'video' : 'image',
                )}
              </option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          )}
          <select
            value={node.config?.aspectRatio || '16:9'}
            onChange={(e) => store.updateNodeConfig(node.id, { aspectRatio: e.target.value })}
            className="workflow-composer-select h-9 rounded-xl px-3"
            title="Aspect ratio"
          >
            {COMPOSER_ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
          <select
            value={node.config?.resolution || '2K'}
            onChange={(e) => store.updateNodeConfig(node.id, { resolution: e.target.value })}
            className="workflow-composer-select h-9 rounded-xl px-3"
            title="Resolution"
          >
            {COMPOSER_RESOLUTIONS.map((resolution) => (
              <option key={resolution} value={resolution}>
                {resolution}
              </option>
            ))}
          </select>
          {isVideoNode && (
            <>
              <select
                value={String(node.config?.durationSec || 5)}
                onChange={(e) => store.updateNodeConfig(node.id, { durationSec: Number(e.target.value) })}
                className="workflow-composer-select h-9 rounded-xl px-3"
                title="Duration"
              >
                {COMPOSER_DURATIONS.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds}s
                  </option>
                ))}
              </select>
              <select
                value={String(node.config?.fps || 30)}
                onChange={(e) => store.updateNodeConfig(node.id, { fps: Number(e.target.value) })}
                className="workflow-composer-select h-9 rounded-xl px-3"
                title="FPS"
              >
                {COMPOSER_FPS.map((fps) => (
                  <option key={fps} value={fps}>
                    {fps}fps
                  </option>
                ))}
              </select>
            </>
          )}
          <select
            value={String(node.config?.outputCount || 1)}
            onChange={(e) => store.updateNodeConfig(node.id, { outputCount: Number(e.target.value) })}
            className="workflow-composer-select h-9 rounded-xl px-3"
            title="Output count"
          >
            {COMPOSER_OUTPUT_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}张
              </option>
            ))}
          </select>
          <button
            type="button"
            className="workflow-composer-run ml-auto flex h-10 w-10 items-center justify-center rounded-xl"
            aria-label="Generate selected node"
            disabled={!canRunScope('node', node.id)}
            onClick={() => runGraph('node', node.id)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  const renderValuePreview = (value: WorkflowValue | null | undefined) => {
    if (!value || value.kind === 'empty') {
      return <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">No output yet</div>;
    }
    if (value.kind === 'image') {
      return <img src={value.href} alt="Workflow output" className="max-h-48 w-full rounded border border-white/10 object-cover" />;
    }
    if (value.kind === 'video') {
      return <video src={value.href} controls className="max-h-48 w-full rounded border border-white/10 bg-black/40" />;
    }
    if (value.kind === 'json') {
      return (
        <pre className="max-h-48 overflow-auto rounded border border-white/10 bg-black/20 p-3 text-[11px] text-white/70 whitespace-pre-wrap break-all">
          {JSON.stringify(value.value, null, 2)}
        </pre>
      );
    }
    return (
      <pre className="max-h-48 overflow-auto rounded border border-white/10 bg-black/20 p-3 text-[11px] text-white/80 whitespace-pre-wrap break-all">
        {value.text}
      </pre>
    );
  };

  const renderPortValueList = (
    direction: 'input' | 'output',
    ports: NodePort[],
    values: NodeIOMap | undefined,
    emptyMessage: string,
  ) => {
    const populatedPorts = ports
      .map((port) => ({ port, value: values?.[port.key] }))
      .filter(({ value }) => !!value && value.kind !== 'empty');

    if (populatedPorts.length === 0) {
      return (
        <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {populatedPorts.map(({ port, value }) => (
          <div key={`${direction}-${port.key}`} className="rounded border border-white/10 bg-black/20 p-2">
            <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-white/55">
              <span>{port.label}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase">{port.type}</span>
            </div>
            <div className="mb-2 text-[11px] text-white/50">
              {summarizeWorkflowValue(value)}
            </div>
            {renderValuePreview(value)}
          </div>
        ))}
      </div>
    );
  };

  const openNodeMediaPicker = (node: WorkflowNode) => {
    if (!isMediaNodeKind(node.kind)) return;
    setMediaUploadTargetId(node.id);
    store.selectSingleNode(node.id, false);
    nodeMediaInputRef.current?.click();
  };

  const handleNodeMediaFiles = async (nodeId: string, fileList: FileList | File[]) => {
    const node = store.nodeMap.get(nodeId);
    if (!node || !isMediaNodeKind(node.kind)) return;

    const files = Array.from(fileList);
    const file = files.find((item) => {
      if (node.kind === 'imageGen') return item.type.startsWith('image/');
      return item.type.startsWith('image/') || item.type.startsWith('video/');
    });
    if (!file) return;

    const isVideo = file.type.startsWith('video/');
    const href = await readFileAsDataUrl(file);
    const mediaMeta = isVideo ? await readVideoMetadata(href) : await readImageDimensions(href);
    const updates: Partial<NodeConfig> = {
      mediaKind: isVideo ? 'video' : 'image',
      mediaHref: href,
      mediaMimeType: file.type || (isVideo ? 'video/mp4' : 'image/png'),
      mediaName: file.name,
      mediaWidth: mediaMeta.width,
      mediaHeight: mediaMeta.height,
      mediaDurationSec: isVideo ? (mediaMeta as { durationSec?: number }).durationSec : undefined,
      mediaPosterHref: undefined,
      mediaTrimInSec: undefined,
      mediaTrimOutSec: undefined,
      pinnedOutputs: undefined,
    };

    store.updateNodeConfig(node.id, updates, true);
    setNodeRunState((prev) => {
      const next = { ...prev };
      delete next[node.id];
      return next;
    });
  };

  const handleNodeMediaDrop = (event: React.DragEvent, node: WorkflowNode) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      void handleNodeMediaFiles(node.id, event.dataTransfer.files);
    }
  };

  const createSourceNodesFromFiles = async (files: FileList | File[], world: { x: number; y: number }) => {
    const mediaFiles = Array.from(files).filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (mediaFiles.length === 0) return false;

    for (const [index, file] of mediaFiles.entries()) {
      const isVideo = file.type.startsWith('video/');
      const href = await readFileAsDataUrl(file);
      const mediaMeta = isVideo ? await readVideoMetadata(href) : await readImageDimensions(href);
      store.addNode(isVideo ? 'loadVideo' : 'loadImage', {
        x: world.x + index * 320,
        y: world.y + (index % 2) * 180,
      }, {
        label: file.name || (isVideo ? 'Video Input' : 'Image Input'),
        mediaKind: isVideo ? 'video' : 'image',
        mediaHref: href,
        mediaMimeType: file.type || (isVideo ? 'video/mp4' : 'image/png'),
        mediaName: file.name,
        mediaWidth: mediaMeta.width,
        mediaHeight: mediaMeta.height,
        mediaDurationSec: isVideo ? (mediaMeta as { durationSec?: number }).durationSec : undefined,
      });
    }
    setRunMessage(`Created ${mediaFiles.length} source node${mediaFiles.length > 1 ? 's' : ''} from dropped media.`);
    return true;
  };

  const handleDropPayload = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData('application/x-canvas-image');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { id: string; name?: string; href: string; mimeType: string };
        if (parsed.href && parsed.mimeType) onDropCanvasImage(parsed);
      } catch {
        // ignore malformed payload
      }
    }
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFiles(e.dataTransfer.files);
    }
  };

  const importWorkflowFromFile = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as Partial<SavedWorkflow> | { workflow?: Partial<SavedWorkflow> };
    const candidate: Partial<SavedWorkflow> = 'workflow' in parsed && parsed.workflow ? parsed.workflow : parsed as Partial<SavedWorkflow>;
    const sanitized = sanitizeSavedWorkflow({
      id: candidate.id || `imported_${Date.now()}`,
      name: candidate.name || file.name.replace(/\.json$/i, '') || 'Imported Workflow',
      createdAt: candidate.createdAt || Date.now(),
      updatedAt: Date.now(),
      nodes: candidate.nodes || [],
      edges: candidate.edges || [],
      groups: candidate.groups || [],
      viewport: candidate.viewport,
    });
    if (!sanitized) throw new Error('Invalid workflow JSON. Expected nodes and edges.');
    reuseSavedWorkflow(sanitized);
  };

  const handleImportWorkflowFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await importWorkflowFromFile(file);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const centerWorldPosition = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 600, y: 360 };
    return {
      x: (rect.width * 0.45 - store.viewport.x) / store.viewport.scale,
      y: (rect.height * 0.45 - store.viewport.y) / store.viewport.scale,
    };
  };

  const fitWorkflowView = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    store.fitViewToContent(rect.width, rect.height);
  };

  const zoomWorkflow = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      store.setViewport((prev) => ({ ...prev, scale: clampScale(prev.scale * factor) }));
      return;
    }
    const nextScale = clampScale(store.viewport.scale * factor);
    const px = rect.width / 2;
    const py = rect.height / 2;
    const wx = (px - store.viewport.x) / store.viewport.scale;
    const wy = (py - store.viewport.y) / store.viewport.scale;
    store.setViewport({
      x: px - wx * nextScale,
      y: py - wy * nextScale,
      scale: nextScale,
    });
  };

  const openContextMenu = (
    event: React.MouseEvent,
    target: ContextMenuState['target'],
    payload?: { nodeId?: string; groupId?: string },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const world = toWorld(event.clientX, event.clientY);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      worldX: world.x,
      worldY: world.y,
      target,
      nodeId: payload?.nodeId,
      groupId: payload?.groupId,
    });
  };

  const pasteAtCenter = () => {
    store.pasteFromClipboard(centerWorldPosition());
  };

  const applyWorkflowTemplate = (template: WorkflowTemplate, sourceLabel: string) => {
    store.loadTemplate(template);
    setRunError(null);
    setRunMessage(`Loaded ${sourceLabel}: ${template.nameEn}. Undo restores the previous graph.`);
  };

  const filteredStarterTemplates = STARTER_WORKFLOW_TEMPLATES.filter((template) =>
    matchesWorkflowTemplateFilter(template, templateFilter),
  );

  const runContextAction = (action: string) => {
    if (!contextMenu) return;
    const at = { x: contextMenu.worldX, y: contextMenu.worldY };
    if (action === 'paste') {
      store.pasteFromClipboard(at);
    } else if (action === 'fit') {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) store.fitViewToContent(rect.width, rect.height);
    } else if (action.startsWith('add-') && NODE_LIBRARY_KINDS.includes(action.slice(4) as NodeKind)) {
      store.addNode(action.slice(4) as NodeKind, at);
    } else if (action === 'copy-node' && contextMenu.nodeId) {
      store.selectSingleNode(contextMenu.nodeId, false);
      store.copySelection();
    } else if (action === 'delete-node' && contextMenu.nodeId) {
      store.removeNode(contextMenu.nodeId);
    } else if (action === 'save-node-assets' && contextMenu.nodeId) {
      saveNodeMediaToAssets(contextMenu.nodeId);
    } else if (action === 'copy-group' && contextMenu.groupId) {
      store.selectGroup(contextMenu.groupId);
      store.copySelection();
    } else if (action === 'ungroup' && contextMenu.groupId) {
      store.removeGroup(contextMenu.groupId);
    } else if (action === 'add-prompt') {
      store.addNode('prompt', at);
    } else if (action === 'add-load-image') {
      store.addNode('loadImage', at);
    } else if (action === 'add-load-video') {
      store.addNode('loadVideo', at);
    } else if (action === 'add-enhancer') {
      store.addNode('enhancer', at);
    } else if (action === 'add-llm') {
      store.addNode('llm', at);
    } else if (action === 'add-template') {
      store.addNode('template', at);
    } else if (action === 'add-generator') {
      store.addNode('generator', at);
    } else if (action === 'add-image-gen') {
      store.addNode('imageGen', at);
    } else if (action === 'add-video-gen') {
      store.addNode('videoGen', at);
    } else if (action === 'add-video-edit') {
      store.addNode('videoEdit', at);
    } else if (action === 'add-runninghub') {
      store.addNode('runningHub', at);
    } else if (action === 'add-preview') {
      store.addNode('preview', at);
    } else if (action === 'add-save-to-canvas') {
      store.addNode('saveToCanvas', at);
    } else if (action === 'add-save-to-assets') {
      store.addNode('saveToAssets', at);
    } else if (action === 'group-selected') {
      store.createGroupFromSelection();
    } else if (action === 'cut') {
      store.cutSelection();
    } else if (action === 'align-left') {
      store.alignSelectedNodes('left');
    } else if (action === 'align-center') {
      store.alignSelectedNodes('center');
    } else if (action === 'align-right') {
      store.alignSelectedNodes('right');
    } else if (action === 'align-top') {
      store.alignSelectedNodes('top');
    } else if (action === 'align-middle') {
      store.alignSelectedNodes('middle');
    } else if (action === 'align-bottom') {
      store.alignSelectedNodes('bottom');
    } else if (action === 'dist-h') {
      store.distributeSelectedNodes('horizontal');
    } else if (action === 'dist-v') {
      store.distributeSelectedNodes('vertical');
    } else if (action === 'run-node' && contextMenu.nodeId) {
      runGraph('node', contextMenu.nodeId);
    } else if (action === 'run-from-here' && contextMenu.nodeId) {
      runGraph('from-here', contextMenu.nodeId);
    }
    setContextMenu(null);
  };

  const panFromMiniMap = (clientX: number, clientY: number) => {
    const mmRect = minimapRef.current?.getBoundingClientRect();
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!mmRect || !canvasRect) return;
    const x = Math.max(0, Math.min(mmRect.width, clientX - mmRect.left));
    const y = Math.max(0, Math.min(mmRect.height, clientY - mmRect.top));
    const worldX = minimap.minX + (x / mmRect.width) * minimap.width;
    const worldY = minimap.minY + (y / mmRect.height) * minimap.height;
    store.setViewport((prev) => ({
      ...prev,
      x: canvasRect.width * 0.5 - worldX * prev.scale,
      y: canvasRect.height * 0.5 - worldY * prev.scale,
    }));
  };

  const canCreateConnectedNode = (menu: ConnectionMenuState, kind: NodeKind): boolean => {
    const source = store.nodeMap.get(menu.fromNode);
    if (!source) return false;
    const probe: WorkflowNode = { id: '__probe__', kind, x: menu.worldX, y: menu.worldY };
    return NODE_DEFS[kind].inputs.some((port) => canConnectEdge(source, menu.fromPort, probe, port.key));
  };

  const getConnectionMenuOptions = (menu: ConnectionMenuState): ChainNodeOption[] => {
    const options: ChainNodeOption[] = [
      { id: 'image', label: 'Image', badge: 'IMG', kind: 'imageGen' },
      { id: 'video', label: 'Video', badge: 'VID', kind: 'videoGen' },
    ];
    return options.map((option) => (
      option.kind && !canCreateConnectedNode(menu, option.kind)
        ? { ...option, disabled: true, disabledReason: 'Current output cannot connect to this node' }
        : option
    ));
  };
  const openConnectionMenu = (event: React.MouseEvent) => {
    const pending = store.pendingConnection;
    if (!pending) return;
    const world = toWorld(event.clientX, event.clientY);
    store.moveConnection(world);
    updateConnectionMenu({
      x: event.clientX,
      y: event.clientY,
      worldX: world.x,
      worldY: world.y,
      fromNode: pending.fromNode,
      fromPort: pending.fromPort,
    });
  };

  const openConnectionMenuFromPort = (event: React.MouseEvent, node: WorkflowNode, port: NodePort) => {
    event.stopPropagation();
    const outputIndex = NODE_DEFS[node.kind].outputs.findIndex((item) => item.key === port.key);
    const start = outputIndex >= 0 ? getPortPosition(node, outputIndex, true) : { x: node.x + NODE_DEFS[node.kind].width, y: node.y + 48 };
    const world = {
      x: start.x + 280,
      y: start.y - 44,
    };
    store.startConnection(node.id, port.key, world);
    updateConnectionMenu({
      x: event.clientX,
      y: event.clientY,
      worldX: world.x,
      worldY: world.y,
      fromNode: node.id,
      fromPort: port.key,
    });
  };

  const addNodeFromConnectionMenu = (kind: NodeKind) => {
    if (!connectionMenu) return;
    store.addNodeFromConnection(kind, {
      x: connectionMenu.worldX,
      y: connectionMenu.worldY,
    }, {
      fromNode: connectionMenu.fromNode,
      fromPort: connectionMenu.fromPort,
      mouseX: connectionMenu.worldX,
      mouseY: connectionMenu.worldY,
    });
    updateConnectionMenu(null);
  };

  const cancelConnectionMenu = () => {
    updateConnectionMenu(null);
    store.cancelConnection();
  };

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      if (target && connectionMenuRef.current?.contains(target)) return;
      setContextMenu(null);
      updateConnectionMenu(null);
      store.cancelConnection();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
      const key = event.key.toLowerCase();
      const meta = event.metaKey || event.ctrlKey;

      if (event.key === 'Escape') {
        setContextMenu(null);
        updateConnectionMenu(null);
        store.cancelConnection();
        setIsSpacePanning(false);
        return;
      }

      if (meta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (meta && key === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }
      if (isTyping) return;

      if (event.code === 'Space') {
        event.preventDefault();
        setIsSpacePanning(true);
        return;
      }

      if (meta && key === 'c') {
        event.preventDefault();
        store.copySelection();
      } else if (meta && key === 'x') {
        event.preventDefault();
        store.cutSelection();
      } else if (meta && key === 'v') {
        event.preventDefault();
        pasteAtCenter();
      } else if (meta && key === 'a') {
        event.preventDefault();
        store.selectAllNodes();
      } else if (meta && key === 'g') {
        event.preventDefault();
        store.createGroupFromSelection();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !isExecuting) {
        event.preventDefault();
        store.removeSelected();
      } else if (key === 'f') {
        event.preventDefault();
        fitWorkflowView();
      } else if (key === 'm') {
        event.preventDefault();
        setShowMiniMap(value => !value);
      } else if (key === 'l') {
        event.preventDefault();
        store.setGridSnapEnabled(value => !value);
        setRunMessage(`Grid snap ${store.gridSnapEnabled ? 'disabled' : 'enabled'}.`);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setIsSpacePanning(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [isExecuting, store]);

  // Register workflow API on window.__flovartAPI for external CLI/MCP CDP access
  useEffect(() => {
    const api = (window as any).__flovartAPI;
    if (!api) return;
    api.workflow = {
      inspect: () => ({ ok: true, nodes: store.nodes, edges: store.edges, groups: store.groups, viewport: store.viewport, selectedNodeIds: store.selectedNodeIds }),
      load: (input: any) => {
        const wf = (input && typeof input === 'object' && !Array.isArray(input)) ? (input.workflow || input) : {};
        if (!Array.isArray(wf.nodes)) return { ok: false, error: { code: 'BAD_REQUEST', message: 'workflow.nodes is required' } };
        store.loadTemplate({ nodes: wf.nodes, edges: wf.edges || [], groups: wf.groups || [], viewport: wf.viewport });
        return { ok: true, nodeCount: wf.nodes.length };
      },
      updateNode: (nodeId: string, config: any) => { store.updateNodeConfig(nodeId, config || {}, true); return { ok: true, nodeId }; },
      run: (input: any) => { runGraph(input?.scope || 'workflow', input?.nodeId); return { ok: true, accepted: true, scope: input?.scope || 'workflow' }; },
    };
    return () => { try { delete (window as any).__flovartAPI?.workflow; } catch { /* ignore */ } };
  }, []);

  const minimap = useMemo(() => {
    const allXs: number[] = [];
    const allYs: number[] = [];
    const allX2: number[] = [];
    const allY2: number[] = [];
    for (const node of store.nodes) {
      const def = NODE_DEFS[node.kind];
      if (!def) continue;
      allXs.push(node.x);
      allYs.push(node.y);
      allX2.push(node.x + def.width);
      allY2.push(node.y + def.height);
    }
    for (const group of store.groups) {
      allXs.push(group.x);
      allYs.push(group.y);
      allX2.push(group.x + group.width);
      allY2.push(group.y + group.height);
    }
    if (allXs.length === 0) {
      return { minX: 0, minY: 0, width: 1, height: 1, viewRect: { x: 0, y: 0, width: 0, height: 0 } };
    }
    const minX = Math.min(...allXs) - 80;
    const minY = Math.min(...allYs) - 80;
    const maxX = Math.max(...allX2) + 80;
    const maxY = Math.max(...allY2) + 80;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const cw = canvasRect?.width ?? 1;
    const ch = canvasRect?.height ?? 1;
    const worldVisibleW = cw / store.viewport.scale;
    const worldVisibleH = ch / store.viewport.scale;
    const worldVisibleX = -store.viewport.x / store.viewport.scale;
    const worldVisibleY = -store.viewport.y / store.viewport.scale;
    return {
      minX,
      minY,
      width,
      height,
      viewRect: { x: worldVisibleX, y: worldVisibleY, width: worldVisibleW, height: worldVisibleH },
    };
  }, [store.groups, store.nodes, store.viewport.scale, store.viewport.x, store.viewport.y]);

  return (
      <div className="workflow-libtv absolute inset-0 overflow-hidden">
      <input
        ref={importWorkflowInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportWorkflowFile}
      />
      <div className="pointer-events-none absolute inset-0 workflow-libtv-grid" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 workflow-libtv-top-fade" />

      {false && (
      <div className="workflow-topbar pointer-events-none absolute left-4 right-4 top-3 z-50 flex h-12 items-center justify-between gap-4">
        <div className="workflow-title-pill pointer-events-auto flex h-10 min-w-0 items-center gap-2 rounded-lg px-3">
          <input
            value={workflowTitle}
            onChange={(e) => setWorkflowTitle(e.target.value)}
            className="max-w-[170px] bg-transparent text-sm font-semibold text-neutral-900 outline-none"
            title="Workflow name"
            placeholder="Untitled Flow"
          />
        </div>

        <div className="pointer-events-auto flex min-w-0 items-center gap-1.5">
          <div className={joinClasses('workflow-run-status max-w-[220px] truncate rounded-md px-2 py-1 text-[12px]', runError && 'is-error')}>
            {runError || runMessage}
          </div>
          <button
            type="button"
            onClick={() => runGraph('workflow')}
            disabled={!canRunScope('workflow')}
            className="workflow-primary-action h-9 rounded-lg px-4 text-[13px] font-semibold"
            title="Run workflow"
          >
              {isExecuting ? 'Running...' : 'Run'}
          </button>
          <button
            type="button"
            onClick={() => store.undo()}
            disabled={!store.canUndo}
            className="workflow-icon-action h-9 w-9 rounded-lg"
            title="Undo"
            aria-label="Undo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 7 5 11l4 4M5 11h9a5 5 0 0 1 0 10h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => store.redo()}
            disabled={!store.canRedo}
            className="workflow-icon-action h-9 w-9 rounded-lg"
            title="Redo"
            aria-label="Redo"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m15 7 4 4-4 4M19 11h-9a5 5 0 0 0 0 10h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      )}

      <CanvasFloatingPanel className="workflow-tool-rail absolute left-5 top-1/2 z-50 flex -translate-y-1/2 flex-col items-center gap-2 rounded-2xl p-2">
        <CanvasIconButton
          variant="primary"
          className="workflow-rail-primary h-10 w-10 rounded-lg"
          onClick={() => openToolPanel('create', true)}
          title={copy.addNode}
          aria-label={copy.addNode}
          active={isToolPanelOpen && toolPanelTab === 'create'}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </CanvasIconButton>
        <CanvasIconButton
          className="workflow-rail-button h-10 w-10 rounded-lg"
          onClick={() => openToolPanel('nodes', true)}
          title={copy.nodeRecords}
          aria-label={copy.nodeRecords}
          active={isToolPanelOpen && toolPanelTab === 'nodes'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </CanvasIconButton>
        <CanvasIconButton
          className="workflow-rail-button h-10 w-10 rounded-lg"
          onClick={() => openToolPanel('workflows', true)}
          title={copy.openSavedWorkflows}
          aria-label={copy.openSavedWorkflows}
          active={isToolPanelOpen && toolPanelTab === 'workflows'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4.5 7.5h5l1.6 2H19.5v7.8a1.7 1.7 0 0 1-1.7 1.7H6.2a1.7 1.7 0 0 1-1.7-1.7V7.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M7.5 5h4.3l1.6 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </CanvasIconButton>
        <CanvasIconButton
          className="workflow-rail-button h-10 w-10 rounded-lg"
          onClick={() => openToolPanel('assets', true)}
          title={copy.openSharedAssets}
          aria-label={copy.openSharedAssets}
          active={isToolPanelOpen && toolPanelTab === 'assets'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M7 5.5 3.5 12 7 18.5M17 5.5l3.5 6.5L17 18.5M8.5 5.5h7L19 12l-3.5 6.5h-7L5 12l3.5-6.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </CanvasIconButton>
        <CanvasIconButton
          className="workflow-rail-button h-10 w-10 rounded-lg"
          onClick={() => openToolPanel('history', true)}
          title={copy.openHistory}
          aria-label={copy.openHistory}
          active={isToolPanelOpen && toolPanelTab === 'history'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 7v5l3 2M21 12a9 9 0 1 1-2.64-6.36" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </CanvasIconButton>
        <div className="my-1 h-px w-6 shrink-0 bg-current opacity-15" />
        <CanvasIconButton
          className="workflow-rail-button h-10 w-10 rounded-lg"
          onClick={() => store.undo()}
          title="Undo"
          aria-label="Undo"
          disabled={!store.canUndo}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 7 5 11l4 4M5 11h9a5 5 0 0 1 0 10h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </CanvasIconButton>
        <CanvasIconButton
          className="workflow-rail-button h-10 w-10 rounded-lg"
          onClick={() => store.redo()}
          title="Redo"
          aria-label="Redo"
          disabled={!store.canRedo}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m15 7 4 4-4 4M19 11h-9a5 5 0 0 0 0 10h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </CanvasIconButton>
      </CanvasFloatingPanel>

      {isToolPanelOpen && (
        <aside className="canvas-floating-panel workflow-left-panel absolute left-[96px] top-[86px] z-40 flex max-h-[calc(100%-132px)] w-[480px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white/95 text-neutral-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <div className="workflow-panel-title text-sm font-semibold">{getToolPanelTitle(toolPanelTab)}</div>
            </div>
            <button
              type="button"
              className="workflow-panel-close h-8 w-8 rounded-lg"
              onClick={() => setIsToolPanelOpen(false)}
              title="Close panel"
              aria-label="Close panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {toolPanelTab === 'create' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  {NODE_LIBRARY_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => store.addNode(kind, centerWorldPosition())}
                      className="workflow-node-library-card rounded-xl border px-3 py-3 text-left transition"
                      title={`Add ${NODE_DEFS[kind].title}`}
                    >
                      <span className="mb-3 inline-flex h-8 min-w-10 items-center justify-center rounded-lg px-2 text-[10px] font-bold tracking-[0.08em]">
                        {NODE_KIND_BADGES[kind] || 'NOD'}
                      </span>
                      <span className="block text-[13px] font-semibold">{NODE_LIBRARY_LABELS[kind] || NODE_DEFS[kind].title}</span>
                      <span className="mt-1 block text-[11px] opacity-55">{NODE_DEFS[kind].inputs.length} in / {NODE_DEFS[kind].outputs.length} out</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {toolPanelTab === 'nodes' && (
              <div className="workflow-node-record-list space-y-2">
                {workflowMentionItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={joinClasses(
                      'workflow-node-record-item flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left',
                      store.selectedNodeIds.includes(item.id) && 'is-selected',
                    )}
                    onClick={() => {
                      store.selectSingleNode(item.id, false);
                      const node = store.nodeMap.get(item.id);
                      if (node) {
                        store.setViewport((prev) => ({
                          ...prev,
                          x: Math.min(prev.x, 280 - node.x * prev.scale),
                          y: Math.min(prev.y, 220 - node.y * prev.scale),
                        }));
                      }
                    }}
                    aria-label={`Select workflow node ${item.label}`}
                  >
                    <span className="workflow-reference-badge inline-flex h-7 min-w-9 items-center justify-center rounded px-1 text-[10px] font-bold">
                      {item.badge}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] opacity-55">{item.shortId}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {toolPanelTab === 'workflows' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={saveCurrentWorkflow}
                    className="workflow-chip"
                    title="Save current workflow"
                    aria-label="Save current workflow"
                  >
                    Save current
                  </button>
                  <button
                    type="button"
                    onClick={() => applyWorkflowTemplate(STARTER_WORKFLOW_TEMPLATES[0], 'starter flow')}
                    className="workflow-chip"
                    disabled={STARTER_WORKFLOW_TEMPLATES.length === 0}
                  >
                    Starter
                  </button>
                  <button
                    type="button"
                    onClick={() => importWorkflowInputRef.current?.click()}
                    className="workflow-chip"
                    title="Import workflow JSON"
                    aria-label="Import workflow JSON"
                  >
                    Import JSON
                  </button>
                </div>
                {savedWorkflows.length === 0 ? (
                  <div className="workflow-empty-state flex h-32 items-center justify-center rounded-xl border border-dashed text-sm">
                    No saved workflows yet
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {[...savedWorkflows]
                      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt)
                      .map((workflow) => (
                        <div key={workflow.id} className="workflow-template-card rounded-xl border px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-semibold">{workflow.name}</div>
                              <div className="mt-1 text-[11px] opacity-55">
                                {workflow.nodes.length} nodes · {formatPanelTimestamp(workflow.updatedAt)}
                              </div>
                            </div>
                            <button
                              type="button"
                              className={joinClasses('workflow-panel-icon-button', workflow.favorite && 'is-active')}
                              onClick={() => toggleSavedWorkflowFavorite(workflow.id)}
                              aria-label={`${workflow.favorite ? 'Unfavorite' : 'Favorite'} workflow ${workflow.name}`}
                              title={workflow.favorite ? 'Unfavorite workflow' : 'Favorite workflow'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill={workflow.favorite ? 'currentColor' : 'none'} aria-hidden="true">
                                <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9L12 3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              className="workflow-chip"
                              onClick={() => reuseSavedWorkflow(workflow)}
                              aria-label={`Reuse workflow ${workflow.name}`}
                            >
                              Reuse
                            </button>
                            <button
                              type="button"
                              className="workflow-chip"
                              onClick={() => exportSavedWorkflowTemplate(workflow)}
                              aria-label={`Export template ${workflow.name}`}
                            >
                              Export template
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {toolPanelTab === 'assets' && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {ASSET_FILTER_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAssetPanelFilter(option.value)}
                      className={joinClasses('workflow-chip', assetPanelFilter === option.value && 'is-active')}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {filteredSharedAssets.length === 0 ? (
                  <div className="workflow-empty-state flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
                    No shared assets yet
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {filteredSharedAssets.map((item) => (
                      <div key={item.id} className="workflow-asset-card group overflow-hidden rounded-xl border">
                        <div className="relative aspect-[4/3] bg-black/30">
                          <img src={item.href} alt={item.name} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => useSharedAsset(item)}
                            className="workflow-asset-use absolute right-2 top-2 rounded-lg px-2 py-1 text-[11px] opacity-0 transition group-hover:opacity-100"
                            aria-label={`Use asset ${item.name}`}
                          >
                            Use
                          </button>
                        </div>
                        <div className="px-2 py-2">
                          <div className="truncate text-[11px]">{item.name}</div>
                          <div className="text-[10px] opacity-55">{item.width}×{item.height}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {toolPanelTab === 'history' && (
              <div className="space-y-4">
                {generationHistory.length === 0 ? (
                  <div className="workflow-empty-state flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
                    No generation history yet
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {generationHistory.map((item) => (
                      <div key={item.id} className="workflow-asset-card group overflow-hidden rounded-xl border">
                        <div className="relative aspect-[4/3] bg-black/30">
                          <img src={item.dataUrl} alt={item.name || item.prompt || 'Generation history'} className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() => applyHistoryItemToCanvas(item)}
                            className="workflow-asset-use absolute right-2 top-2 rounded-lg px-2 py-1 text-[11px] opacity-0 transition group-hover:opacity-100"
                            aria-label={`Apply history ${item.name || item.prompt || item.id}`}
                          >
                            Apply
                          </button>
                        </div>
                        <div className="px-2 py-2">
                          <div className="truncate text-[11px] font-medium">{item.name || item.prompt || 'History item'}</div>
                          <div className="truncate text-[10px] opacity-55">{item.prompt || formatPanelTimestamp(item.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      )}

      <main
        ref={canvasRef}
        className="workflow-canvas absolute inset-0 z-10 overflow-hidden"
        onContextMenu={(e) => openContextMenu(e, 'canvas')}
        onMouseDownCapture={(e) => {
          if (isWorkflowCanvasControl(e.target)) return;
          if (e.button === 1 || e.shiftKey || isSpacePanning) {
            e.preventDefault();
            store.startPan({ x: e.clientX, y: e.clientY });
            return;
          }
          if (e.button === 0) {
            e.preventDefault();
            const world = toWorld(e.clientX, e.clientY);
            store.startSelection(world);
          }
        }}
        onMouseMove={(e) => {
          const world = toWorld(e.clientX, e.clientY);
          store.moveConnection(world);
          store.moveSelection(world);
          store.moveDrag(world);
          store.panTo({ x: e.clientX, y: e.clientY });
        }}
        onMouseUp={(e) => {
          store.endDrag();
          store.endPan();
          store.endSelection(e.metaKey || e.ctrlKey);
          if (store.pendingConnection) openConnectionMenu(e);
          setIsMiniMapDragging(false);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
          e.preventDefault();
          const world = toWorld(e.clientX, e.clientY);
          void createSourceNodesFromFiles(e.dataTransfer.files, world);
        }}
        onMouseLeave={() => {
          if (connectionMenuOpenRef.current) return;
          store.endDrag();
          store.endPan();
          store.cancelConnection();
          updateConnectionMenu(null);
          setIsMiniMapDragging(false);
        }}
        onWheel={(e) => {
          e.preventDefault();
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          store.zoomAt({ x: e.clientX, y: e.clientY }, rect, e.deltaY);
        }}
      >
        <div
          className="absolute inset-0"
          onMouseDown={(e) => {
            const target = e.target as HTMLElement;
            if (target.dataset.graphbg !== '1') return;
            if (e.button === 1 || e.shiftKey || isSpacePanning) {
              store.startPan({ x: e.clientX, y: e.clientY });
            } else if (e.button === 0) {
              const world = toWorld(e.clientX, e.clientY);
              store.startSelection(world);
            }
          }}
          onDoubleClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.dataset.graphbg !== '1') return;
            e.stopPropagation();
            const world = toWorld(e.clientX, e.clientY);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              worldX: world.x,
              worldY: world.y,
              target: 'canvas',
            });
          }}
          data-graphbg="1"
        />

        {workflowRenderer !== 'dom' && (
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <WorkflowKonvaShell
              width={canvasSize.width}
              height={canvasSize.height}
              nodes={store.nodes}
              edges={store.edges}
              groups={store.groups}
              viewport={store.viewport}
              selectedNodeIds={store.selectedNodeIds}
              activeNodeId={store.activeNodeId}
            />
          </div>
        )}

        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${store.viewport.x}px, ${store.viewport.y}px) scale(${store.viewport.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {store.groups.map((group) => (
            <div
              key={group.id}
              className={`absolute rounded-xl border ${
                store.selectedGroupId === group.id ? 'border-cyan-300/70 bg-cyan-400/8' : 'border-cyan-200/30 bg-cyan-200/5'
              }`}
              style={{ left: group.x, top: group.y, width: group.width, height: group.height }}
              onContextMenu={(e) => openContextMenu(e, 'group', { groupId: group.id })}
            >
              <button
                className="absolute left-2 top-1 rounded px-2 py-0.5 text-[10px] bg-black/35 text-cyan-100"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const world = toWorld(e.clientX, e.clientY);
                  store.startGroupDrag(group.id, world);
                }}
                onClick={() => store.selectGroup(group.id)}
                title={group.title}
              >
                {group.title}
              </button>
            </div>
          ))}

          <svg className="absolute inset-0 h-[3200px] w-[4200px]">
            {edgePaths.map((edge) => (
              <g key={edge.id}>
                <path
                  d={edge.d}
                  stroke="transparent"
                  strokeWidth="18"
                  fill="none"
                  className="cursor-pointer"
                  onDoubleClick={() => store.deleteEdge(edge.id)}
                />
                <path
                  d={edge.d}
                  stroke={edge.stroke}
                  strokeWidth={edge.strokeWidth}
                  fill="none"
                  pointerEvents="none"
                  className={joinClasses('workflow-edge', edge.statusClass)}
                />
              </g>
            ))}
            {pendingPath && (
              <path
                d={pendingPath}
                stroke="rgba(34,197,94,0.95)"
                strokeWidth="2.2"
                fill="none"
                strokeDasharray="6 4"
                className="workflow-pending-edge"
              />
            )}
          </svg>

          {store.nodes.map((node) => {
            const def = NODE_DEFS[node.kind];
            if (!def) return null;
            const selected = store.selectedNodeIds.includes(node.id);
            const active = store.activeNodeId === node.id;
            const runtime = getEffectiveNodeRuntime(node.id, node.config);
            const primaryValue = getPrimaryWorkflowValue(runtime?.outputs);
            const displayMedia = getNodeDisplayMedia(node);
            const runtimeSummary = runtime?.error || runtime?.message || summarizeWorkflowValue(primaryValue);
            const displayTitle = getNodeTitle(node.kind, node.config?.label);
            const runtimeStatus = runtime?.status || 'idle';
            const modelTemplate = node.kind === 'videoGen'
              ? findModelTemplateByModel(node.config?.model || selectedVideoModel, 'video')
              : node.kind === 'imageGen'
                ? findModelTemplateByModel(node.config?.model || selectedImageModel, 'image')
                : node.kind === 'generator'
                  ? findModelTemplateByModel(
                      node.config?.model || (getNodeGenerationMode(node) === 'video' ? selectedVideoModel : selectedImageModel),
                      getNodeGenerationMode(node) === 'video' ? 'video' : 'image',
                    )
                  : null;
            return (
              <div
                key={node.id}
                className={joinClasses(
                  'workflow-node-card absolute rounded-lg border shadow-sm',
                  isMediaNodeKind(node.kind) && 'workflow-node-card-compact',
                  active
                    ? 'border-emerald-500 bg-white is-active'
                    : selected
                    ? 'border-blue-300 bg-white is-selected'
                    : 'border-neutral-200 bg-white',
                  RUN_STATUS_NODE_CLASSES[runtimeStatus],
                )}
                style={{ left: node.x, top: node.y, width: def.width, minHeight: def.height, height: isMediaNodeKind(node.kind) ? def.height : undefined }}
                onContextMenu={(e) => openContextMenu(e, 'node', { nodeId: node.id })}
                onMouseDown={(e) => {
                  if (!isMediaNodeKind(node.kind) || e.button !== 0) return;
                  const target = e.target as HTMLElement;
                  if (target.closest('.workflow-node-action-menu, button, input, textarea, select, video')) return;
                  e.stopPropagation();
                  const world = toWorld(e.clientX, e.clientY);
                  store.startNodeDrag(node.id, world, e.metaKey || e.ctrlKey);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  store.selectSingleNode(node.id, e.metaKey || e.ctrlKey);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  store.selectSingleNode(node.id, false);
                }}
              >
                {selected && renderNodeActionMenu(node)}

                {!isMediaNodeKind(node.kind) && (
                  <div
                    className="workflow-node-header flex cursor-move items-center justify-between rounded-t-lg border-b border-neutral-100 bg-neutral-50 px-2.5 py-1.5 text-[11px]"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const world = toWorld(e.clientX, e.clientY);
                      store.startNodeDrag(node.id, world, e.metaKey || e.ctrlKey);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <span className={joinClasses(
                        'workflow-node-status-dot h-2 w-2 rounded-full',
                        RUN_STATUS_STYLES[runtimeStatus],
                        `is-${runtimeStatus}`,
                      )} />
                      <span className="font-medium text-neutral-800">{displayTitle}</span>
                    </span>
                    <span className="text-[10px] text-neutral-400">drag</span>
                  </div>
                )}

                <div className={joinClasses('relative', isMediaNodeKind(node.kind) ? 'h-full p-1.5' : 'p-2.5')}>
                  {!isMediaNodeKind(node.kind) && renderNodeRuntimeControls(node)}
                  {isMediaNodeKind(node.kind) && renderMediaNodeCardBody(node, displayMedia)}

                  {node.kind === 'prompt' && (
                    <div
                      className={`rounded-lg border ${
                        isPromptDropOver ? 'border-emerald-300 bg-emerald-500/10' : 'border-white/10 bg-black/25'
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsPromptDropOver(true);
                      }}
                      onDragLeave={() => setIsPromptDropOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsPromptDropOver(false);
                        handleDropPayload(e);
                      }}
                    >
                      <textarea
                        value={getNodePromptValue(node)}
                        onChange={(e) => updateNodePrompt(node, e.target.value)}
                        className="h-20 w-full resize-none bg-transparent px-2 py-2 text-[11px] text-neutral-700 outline-none placeholder:text-neutral-400"
                        placeholder="Prompt (drop board images here)"
                        title="Prompt"
                      />
                      {attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-2 pb-2">
                          {attachments.map((att) => (
                            <div key={att.id} className="relative h-10 w-10 overflow-hidden rounded border border-white/20">
                              <img src={att.href} alt={att.name} className="h-full w-full object-cover" />
                              <button
                                onClick={() => onRemoveAttachment(att.id)}
                                className="absolute right-0 top-0 h-4 w-4 bg-black/75 text-[10px]"
                                title="Remove attachment"
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {node.kind === 'loadImage' && (
                    <div className="space-y-2">
                      <div
                        className={`rounded-lg border p-2 ${
                          isImageDropOver ? 'border-emerald-300 bg-emerald-500/10' : 'border-white/10 bg-black/25'
                        }`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsImageDropOver(true);
                        }}
                        onDragLeave={() => setIsImageDropOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsImageDropOver(false);
                          handleDropPayload(e);
                        }}
                      >
                        <div className="flex gap-2">
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="isl-chip text-xs px-3 py-1.5"
                            style={{ boxShadow: '0 2px 0 0 var(--isl-edge)' }}
                          >
                            📤 Upload
                          </button>
                          <button
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setCanvasPickerAnchor({ nodeId: node.id, type: 'image', rect });
                            }}
                            className="isl-chip text-xs px-3 py-1.5"
                            style={{ boxShadow: '0 2px 0 0 var(--isl-edge)' }}
                            disabled={canvasImages.length === 0}
                          >
                            🖼️ From Canvas
                          </button>
                        </div>
                        <div className="mt-2 text-[11px]" style={{ color: 'var(--isl-ink-soft)' }}>
                          Loaded: {attachments.length}
                        </div>
                      </div>
                    </div>
                  )}

                  {node.kind === 'loadVideo' && (() => {
                    const selectedVideo = getCanvasVideoForNode(node.config);
                    if (!selectedVideo) {
                      return (
                        <div className="space-y-2">
                          <div className="isl-well rounded-lg p-3 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
                            Select a video from Canvas or import one first.
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setCanvasPickerAnchor({ nodeId: node.id, type: 'video', rect });
                            }}
                            className="isl-chip text-xs px-3 py-1.5 w-full justify-center"
                            style={{ boxShadow: '0 2px 0 0 var(--isl-edge)' }}
                            disabled={canvasVideos.length === 0}
                          >
                            🎬 Select from Canvas
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className="space-y-2">
                        <div className="isl-row overflow-hidden">
                          <video
                            src={selectedVideo.href}
                            poster={selectedVideo.poster}
                            controls
                            className="max-h-28 w-full rounded object-cover"
                            style={{ background: 'var(--isl-surface-sunk)' }}
                          />
                        </div>
                        <div className="space-y-1 text-[11px]" style={{ color: 'var(--isl-ink-soft)' }}>
                          <div className="font-bold" style={{ color: 'var(--isl-ink)' }}>
                            {selectedVideo.name || 'Canvas video'}
                          </div>
                          <div>
                            {selectedVideo.width || '?'}x{selectedVideo.height || '?'} · {formatVideoDuration(selectedVideo.durationSec)}
                          </div>
                          {(selectedVideo.trimInSec != null || selectedVideo.trimOutSec != null) && (
                            <div>
                              Trim: {selectedVideo.trimInSec ?? 0}s - {selectedVideo.trimOutSec ?? selectedVideo.durationSec ?? '?'}s
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setCanvasPickerAnchor({ nodeId: node.id, type: 'video', rect });
                          }}
                          className="isl-chip text-xs px-3 py-1.5 w-full justify-center"
                          style={{ boxShadow: '0 2px 0 0 var(--isl-edge)' }}
                        >
                          🔄 Change Video
                        </button>
                      </div>
                    );
                  })()}

                  {node.kind === 'enhancer' && (
                    <div className="space-y-2">
                      <label className="text-xs text-white/70">Enhance Mode</label>
                      <select
                        value={enhanceMode}
                        onChange={(e) => setEnhanceMode(e.target.value as PromptEnhanceMode)}
                        className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs"
                        title="Enhance mode"
                      >
                        <option value="smart">Smart</option>
                        <option value="style">Style</option>
                        <option value="precise">Precise</option>
                        <option value="translate">Translate</option>
                      </select>
                      {enhanceMode === 'style' && (
                        <select
                          value={stylePreset}
                          onChange={(e) => setStylePreset(e.target.value)}
                          className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs"
                          title="Style preset"
                        >
                          <option value="cinematic">Cinematic</option>
                          <option value="ink">Ink</option>
                          <option value="ghibli">Ghibli</option>
                          <option value="cyberpunk">Cyberpunk</option>
                          <option value="pixar3d">Pixar 3D</option>
                        </select>
                      )}
                    </div>
                  )}

                  {node.kind === 'generator' && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateNodeGenerationMode(node, 'image')}
                          className={`rounded px-2 py-1 text-xs ${
                            getNodeGenerationMode(node) === 'image' ? 'bg-white text-black' : 'bg-white/10 text-white/80'
                          }`}
                        >
                          Img2Img
                        </button>
                        <button
                          onClick={() => updateNodeGenerationMode(node, 'video')}
                          className={`rounded px-2 py-1 text-xs ${
                            getNodeGenerationMode(node) === 'video' ? 'bg-white text-black' : 'bg-white/10 text-white/80'
                          }`}
                        >
                          Img2Video
                        </button>
                      </div>
                      {getNodeGenerationMode(node) === 'image' && imageModelOptions.length > 0 && (
                        <select
                          value={node.config?.model || ''}
                          onChange={(e) => updateNodeModel(node, e.target.value)}
                          className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs"
                          title="Image model"
                        >
                          <option value="">Default image model</option>
                          {imageModelOptions.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      )}
                      {getNodeGenerationMode(node) === 'video' && videoModelOptions.length > 0 && (
                        <select
                          value={node.config?.model || ''}
                          onChange={(e) => updateNodeModel(node, e.target.value)}
                          className="w-full rounded border border-white/20 bg-white/10 px-2 py-1 text-xs"
                          title="Video model"
                        >
                          <option value="">Default video model</option>
                          {videoModelOptions.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      )}
                      {modelTemplate && (
                        <div className="rounded-lg border border-white/10 bg-black/25 p-2 text-[11px] text-white/70">
                          <div className="font-medium text-white/88">{modelTemplate.displayName}</div>
                          <div className="mt-1 text-white/60">{modelTemplate.description}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {node.kind === 'preview' && <div className="text-xs text-white/70">Output is rendered back to whiteboard canvas.</div>}

                  {node.kind === 'saveToCanvas' && <div className="text-xs text-white/70">Place the upstream image or video directly onto the canvas board.</div>}

                  {node.kind === 'saveToAssets' && <div className="text-xs text-white/70">Save the upstream image into the asset library with the selected category.</div>}

                  {node.kind === 'llm' && (
                    <div className="rounded-lg border border-white/10 bg-black/25 p-2 text-[11px] text-white/70">
                      {node.config?.model || 'Uses selected text model'}
                    </div>
                  )}

                  {node.kind === 'template' && (
                    <div className="rounded-lg border border-white/10 bg-black/25 p-2 text-[11px] text-white/70">
                      {(node.config?.templateText || 'Template text with {{input}} / {{var1}} / {{var2}}').slice(0, 96)}
                    </div>
                  )}

                  {node.kind === 'runningHub' && (
                    <div className="rounded-lg border border-white/10 bg-black/25 p-2 text-[11px] text-white/70">
                      {node.config?.rhEndpoint || 'RunningHub endpoint pending'}
                    </div>
                  )}

                  {!isMediaNodeKind(node.kind) && (node.kind === 'imageGen' || node.kind === 'videoGen') && (
                    <div className="rounded-lg border border-white/10 bg-black/25 p-2 text-[11px] text-white/70">
                      <div className="font-medium text-white/88">
                        {(modelTemplate?.displayName || node.config?.model || (node.kind === 'videoGen' ? selectedVideoModel : selectedImageModel) || 'Model pending').slice(0, 64)}
                      </div>
                      {modelTemplate && (
                        <div className="mt-1 text-white/60">{modelTemplate.description}</div>
                      )}
                    </div>
                  )}

                  {runtime && (
                    <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-2 py-2 text-[10px] text-white/65">
                      <div className="uppercase tracking-[0.16em] text-white/45">{runtime.status}</div>
                      <div className="mt-1 line-clamp-2 break-all">{runtimeSummary}</div>
                    </div>
                  )}

                  {def.inputs.map((port, idx) => {
                    const pendingSource = store.pendingConnection
                      ? store.nodeMap.get(store.pendingConnection.fromNode)
                      : undefined;
                    const canAcceptPending = store.pendingConnection
                      ? canConnectEdge(pendingSource, store.pendingConnection.fromPort, node, port.key)
                      : false;
                    const isPendingTarget = !!store.pendingConnection;
                    return (
                      <button
                        key={`in-${port.key}`}
                        data-port-type="input"
                        data-node-id={node.id}
                        data-port-id={port.key}
                        className={joinClasses(
                          'workflow-port workflow-port-input absolute -left-2 h-4 w-4 rounded-full border transition',
                          isPendingTarget
                            ? canAcceptPending
                              ? 'border-emerald-600 bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]'
                              : 'border-rose-300 bg-rose-100 opacity-65'
                            : 'border-neutral-300 bg-white hover:border-blue-400 hover:bg-blue-50',
                        )}
                        style={{ top: 42 + idx * 22 }}
                        title={`${canAcceptPending || !isPendingTarget ? 'Input' : 'Cannot connect'}: ${port.label}`}
                        onMouseUp={(e) => {
                          if (!store.pendingConnection) return;
                          e.stopPropagation();
                          store.commitConnection(node.id, port.key);
                        }}
                      />
                    );
                  })}
                  {def.outputs.map((port, idx) => {
                    const linking =
                      store.pendingConnection?.fromNode === node.id && store.pendingConnection?.fromPort === port.key;
                    return (
                      <button
                        key={`out-${port.key}`}
                        data-port-type="output"
                        data-node-id={node.id}
                        data-port-id={port.key}
                        className={`workflow-port workflow-port-output absolute -right-2 flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none transition ${
                          linking ? 'border-emerald-600 bg-emerald-500' : 'border-neutral-300 bg-white'
                        } hover:border-blue-400 hover:bg-blue-50`}
                        style={{ top: 42 + idx * 22 }}
                        title={`Drag to connect or add from ${port.label}`}
                        aria-label={`Add from ${displayTitle} ${port.label}`}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const world = toWorld(e.clientX, e.clientY);
                          store.startConnection(node.id, port.key, world);
                        }}
                        onClick={(e) => openConnectionMenuFromPort(e, node, port)}
                      >
                        +
                      </button>
                    );
                  })}

                </div>
              </div>
            );
          })}

          {store.selectionBox && (() => {
            const rect = selectionBoxRect(store.selectionBox);
            return <div className="absolute border border-cyan-300/80 bg-cyan-400/10" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} />;
          })()}

          {selectedNode && renderFloatingComposer(selectedNode)}
        </div>

        {showMiniMap && (
        <div className={joinClasses(
          'workflow-minimap absolute bottom-4 z-40 h-36 w-56 rounded-xl border border-neutral-200 bg-white/95 p-2 shadow-[0_1px_2px_rgba(15,23,42,0.05)]',
          showInspector ? 'right-[356px]' : 'right-4',
        )}>
          <div className="mb-1 text-[10px] text-neutral-500">MiniMap</div>
          <svg
            ref={minimapRef}
            className="h-[124px] w-[208px] cursor-pointer rounded bg-neutral-50"
            onMouseDown={(e) => {
              setIsMiniMapDragging(true);
              panFromMiniMap(e.clientX, e.clientY);
            }}
            onMouseMove={(e) => {
              if (!isMiniMapDragging) return;
              panFromMiniMap(e.clientX, e.clientY);
            }}
            onMouseUp={() => setIsMiniMapDragging(false)}
            onMouseLeave={() => setIsMiniMapDragging(false)}
          >
            {store.groups.map((group) => {
              const x = ((group.x - minimap.minX) / minimap.width) * 208;
              const y = ((group.y - minimap.minY) / minimap.height) * 124;
              const w = (group.width / minimap.width) * 208;
              const h = (group.height / minimap.height) * 124;
              return <rect key={group.id} x={x} y={y} width={w} height={h} fill="rgba(34,211,238,0.09)" stroke="rgba(34,211,238,0.45)" />;
            })}
            {store.nodes.map((node) => {
              const def = NODE_DEFS[node.kind];
              if (!def) return null;
              const wNode = def.width;
              const hNode = def.height;
              const x = ((node.x - minimap.minX) / minimap.width) * 208;
              const y = ((node.y - minimap.minY) / minimap.height) * 124;
              const w = (wNode / minimap.width) * 208;
              const h = (hNode / minimap.height) * 124;
              const runtimeStatus = getEffectiveNodeRuntime(node.id, node.config)?.status || 'idle';
              const selected = store.selectedNodeIds.includes(node.id);
              const active = store.activeNodeId === node.id;
              const fill = active || runtimeStatus === 'running'
                ? 'rgba(251, 191, 36, 0.38)'
                : runtimeStatus === 'error'
                  ? 'rgba(251, 113, 133, 0.28)'
                  : runtimeStatus === 'success'
                    ? 'rgba(110, 231, 183, 0.24)'
                  : runtimeStatus === 'pinned'
                      ? 'rgba(82, 82, 82, 0.18)'
                      : selected
                        ? 'rgba(35, 131, 226, 0.18)'
                        : 'rgba(120, 113, 108, 0.16)';
              const stroke = active || runtimeStatus === 'running'
                ? 'rgba(251, 191, 36, 0.9)'
                : runtimeStatus === 'error'
                  ? 'rgba(251, 113, 133, 0.78)'
                  : runtimeStatus === 'success'
                    ? 'rgba(110, 231, 183, 0.72)'
                    : runtimeStatus === 'pinned'
                      ? 'rgba(82, 82, 82, 0.58)'
                      : selected
                        ? 'rgba(35, 131, 226, 0.72)'
                        : 'rgba(120, 113, 108, 0.34)';
              return (
                <rect
                  key={node.id}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={fill}
                  stroke={stroke}
                  className={joinClasses(
                    'workflow-minimap-node',
                    active ? 'is-active' : '',
                    runtimeStatus === 'running' ? 'is-running' : '',
                  )}
                />
              );
            })}
            <rect
              x={((minimap.viewRect.x - minimap.minX) / minimap.width) * 208}
              y={((minimap.viewRect.y - minimap.minY) / minimap.height) * 124}
              width={(minimap.viewRect.width / minimap.width) * 208}
              height={(minimap.viewRect.height / minimap.height) * 124}
              fill="rgba(35,131,226,0.08)"
              stroke="rgba(35,131,226,0.62)"
            />
          </svg>
        </div>
        )}
      </main>

      {store.selectedNodeIds.length > 1 && (
        <div className="workflow-selection-toolbar absolute left-1/2 top-5 z-50 flex -translate-x-1/2 items-center gap-2 rounded-2xl border px-3 py-2 text-xs">
          <span className="font-medium">Selected nodes: {store.selectedNodeIds.length}</span>
          <button
            type="button"
            className="workflow-selection-action rounded-lg px-2.5 py-1 font-semibold"
            onClick={() => store.createGroupFromSelection()}
            aria-label="Group selected workflow nodes"
          >
            Group
          </button>
        </div>
      )}

      <div className="workflow-bottom-controls absolute bottom-5 left-5 z-50 flex items-center gap-1.5 rounded-2xl p-1.5">
        <button
          type="button"
          className="workflow-bottom-button h-9 w-9 rounded-xl"
          onClick={() => {
            store.autoArrange();
            window.setTimeout(fitWorkflowView, 0);
          }}
          title="Auto arrange canvas"
          aria-label="Auto arrange canvas"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 7h5M5 12h11M5 17h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M18 6v12M15.5 8.5 18 6l2.5 2.5M15.5 15.5 18 18l2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className={joinClasses('workflow-bottom-button h-9 w-9 rounded-xl', store.gridSnapEnabled && 'is-active')}
          onClick={() => store.setGridSnapEnabled((value) => !value)}
          title="Toggle grid snap hint"
          aria-label="Toggle grid snap hint"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 8h16M4 16h16M8 4v16M16 4v16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={joinClasses('workflow-bottom-button h-9 w-9 rounded-xl', showMiniMap && 'is-active')}
          onClick={() => setShowMiniMap((value) => !value)}
          title="Toggle minimap"
          aria-label="Toggle minimap"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 5h4v4H5V5ZM15 5h4v4h-4V5ZM5 15h4v4H5v-4ZM15 15h4v4h-4v-4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="workflow-bottom-button h-9 w-9 rounded-xl"
          onClick={() => zoomWorkflow(0.9)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="workflow-zoom-readout h-9 rounded-xl px-3 text-[13px] font-semibold tabular-nums"
          onClick={fitWorkflowView}
          title="Zoom"
        >
          {Math.round(store.viewport.scale * 100)}%
        </button>
        <button
          type="button"
          className="workflow-bottom-button h-9 w-9 rounded-xl"
          onClick={() => zoomWorkflow(1.12)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {showInspector && (
      <aside className="workflow-inspector-panel absolute right-4 top-[76px] bottom-4 z-40 w-[320px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white/95 p-3 text-neutral-800 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Inspector</div>
        {activeTraceMeta && (
          <div className="mb-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/45">Runtime Trace</div>
            <div className="space-y-1 text-xs text-white/70">
              <div>Session: {activeTraceMeta.sessionId.slice(-8)}</div>
              <div>Job: {activeTraceMeta.jobId.slice(-8)}</div>
              <div>Events: {activeTraceMeta.eventCount}</div>
            </div>
          </div>
        )}
        {!selectedNode && !selectedGroup && <div className="text-xs text-white/50">Select a node or group</div>}
        {!selectedNode && !selectedGroup && recentRunEvents.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/45">Recent Activity</div>
            <div className="space-y-2">
              {recentRunEvents.map((event) => (
                <div key={event.id} className="rounded border border-white/10 bg-black/20 px-2 py-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${RUN_STATUS_STYLES[event.status]}`} />
                      <span>{event.nodeId}</span>
                    </div>
                    <span>{formatPanelTimestamp(event.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/75">{event.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {store.selectedNodeIds.length > 1 && (
          <div className="mb-3 space-y-2 rounded border border-white/10 bg-white/5 p-2 text-xs">
            <div className="text-white/80">Selected nodes: {store.selectedNodeIds.length}</div>
            <div className="flex flex-wrap gap-2">
              <button className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => store.alignSelectedNodes('left')}>Align L</button>
              <button className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => store.alignSelectedNodes('center')}>Align C</button>
              <button className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => store.alignSelectedNodes('top')}>Align T</button>
              <button className="rounded bg-white/10 px-2 py-1 hover:bg-white/20" onClick={() => store.alignSelectedNodes('middle')}>Align M</button>
              <button
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20"
                onClick={() => store.createGroupFromSelection()}
                aria-label="Group selected workflow nodes"
              >
                Group
              </button>
              <button
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20 disabled:opacity-45"
                disabled={store.selectedNodeIds.length < 3}
                onClick={() => store.distributeSelectedNodes('horizontal')}
              >
                Dist H
              </button>
              <button
                className="rounded bg-white/10 px-2 py-1 hover:bg-white/20 disabled:opacity-45"
                disabled={store.selectedNodeIds.length < 3}
                onClick={() => store.distributeSelectedNodes('vertical')}
              >
                Dist V
              </button>
            </div>
          </div>
        )}
        {selectedGroup && (
          <div className="space-y-2 text-xs">
            <div className="text-sm text-cyan-100">{selectedGroup.title}</div>
            <div className="text-white/70">Nodes: {selectedGroup.nodeIds.length}</div>
            <div className="text-white/60">Drag group header to move members together.</div>
          </div>
        )}
        {selectedNode && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-white/90">
              <span className={`h-2.5 w-2.5 rounded-full ${RUN_STATUS_STYLES[selectedNodeRuntime?.status || 'idle']}`} />
              <span>{getNodeTitle(selectedNode.kind, selectedNode.config?.label)}</span>
            </div>
            <div className="text-xs text-white/65">Node ID: {selectedNode.id}</div>
            <div className="text-xs text-white/65">
              Inputs: {NODE_DEFS[selectedNode.kind].inputs.length} / Outputs: {NODE_DEFS[selectedNode.kind].outputs.length}
            </div>

            {renderProviderKeyStatus(selectedNode)}

            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/45">Run Details</div>
              <div className="flex items-center justify-between gap-3 text-xs text-white/75">
                <span>Status: {selectedNodeRuntime?.status || 'idle'}</span>
                <span className="text-white/45">
                  {selectedNodeRuntime ?            formatPanelTimestamp(selectedNodeRuntime.updatedAt) : '--:--:--'}
                </span>
              </div>
              <div className="mt-1 text-xs text-white/60">
                {selectedNodeRuntime?.error || selectedNodeRuntime?.message || 'This node has not executed yet.'}
              </div>
              <div className="mt-3">
                {renderValuePreview(getPrimaryWorkflowValue(selectedNodeRuntime?.outputs))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => pinNodeOutput(selectedNode.id)}
                  disabled={!selectedNodeRuntime?.outputs || isExecuting}
                  className="rounded-md border border-fuchsia-300/35 bg-fuchsia-500/15 px-3 py-1.5 text-xs hover:bg-fuchsia-500/25 disabled:opacity-45"
                >
                  Pin Output
                </button>
                <button
                  onClick={() => unpinNodeOutput(selectedNode.id)}
                  disabled={!selectedNode.config?.pinnedOutputs || isExecuting}
                  className="rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-45"
                >
                  Clear Pin
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Connected Inputs</div>
              {renderPortValueList(
                'input',
                NODE_DEFS[selectedNode.kind].inputs,
                selectedNodeInputs,
                'No connected inputs yet',
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-3">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Outputs</div>
              {renderPortValueList(
                'output',
                NODE_DEFS[selectedNode.kind].outputs,
                selectedNodeRuntime?.outputs,
                'No outputs yet',
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">Recent Events</div>
              {selectedNodeEvents.length === 0 && (
                <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/45">
                  No events yet
                </div>
              )}
              {selectedNodeEvents.map((event) => (
                <div key={event.id} className="rounded border border-white/10 bg-black/20 px-2 py-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-white/60">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${RUN_STATUS_STYLES[event.status]}`} />
                      <span>{event.status}</span>
                    </div>
                    <span>{formatPanelTimestamp(event.timestamp)}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/75">{event.message}</div>
                </div>
              ))}
            </div>

            {getNodeInspectorSections(selectedNode.kind).map((section) => (
              <div key={section.id} className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">{section.title}</div>
                {section.fields.map((field) => renderInspectorField(selectedNode, field))}
              </div>
            ))}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                onClick={() => runGraph('workflow')}
                disabled={!canRunScope('workflow')}
                className="rounded-md border border-neutral-900 bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-700 disabled:opacity-45"
              >
                Run Workflow
              </button>
              <button
                onClick={() => runGraph('node', selectedNode.id)}
                disabled={!canRunScope('node', selectedNode.id)}
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-45"
              >
                Execute Node
              </button>
              <button
                onClick={() => runGraph('from-here', selectedNode.id)}
                disabled={!canRunScope('from-here', selectedNode.id)}
                className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-45"
              >
                Execute From Here
              </button>
            </div>
          </div>
        )}
      </aside>
      )}

      {connectionMenu && (() => {
        const options = getConnectionMenuOptions(connectionMenu);
        return (
          <div
            ref={connectionMenuRef}
            className="workflow-connection-menu fixed z-[130] w-[220px] rounded-xl border p-2"
            style={{ left: connectionMenu.x + 8, top: connectionMenu.y + 8 }}
          >
            <div className="px-2 pb-2 text-[12px] font-semibold opacity-80">
              Create linked node
            </div>
            <div className="grid gap-1">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={joinClasses(
                    'flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[13px]',
                    option.disabled && 'is-disabled',
                  )}
                  title={option.disabledReason || `鍒涘缓${option.label}鑺傜偣`}
                  disabled={option.disabled || !option.kind}
                  onClick={() => option.kind && addNodeFromConnectionMenu(option.kind)}
                >
                  <span className="workflow-chain-option-badge">{option.badge}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {option.label}
                    {option.beta && <span className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[9px] opacity-60">Beta</span>}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mt-1 w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] opacity-60"
              onClick={cancelConnectionMenu}
            >
              Cancel
            </button>
          </div>
        );
      })()}

      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="workflow-context-menu fixed z-[120] min-w-[176px] rounded-lg border p-1"
          style={{ left: contextMenu.x + 4, top: contextMenu.y + 4 }}
        >
          {contextMenu.target === 'canvas' && (
            <>
              {NODE_LIBRARY_KINDS.map((kind) => (
                <button
                  key={kind}
                  className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px]"
                  onClick={() => runContextAction(`add-${kind}`)}
                >
                  + {NODE_LIBRARY_LABELS[kind] || NODE_DEFS[kind].title}
                </button>
              ))}
              <div className="workflow-context-divider my-1 h-px" />
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={!store.canPaste} onClick={() => runContextAction('paste')}>Paste</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={store.selectedNodeIds.length === 0} onClick={() => runContextAction('cut')}>Cut Selection</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={store.selectedNodeIds.length < 2} onClick={() => runContextAction('group-selected')}>Group Selection</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={store.selectedNodeIds.length < 2} onClick={() => runContextAction('align-left')}>Align Left</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={store.selectedNodeIds.length < 2} onClick={() => runContextAction('align-top')}>Align Top</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={store.selectedNodeIds.length < 3} onClick={() => runContextAction('dist-h')}>Distribute Horizontal</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={store.selectedNodeIds.length < 3} onClick={() => runContextAction('dist-v')}>Distribute Vertical</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px]" onClick={() => runContextAction('fit')}>Fit View</button>
            </>
          )}
          {contextMenu.target === 'node' && (
            <>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px]" onClick={() => runContextAction('copy-node')}>Copy Node</button>
              <button
                className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45"
                disabled={!contextMenu.nodeId || !store.nodeMap.get(contextMenu.nodeId) || !getNodeDisplayMedia(store.nodeMap.get(contextMenu.nodeId)!)}
                onClick={() => runContextAction('save-node-assets')}
              >
                Add node to asset library
              </button>
              <div className="workflow-context-divider my-1 h-px" />
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={!canRunScope('node', contextMenu.nodeId!)} onClick={() => runContextAction('run-node')}>Execute Node</button>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px] disabled:opacity-45" disabled={!canRunScope('from-here', contextMenu.nodeId!)} onClick={() => runContextAction('run-from-here')}>Execute From Here</button>
              <div className="workflow-context-divider my-1 h-px" />
              <button className="workflow-context-danger w-full rounded-md px-2.5 py-1.5 text-left text-[11px]" onClick={() => runContextAction('delete-node')}>Delete Node</button>
            </>
          )}
          {contextMenu.target === 'group' && (
            <>
              <button className="w-full rounded-md px-2.5 py-1.5 text-left text-[11px]" onClick={() => runContextAction('copy-group')}>Copy Group</button>
              <button className="workflow-context-warn w-full rounded-md px-2.5 py-1.5 text-left text-[11px]" onClick={() => runContextAction('ungroup')}>Ungroup</button>
            </>
          )}
        </div>
      )}

      <input
        ref={nodeMediaInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        data-testid="workflow-node-media-input"
        title="Upload media to selected node"
        onChange={(e) => {
          if (mediaUploadTargetId && e.target.files && e.target.files.length > 0) {
            void handleNodeMediaFiles(mediaUploadTargetId, e.target.files);
          }
          e.target.value = '';
        }}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        title="Upload image to workflow"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onUploadFiles(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Canvas Element Picker Overlay */}
      {canvasPickerAnchor && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setCanvasPickerAnchor(null)}
          />
          <div
            className="fixed z-50"
            style={{
              left: `${canvasPickerAnchor.rect.left}px`,
              top: `${canvasPickerAnchor.rect.bottom + 8}px`,
            }}
          >
            <CanvasElementPicker
              canvasImages={canvasImages}
              canvasVideos={canvasVideos}
              mode={canvasPickerAnchor.type}
              language={language}
              onSelectImage={(img) => {
                // Handle image selection for loadImage node
                onDropCanvasImage(img);
                setCanvasPickerAnchor(null);
              }}
              onSelectVideo={(vid) => {
                // Handle video selection for loadVideo node
                const targetNode = store.nodeMap.get(canvasPickerAnchor.nodeId);
                if (targetNode) {
                  store.updateNode(canvasPickerAnchor.nodeId, {
                    config: {
                      ...targetNode.config,
                      canvasVideoId: vid.id,
                    },
                  });
                }
                setCanvasPickerAnchor(null);
              }}
            />
          </div>
        </>
      )}
    </div>
  );
};
