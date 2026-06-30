import type { ImageFilters } from '../../types';

export type WorkflowNodeType = 'image' | 'text' | 'video' | 'audio' | 'config' | 'script';
export type WorkflowNodeStatus = 'idle' | 'loading' | 'success' | 'error';
export type WorkflowGenerationMode = 'text' | 'image' | 'video' | 'audio';
export type WorkflowBackgroundMode = 'dots' | 'lines' | 'none';
export type WorkflowBatchGroupSource = 'auto' | 'manual';

export interface ScriptAsset {
  id: string;
  kind: 'character' | 'scene' | 'prop';
  name: string;
  description?: string;
  settingImageNodeId?: string;
}

export interface ScriptShot {
  id: string;
  index: number;
  emotion?: string;
  action?: string;
  dialogue?: string;
  sfx?: string;
  scene?: string;
  promptOverride?: string;
  colorTag?: string;
  imageNodeId?: string;
  videoNodeId?: string;
  status?: WorkflowNodeStatus;
}

export interface ScriptBreakdown {
  assets: ScriptAsset[];
  shots: ScriptShot[];
  sourceText?: string;
  referenceVideoNodeId?: string;
  modelId?: string;
}

export interface WorkflowPoint {
  x: number;
  y: number;
}

export interface WorkflowViewport {
  x: number;
  y: number;
  k: number;
}

export interface WorkflowRichPromptDocument extends Record<string, unknown> {
  type: string;
}

export interface WorkflowProviderConfig {
  providerId?: string;
  modelId?: string;
}

export interface CameraParams {
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
}

export interface WorkflowGenerationConfig extends WorkflowProviderConfig {
  mode: WorkflowGenerationMode;
  aspectRatio?: string;
  resolution?: string;
  durationSec?: number;
  quality?: string;
  count?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  audioVoice?: string;
  audioFormat?: string;
  audioSpeed?: string;
  audioInstructions?: string;
  camera?: CameraParams;
  styleId?: string;
  cameraMovement?: string;
  customMovement?: string;
  seedanceRefs?: SeedanceReferences;
}

export interface SeedanceReferences {
  imageRefs: string[];
  videoRefs: string[];
  audioRefs: string[];
}

export interface WorkflowNodeMetadata {
  content?: string;
  prompt?: string;
  richTextDocument?: WorkflowRichPromptDocument;
  mentionedNodeIds?: string[];
  referenceNodeIds?: string[];
  href?: string;
  poster?: string;
  storageKey?: string;
  name?: string;
  mimeType?: string;
  bytes?: number;
  naturalWidth?: number;
  naturalHeight?: number;
  durationMs?: number;
  status?: WorkflowNodeStatus;
  error?: string;
  progress?: number;
  config?: WorkflowGenerationConfig;
  generationRequestId?: string;
  generationHistoryId?: string;
  filters?: Partial<ImageFilters>;
  scriptBreakdown?: ScriptBreakdown;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  title: string;
  position: WorkflowPoint;
  width: number;
  height: number;
  freeResize?: boolean;
  isVisible?: boolean;
  isLocked?: boolean;
  batchId?: string;
  batchIndex?: number;
  batchGroupSource?: WorkflowBatchGroupSource;
  metadata: WorkflowNodeMetadata;
}

export interface WorkflowConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
}

export interface WorkflowAgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  text: string;
  title?: string;
  detail?: unknown;
  status?: 'pending' | 'success' | 'error' | 'denied';
  createdAt: string;
}

export interface WorkflowAgentSession {
  id: string;
  title: string;
  messages: WorkflowAgentMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowProject {
  id: string;
  title: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  selectedNodeIds: string[];
  viewport: WorkflowViewport;
  backgroundMode: WorkflowBackgroundMode;
  agentSessions: WorkflowAgentSession[];
  activeAgentSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowSnapshot {
  projectId: string;
  title: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
  selectedNodeIds: string[];
  viewport: WorkflowViewport;
}

export type WorkflowOp =
  | { type: 'add_node'; node: WorkflowNode }
  | { type: 'create_connected_node'; fromNodeId: string; node: WorkflowNode }
  | { type: 'update_node'; id: string; patch?: Partial<Omit<WorkflowNode, 'id'>>; metadata?: WorkflowNodeMetadata }
  | { type: 'delete_nodes'; ids: string[] }
  | { type: 'delete_connections'; ids?: string[]; all?: boolean }
  | { type: 'connect_nodes'; id?: string; fromNodeId: string; toNodeId: string }
  | { type: 'select_nodes'; ids: string[] }
  | { type: 'set_viewport'; viewport: WorkflowViewport }
  | { type: 'run_generation'; nodeId: string }
  | { type: 'group_nodes'; ids: string[]; batchId: string; source?: WorkflowBatchGroupSource }
  | { type: 'ungroup_nodes'; ids: string[] }
  | { type: 'execute_group'; nodeIds: string[] };

export interface StylePreset {
  id: string;
  name: string;
  category: string;
  promptPrefix: string;
  previewUrl?: string;
  isCustom?: boolean;
}

export interface CameraMovement {
  id: string;
  name: string;
  description: string;
  promptKeyword: string;
  isCustom?: boolean;
}

export interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: string;
  category: 'storyboard' | 'character' | 'camera' | 'enhance';
  mode: 'image' | 'video';
  minSources: number;
  maxSources: number;
  generateCount: number;
  gridCols: number;
  promptBuilder: (index: number, total: number) => string;
}
