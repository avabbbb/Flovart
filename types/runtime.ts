import type {
  AdaptivePromptPayload,
  AssetLibrary,
  AssetSlotRole,
  ElementGenerationState,
  InlineGenerationProvider,
} from './index';
import type { GenerationJobRecord } from '../services/generationJobs';

export type RuntimeEntityKind =
  | 'image'
  | 'video'
  | 'text'
  | 'shape'
  | 'path'
  | 'arrow'
  | 'line'
  | 'group'
  | 'prompt'
  | 'llm'
  | 'enhancer'
  | 'generator'
  | 'imageGen'
  | 'videoGen'
  | 'videoEdit'
  | 'httpRequest'
  | 'condition'
  | 'switch'
  | 'merge'
  | 'template'
  | 'upscale'
  | 'faceRestore'
  | 'bgRemove'
  | 'saveToCanvas'
  | 'saveToAssets'
  | 'preview'
  | 'loadImage'
  | 'loadVideo'
  | 'runningHub';

export interface RuntimeMedia {
  kind: 'image' | 'video';
  href: string;
  mimeType: string;
  width?: number;
  height?: number;
  posterHref?: string;
  durationSec?: number;
  trimInSec?: number;
  trimOutSec?: number;
}

export interface RuntimeEntity {
  id: string;
  kind: RuntimeEntityKind;
  name?: string;
  media?: RuntimeMedia;
  promptPayload?: AdaptivePromptPayload;
  generationState?: ElementGenerationState;
  provider?: InlineGenerationProvider | string;
  modelId?: string;
  apiKeyRef?: string;
  params?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type RuntimeConnectionKind =
  | 'workflow_edge'
  | 'prompt_reference'
  | 'media_slot'
  | 'canvas_relation'
  | 'control_flow';

export type RuntimeConnectionRole =
  | AssetSlotRole
  | 'reference'
  | 'last_frame'
  | 'source_video'
  | 'mask'
  | 'result'
  | 'true'
  | 'false'
  | 'default';

export interface RuntimeConnection {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  kind: RuntimeConnectionKind;
  role?: RuntimeConnectionRole;
  sourcePort?: string;
  targetPort?: string;
  createdBy: 'canvas' | 'workflow' | 'prompt' | 'migration' | 'cli';
  createdAt: number;
}

export interface CanvasViewNode {
  entityId: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  zIndex: number;
  visible: boolean;
  locked?: boolean;
  parentId?: string;
}

export interface CanvasViewState {
  nodes: Record<string, CanvasViewNode>;
  viewport: { x: number; y: number; zoom: number };
  showTechnicalEntities: boolean;
}

export interface WorkflowViewNode {
  entityId: string;
  nodeKind: RuntimeEntityKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  collapsed?: boolean;
}

export interface WorkflowViewGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  entityIds: string[];
}

export interface WorkflowViewState {
  nodes: Record<string, WorkflowViewNode>;
  groups: Record<string, WorkflowViewGroup>;
  viewport: { x: number; y: number; scale: number };
}

export interface RuntimeProjectSettings {
  activeCanvasBoardId?: string;
  activeWorkflowId?: string;
}

export interface UnifiedProjectRuntime {
  version: 1;
  projectId: string;
  entities: Record<string, RuntimeEntity>;
  connections: Record<string, RuntimeConnection>;
  canvasView: CanvasViewState;
  workflowView: WorkflowViewState;
  jobs: Record<string, GenerationJobRecord>;
  assets: AssetLibrary;
  settings: RuntimeProjectSettings;
  updatedAt: number;
}
