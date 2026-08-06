import { parseWorkflowOperationParameters } from '../components/workflow/operationRegistry';
import { extractVideoFrame, type VideoFramePosition } from './videoFrameExtractor';
import { mergeVideos, splitAudioVideo, trimVideo } from './videoTools';
import {
  commitWorkflowOperation,
  failWorkflowOperation,
  loadWorkflowOperationSourceBlob,
  requireWorkflowOperation,
  restartWorkflowOperation,
  startWorkflowOperation,
  type StartedWorkflowOperation,
  type WorkflowOperationOutcome,
  type WorkflowOperationRuntime,
} from './workflowOperationExecution';

export interface WorkflowVideoOperationRuntime extends WorkflowOperationRuntime {
  executeVideoTrim?: typeof trimVideo;
  executeVideoAvSplit?: typeof splitAudioVideo;
  executeVideoMerge?: typeof mergeVideos;
  executeVideoFrame?: typeof extractVideoFrame;
}

export async function runWorkflowVideoTrimOperation(
  projectId: string,
  sourceNodeId: string,
  parameters: { startSec: number; endSec: number },
  runtime: WorkflowVideoOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'video.trim@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_video' }],
    parameters,
  });
  return executeVideoTrim(projectId, started, parameters, runtime);
}

async function executeVideoTrim(
  projectId: string,
  started: StartedWorkflowOperation,
  parameters: { startSec: number; endSec: number },
  runtime: WorkflowVideoOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const result = await (runtime.executeVideoTrim || trimVideo)(blob, parameters.startSec, parameters.endSec, source.metadata.name || 'video.mp4');
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: result.blob,
      title: `剪辑 ${result.durationSec.toFixed(1)}s`,
      fileName: `trim-${source.metadata.name || 'video.mp4'}`,
      mimeType: result.blob.type || source.metadata.mimeType || 'video/mp4',
      role: 'result_video',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowVideoAvSplitOperation(
  projectId: string,
  sourceNodeId: string,
  runtime: WorkflowVideoOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'video.av-split@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_video' }],
    parameters: {},
  });
  return executeVideoAvSplit(projectId, started, runtime);
}

async function executeVideoAvSplit(
  projectId: string,
  started: StartedWorkflowOperation,
  runtime: WorkflowVideoOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const result = await (runtime.executeVideoAvSplit || splitAudioVideo)(blob, source.metadata.name || 'video.mp4');
    const baseName = (source.metadata.name || 'video').replace(/\.[^.]+$/, '');
    return await commitWorkflowOperation(runtime, projectId, started, [
      { blob: result.videoBlob, title: '纯视频', fileName: `video-only-${source.metadata.name || 'video.mp4'}`, mimeType: result.videoBlob.type || 'video/mp4', role: 'result_video' },
      { blob: result.audioBlob, title: '纯音频', fileName: `audio-${baseName}.mp3`, mimeType: result.audioBlob.type || 'audio/mpeg', role: 'result_audio' },
    ]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowVideoMergeOperation(
  projectId: string,
  sourceNodeIds: string[],
  runtime: WorkflowVideoOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'video.merge@1',
    sources: sourceNodeIds.map(nodeId => ({ nodeId, role: 'source_video' as const })),
    parameters: {},
    anchorNodeId: sourceNodeIds.at(-1),
  });
  return executeVideoMerge(projectId, started, runtime);
}

async function executeVideoMerge(
  projectId: string,
  started: StartedWorkflowOperation,
  runtime: WorkflowVideoOperationRuntime,
) {
  try {
    const blobs = await Promise.all(started.sourceNodes.map(source => loadWorkflowOperationSourceBlob(source, runtime)));
    const merged = await (runtime.executeVideoMerge || mergeVideos)(blobs, started.sourceNodes.map(source => source.metadata.name || 'video.mp4'));
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: merged, title: '视频拼接', fileName: 'merged.mp4', mimeType: merged.type || 'video/mp4', role: 'result_video',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowVideoExtractFrameOperation(
  projectId: string,
  sourceNodeId: string,
  position: VideoFramePosition,
  runtime: WorkflowVideoOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'video.extract-frame@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_video' }],
    parameters: { position },
  });
  return executeVideoExtractFrame(projectId, started, position, runtime);
}

async function executeVideoExtractFrame(
  projectId: string,
  started: StartedWorkflowOperation,
  position: VideoFramePosition,
  runtime: WorkflowVideoOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const frame = await (runtime.executeVideoFrame || extractVideoFrame)(blob, position);
    const baseName = (source.metadata.name || 'video').replace(/\.[^.]+$/, '');
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: frame.blob,
      title: position === 'first' ? '首帧' : '尾帧',
      fileName: `${position === 'first' ? 'first-frame' : 'last-frame'}-${baseName}.png`,
      mimeType: frame.blob.type || 'image/png',
      role: 'result_image',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function rerunWorkflowVideoOperation(
  projectId: string,
  operationNodeId: string,
  runtime: WorkflowVideoOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const { operation } = requireWorkflowOperation(runtime, projectId, operationNodeId);
  const record = operation.metadata.operation!;
  if (record.capabilityId === 'video.trim@1') {
    const parameters = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { startSec: number; endSec: number };
    return executeVideoTrim(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), parameters, runtime);
  }
  if (record.capabilityId === 'video.av-split@1') {
    return executeVideoAvSplit(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), runtime);
  }
  if (record.capabilityId === 'video.merge@1') {
    return executeVideoMerge(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), runtime);
  }
  if (record.capabilityId === 'video.extract-frame@1') {
    const { position } = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { position: VideoFramePosition };
    return executeVideoExtractFrame(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), position, runtime);
  }
  throw new Error('该 Operation 不是可重跑的视频处理步骤');
}
