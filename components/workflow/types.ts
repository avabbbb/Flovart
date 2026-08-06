import type { ImageFilters, ProductModelMode } from '../../types';

export type WorkflowNodeType = 'image' | 'text' | 'video' | 'audio' | 'config' | 'script' | 'operation';
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
  imagePromptOverride?: string;
  videoPromptOverride?: string;
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

export type WorkflowOperationCapabilityId =
  | 'image.generate@1'
  | 'image.crop@1'
  | 'image.upscale@1'
  | 'video.trim@1'
  | 'video.av-split@1'
  | 'video.merge@1'
  | 'video.extract-frame@1';
export type WorkflowOperationMediaType = 'image' | 'video' | 'audio';
export type WorkflowOperationInputRole = 'source_image' | 'reference_image' | 'source_video' | 'prompt_context';
export type WorkflowOperationOutputRole = 'result_image' | 'result_video' | 'result_audio';
export type WorkflowOperationTakeStatus = 'running' | 'success' | 'error' | 'canceled' | 'outdated_recipe';

export interface WorkflowOperationInputBinding {
  id: string;
  sourceNodeId: string;
  role: WorkflowOperationInputRole;
  order: number;
  objectVersion: number;
}

export interface WorkflowOperationPromptDocument {
  text: string;
  richTextDocument?: WorkflowRichPromptDocument;
}

export interface WorkflowOperationRecipe {
  capabilityId: WorkflowOperationCapabilityId;
  version: 1;
  promptDocument: WorkflowOperationPromptDocument;
  parameters: Record<string, unknown>;
  productModelId?: string;
  inputBindings: WorkflowOperationInputBinding[];
  /** 当前已计算的语义 Hash；编辑后置空，执行/授权前必须重新冻结。 */
  recipeHash: string | null;
  objectVersion: number;
  updatedAt: string;
}

export interface WorkflowExecutionPromptSnapshot {
  id: string;
  createdAt: string;
  compilerVersion: 'workflow-operation@1';
  renderedPrompt: string;
  richTextDocument?: WorkflowRichPromptDocument;
  parameters: Record<string, unknown>;
  productModelId?: string;
  inputBindings: WorkflowOperationInputBinding[];
  recipeHash: string;
  routeId?: string;
}

export interface WorkflowOperationTake {
  id: string;
  status: WorkflowOperationTakeStatus;
  recipeHash: string;
  createdAt: string;
  completedAt?: string;
  snapshot: WorkflowExecutionPromptSnapshot;
  outputNodeIds: string[];
  providerTaskId?: string;
  usageRecordId?: string;
  error?: string;
}

export interface WorkflowOperationRecord {
  capabilityId: WorkflowOperationCapabilityId;
  recipe: WorkflowOperationRecipe;
  takes: WorkflowOperationTake[];
  selectedTakeId?: string;
}

export interface WorkflowProviderConfig {
  providerId?: string;
  modelId?: string;
}

export interface WorkflowArtifactRef {
  taskId: string;
  kind: Extract<WorkflowNodeType, 'image' | 'video' | 'audio'>;
  mimeType?: string;
  sha256?: string;
  byteSize?: number;
  durationSec?: number;
}

export interface CameraParams {
  camera?: string;
  lens?: string;
  focalLength?: string;
  aperture?: string;
}

export interface WorkflowGenerationConfig extends WorkflowProviderConfig {
  mode: WorkflowGenerationMode;
  operationParameters?: Record<string, unknown>;
  submode?: ProductModelMode;
  aspectRatio?: string;
  /** 图生图 / 图生视频时，是否忽略用户在 PromptBar 中选择的比例，改用第一张参考图的原始宽高比。 */
  preserveReferenceAspectRatio?: boolean;
  resolution?: string;
  durationSec?: number;
  quality?: string;
  count?: number;
  generateAudio?: boolean;
  watermark?: boolean;
  enhancePrompt?: boolean;
  webSearch?: boolean;
  realPersonCheck?: boolean;
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
  /** 参考图 chip 面板顺序：上游 image/video/audio 节点 id 数组，拖拽排序只改这里 */
  imageReferenceOrder?: string[];
  /** 节点来源类型。'assetLibrary' = 来源于素材库 @ 菜单创建的引用节点实例 */
  sourceType?: 'assetLibrary';
  /** 当 sourceType='assetLibrary' 时，对应 AssetItem.id，用于按 storageKey 反查 dataUrl */
  assetId?: string;
  href?: string;
  artifactRef?: WorkflowArtifactRef;
  poster?: string;
  /** 本地视频首帧 JPEG 的独立持久化键；不得内嵌为项目 JSON 的 base64。 */
  posterStorageKey?: string;
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
  uploading?: boolean;
  uploadBytes?: number;
  config?: WorkflowGenerationConfig;
  generationRequestId?: string;
  generationHistoryId?: string;
  generationStartedAt?: number;
  generationProviderTaskId?: string;
  generationUsageRecordId?: string;
  generationEstimatedCost?: number;
  generationActualCost?: number;
  generationCurrency?: 'USD' | 'CNY';
  generationActualTokens?: number;
  generationBillableState?: 'estimated' | 'actual' | 'unknown' | 'not_billable' | 'refunded';
  generationMessage?: string;
  filters?: Partial<ImageFilters>;
  scriptBreakdown?: ScriptBreakdown;
  primaryImageId?: string;
  /** 显式 Workflow Operation 的唯一可编辑配方与不可变执行记录。 */
  operation?: WorkflowOperationRecord;
  /** 媒体结果反向定位其来源 Operation 与 Take。 */
  sourceOperationNodeId?: string;
  operationTakeId?: string;
  operationOutputRole?: WorkflowOperationOutputRole;
  productionProjection?: {
    projectionId: string;
    projectionVersion: number;
    productionSessionId: string;
    specRevisionId: string;
    productionRunId: string;
    stageRunId?: string | null;
    stageKey?: string | null;
    capabilityId?: string | null;
  };
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
  objectVersion?: number;
  batchId?: string;
  batchIndex?: number;
  batchGroupSource?: WorkflowBatchGroupSource;
  metadata: WorkflowNodeMetadata;
}

export interface WorkflowConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind?: 'data' | 'operation-input' | 'operation-output';
  role?: WorkflowOperationInputRole | WorkflowOperationOutputRole;
  order?: number;
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

/** 一条由 Agent/CLI/MCP 驱动的可撤销 Workflow Draft Action 记录（AI 原生画布过程可追溯）。 */
export interface WorkflowDraftLogEntry {
  id: string;
  at: string;
  source: 'agent' | 'mcp' | 'cli' | 'ui';
  command: string;
  /** 人类可读的中文动作摘要（如「创建图片节点「关键帧·hook-wide」」）。 */
  summary: string;
  ok: boolean;
  message?: string;
  nodeIds?: string[];
  connectionIds?: string[];
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
  /** AI/CLI/MCP 驱动的草稿动作记录；设计师据此回溯并二次编辑。 */
  draftLog?: WorkflowDraftLogEntry[];
  draftVersion?: number;
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
  | { type: 'execute_group'; nodeIds: string[] }
  | { type: 'set_batch_primary'; batchId: string; nodeId: string };

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
