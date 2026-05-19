import type { AssetCategory } from '../../types';

export type WorkflowStage = 'idle' | 'input' | 'agent' | 'generate' | 'output' | 'error';

export type WorkflowRunStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'skipped' | 'pinned';

export type WorkflowValueKind = 'text' | 'image' | 'video' | 'json' | 'empty';

export interface WorkflowTextValue {
  kind: 'text';
  text: string;
}

export interface WorkflowImageValue {
  kind: 'image';
  href: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface WorkflowVideoValue {
  kind: 'video';
  href: string;
  mimeType: string;
  width?: number;
  height?: number;
  posterHref?: string;
  durationSec?: number;
  trimInSec?: number;
  trimOutSec?: number;
  sourceVideoId?: string;
}

export interface WorkflowJsonValue {
  kind: 'json';
  value: unknown;
}

export interface WorkflowEmptyValue {
  kind: 'empty';
}

export type WorkflowValue =
  | WorkflowTextValue
  | WorkflowImageValue
  | WorkflowVideoValue
  | WorkflowJsonValue
  | WorkflowEmptyValue;

export type PortValue = WorkflowValue | null;

export interface NodeIOMap {
  [portKey: string]: PortValue;
}

export interface WorkflowNodeRunState {
  status: WorkflowRunStatus;
  outputs?: NodeIOMap;
  error?: string;
  message?: string;
  updatedAt: number;
}

export const EMPTY_WORKFLOW_VALUE: WorkflowEmptyValue = { kind: 'empty' };

export function isWorkflowValueEmpty(value: PortValue | undefined): boolean {
  if (!value || value.kind === 'empty') return true;
  if (value.kind === 'text') return value.text.trim().length === 0;
  if (value.kind === 'json') {
    if (value.value == null) return true;
    if (Array.isArray(value.value)) return value.value.length === 0;
    if (typeof value.value === 'object') return Object.keys(value.value as Record<string, unknown>).length === 0;
  }
  return false;
}

export function getWorkflowTextContent(value: PortValue | undefined): string {
  if (!value || value.kind === 'empty') return '';
  if (value.kind === 'text') return value.text;
  if (value.kind === 'image' || value.kind === 'video') return value.href;
  if (typeof value.value === 'string') return value.value;
  try {
    return JSON.stringify(value.value, null, 2);
  } catch {
    return String(value.value ?? '');
  }
}

export function getWorkflowImageValue(value: PortValue | undefined): WorkflowImageValue | null {
  return value?.kind === 'image' ? value : null;
}

export function getWorkflowVideoValue(value: PortValue | undefined): WorkflowVideoValue | null {
  return value?.kind === 'video' ? value : null;
}

export function getPrimaryWorkflowValue(outputs: NodeIOMap | undefined | null): PortValue {
  if (!outputs) return null;
  const preferredKeys = ['result', 'image', 'video', 'text', 'output', 'input'];
  for (const key of preferredKeys) {
    const value = outputs[key];
    if (!isWorkflowValueEmpty(value)) return value ?? null;
  }
  for (const value of Object.values(outputs)) {
    if (!isWorkflowValueEmpty(value)) return value ?? null;
  }
  return null;
}

export function summarizeWorkflowValue(value: PortValue | undefined): string {
  if (isWorkflowValueEmpty(value)) return 'No output yet';
  if (!value) return 'No output yet';
  if (value.kind === 'text') return value.text.trim() || 'Empty text';
  if (value.kind === 'image') {
    return value.width && value.height
      ? `Image - ${value.width}x${value.height}`
      : `Image - ${value.mimeType}`;
  }
  if (value.kind === 'video') {
    return value.width && value.height
      ? `Video - ${value.width}x${value.height}`
      : `Video - ${value.mimeType}`;
  }
  if (value.kind === 'empty') return 'No output yet';
  if (value.kind !== 'json') return 'Unknown';
  if (Array.isArray(value.value)) return `JSON array - ${value.value.length} items`;
  if (value.value && typeof value.value === 'object') {
    return `JSON object - ${Object.keys(value.value as Record<string, unknown>).length} keys`;
  }
  return `JSON - ${String(value.value ?? '')}`;
}

export type NodeKind =
  | 'prompt'
  | 'loadImage'
  | 'loadVideo'
  | 'enhancer'
  | 'generator'
  | 'preview'
  | 'llm'
  | 'imageGen'
  | 'videoGen'
  | 'videoEdit'
  | 'runningHub'
  | 'httpRequest'
  | 'condition'
  | 'switch'
  | 'merge'
  | 'template'
  | 'upscale'
  | 'faceRestore'
  | 'bgRemove'
  | 'saveToCanvas'
  | 'saveToAssets';

export type PortType = 'text' | 'image' | 'result' | 'video' | 'any';

export type XYPosition = { x: number; y: number };

export interface NodePort {
  key: string;
  type: PortType;
  label: string;
}

export interface NodeDefinition {
  title: string;
  width: number;
  height: number;
  inputs: NodePort[];
  outputs: NodePort[];
}

export interface WorkflowNode {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  config?: NodeConfig;
}

export interface NodeConfig {
  pinnedOutputs?: NodeIOMap;
  prompt?: string;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  apiKeyRef?: string;
  generationMode?: 'image' | 'video';
  aspectRatio?: string;
  resolution?: string;
  durationSec?: number;
  fps?: number;
  outputCount?: number;
  cameraPreset?: string;
  rhEndpoint?: string;
  rhResolution?: '1k' | '2k' | '4k';
  rhAspectRatio?: string;
  httpUrl?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  httpHeaders?: string;
  httpBodyTemplate?: string;
  httpResultPath?: string;
  templateText?: string;
  videoSourceId?: string;
  videoEditMode?: 'trim' | 'replacePoster';
  trimInSec?: number;
  trimOutSec?: number;
  conditionExpr?: string;
  conditionRules?: { field: string; operator: string; value: string; logicGroup?: 'and' | 'or' }[];
  cases?: { label: string; rules: { field: string; operator: string; value: string; logicGroup?: 'and' | 'or' }[] }[];
  scale?: number;
  workflowId?: string;
  fidelity?: number;
  retryCount?: number;
  timeoutMs?: number;
  label?: string;
  assetCategory?: AssetCategory;
  assetName?: string;
  temperature?: number;
  maxTokens?: number;
  nodeConfigs?: Record<string, string>;
  mediaKind?: 'image' | 'video';
  mediaHref?: string;
  mediaMimeType?: string;
  mediaName?: string;
  mediaWidth?: number;
  mediaHeight?: number;
  mediaPosterHref?: string;
  mediaDurationSec?: number;
  mediaTrimInSec?: number;
  mediaTrimOutSec?: number;
}

export interface WorkflowEdge {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface WorkflowGroup {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodeIds: string[];
}

export interface WorkflowViewport {
  x: number;
  y: number;
  scale: number;
}

export interface PendingConnection {
  fromNode: string;
  fromPort: string;
  mouseX: number;
  mouseY: number;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}
