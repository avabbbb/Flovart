import type { WorkflowNodeToolName } from '../components/workflow/nodeToolCatalog';
import { WORKFLOW_LAYER_STYLES, type WorkflowLayerStyle } from '../components/workflow/operationRegistry';
import {
  runWorkflowCropOperation,
  runWorkflowImageEditOperation,
  runWorkflowLayerOperation,
  runWorkflowOutpaintOperation,
  runWorkflowRemoveBackgroundOperation,
  runWorkflowRotateOperation,
  runWorkflowSplitGridOperation,
  runWorkflowSplitLayersOperation,
  runWorkflowUpscaleOperation,
  runWorkflowVectorizeOperation,
  type WorkflowImageOperationRuntime,
} from './workflowImageOperations';
import {
  runWorkflowVideoAvSplitOperation,
  runWorkflowVideoExtractFrameOperation,
  runWorkflowVideoMergeOperation,
  runWorkflowVideoTrimOperation,
  type WorkflowVideoOperationRuntime,
} from './workflowVideoOperations';
import {
  runWorkflowAudioPitchOperation,
  runWorkflowAudioSpeedOperation,
  runWorkflowAudioStemSplitOperation,
  runWorkflowAudioTrimOperation,
  type WorkflowAudioOperationRuntime,
} from './workflowAudioOperations';
import type { WorkflowOperationOutcome } from './workflowOperationExecution';

export type { WorkflowNodeToolName } from '../components/workflow/nodeToolCatalog';
export type WorkflowNodeToolOutcome = WorkflowOperationOutcome;
export interface WorkflowNodeToolRuntime extends WorkflowImageOperationRuntime, WorkflowVideoOperationRuntime, WorkflowAudioOperationRuntime {}

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

export async function runWorkflowNodeTool(
  projectId: string,
  nodeId: string,
  tool: WorkflowNodeToolName,
  args: Record<string, unknown>,
  runtime: WorkflowNodeToolRuntime,
): Promise<WorkflowNodeToolOutcome> {
  switch (tool) {
    case 'crop':
      return runWorkflowCropOperation(projectId, nodeId, {
        x: finite(args.x, 0, 0, 1), y: finite(args.y, 0, 0, 1),
        width: finite(args.width, 1, Number.EPSILON, 1), height: finite(args.height, 1, Number.EPSILON, 1),
      }, runtime);
    case 'upscale': {
      const requestedAlgorithm = String(args.algorithm || 'high');
      const algorithm = (['high', 'bilinear', 'nearest'].includes(requestedAlgorithm) ? requestedAlgorithm : 'high') as 'high' | 'bilinear' | 'nearest';
      return runWorkflowUpscaleOperation(projectId, nodeId, {
        targetLongEdge: Math.round(finite(args.targetLongEdge, 2048, 512, 8192)), algorithm,
      }, runtime);
    }
    case 'remove-background':
      return runWorkflowRemoveBackgroundOperation(projectId, nodeId, runtime);
    case 'split-layers':
      return runWorkflowSplitLayersOperation(projectId, nodeId, runtime);
    case 'edit': {
      const mask = args.maskNodeId
        ? { nodeId: String(args.maskNodeId) }
        : args.maskHref
          ? { href: String(args.maskHref), mimeType: String(args.maskMimeType || 'image/png') }
          : undefined;
      return runWorkflowImageEditOperation(projectId, nodeId, String(args.prompt || ''), mask ? 'mask' : 'edit', mask, runtime);
    }
    case 'mask': {
      const mask = args.maskNodeId
        ? { nodeId: String(args.maskNodeId) }
        : args.maskHref
          ? { href: String(args.maskHref), mimeType: String(args.maskMimeType || 'image/png') }
          : undefined;
      if (!mask) throw new Error('mask 需要 maskNodeId 或 maskHref');
      return runWorkflowImageEditOperation(projectId, nodeId, String(args.prompt || ''), 'mask', mask, runtime);
    }
    case 'outpaint': {
      const requested = String(args.direction || 'right');
      const direction = (['left', 'right', 'top', 'bottom', 'all'].includes(requested) ? requested : 'right') as 'left' | 'right' | 'top' | 'bottom' | 'all';
      return runWorkflowOutpaintOperation(projectId, nodeId, {
        direction,
        amount: finite(args.amount, 0.5, 0.05, 2),
        prompt: String(args.prompt || ''),
      }, runtime);
    }
    case 'rotate': {
      const requested = String(args.action || args.rotation || 'rotate-90');
      const action = (['rotate-90', 'rotate-180', 'rotate-270', 'flip-h', 'flip-v'].includes(requested) ? requested : 'rotate-90') as 'rotate-90' | 'rotate-180' | 'rotate-270' | 'flip-h' | 'flip-v';
      return runWorkflowRotateOperation(projectId, nodeId, action, runtime);
    }
    case 'vectorize': {
      const preset = String(args.preset || 'detailed');
      return runWorkflowVectorizeOperation(projectId, nodeId, (['detailed', 'poster', 'line'].includes(preset) ? preset : 'detailed') as 'detailed' | 'poster' | 'line', runtime);
    }
    case 'split-grid':
      return runWorkflowSplitGridOperation(projectId, nodeId, {
        rows: Math.round(finite(args.rows, 2, 1, 6)), cols: Math.round(finite(args.cols, 2, 1, 6)),
      }, runtime);
    case 'layer': {
      const mask = args.maskNodeId
        ? { nodeId: String(args.maskNodeId) }
        : args.maskHref
          ? { href: String(args.maskHref), mimeType: String(args.maskMimeType || 'image/png') }
          : undefined;
      const requestedStyle = String(args.style || 'doodle');
      const style = ((WORKFLOW_LAYER_STYLES as readonly string[]).includes(requestedStyle) ? requestedStyle : 'doodle') as WorkflowLayerStyle;
      return runWorkflowLayerOperation(projectId, nodeId, {
        prompt: String(args.prompt || ''), style, count: Math.round(finite(args.count, 4, 1, 4)), mask,
      }, runtime);
    }
    case 'video-trim':
      return runWorkflowVideoTrimOperation(projectId, nodeId, {
        startSec: finite(args.startSec, 0, 0, Number.MAX_SAFE_INTEGER), endSec: finite(args.endSec, 0, 0, Number.MAX_SAFE_INTEGER),
      }, runtime);
    case 'video-av-split': {
      const audio = String(args.audio || 'full');
      return runWorkflowVideoAvSplitOperation(projectId, nodeId, runtime, (['full', 'vocals', 'background'].includes(audio) ? audio : 'full') as 'full' | 'vocals' | 'background');
    }
    case 'video-merge':
      return runWorkflowVideoMergeOperation(projectId, Array.isArray(args.sourceNodeIds) ? args.sourceNodeIds.map(String) : [], runtime);
    case 'video-extract-frame':
      return runWorkflowVideoExtractFrameOperation(
        projectId,
        nodeId,
        (['first', 'current', 'last'].includes(String(args.position)) ? String(args.position) : 'first') as 'first' | 'current' | 'last',
        runtime,
        finite(args.currentTimeSec, 0, 0, Number.MAX_SAFE_INTEGER),
      );
    case 'audio-trim':
      return runWorkflowAudioTrimOperation(projectId, nodeId, {
        startSec: finite(args.startSec, 0, 0, Number.MAX_SAFE_INTEGER), endSec: finite(args.endSec, 0, 0, Number.MAX_SAFE_INTEGER),
      }, runtime);
    case 'audio-speed':
      return runWorkflowAudioSpeedOperation(projectId, nodeId, finite(args.speed, 1, .25, 4), runtime);
    case 'audio-pitch':
      return runWorkflowAudioPitchOperation(projectId, nodeId, finite(args.semitones, 1, -12, 12), runtime);
    case 'audio-stem-split':
      return runWorkflowAudioStemSplitOperation(projectId, nodeId, runtime);
  }
}
