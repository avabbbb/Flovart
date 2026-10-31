import { parseWorkflowOperationParameters } from '../components/workflow/operationRegistry';
import { extractVideoFrame, type VideoFramePosition } from './videoFrameExtractor';
import { enqueueFFmpegTask, mergeVideos, splitAudioVideo, trimVideo } from './videoTools';
import { splitAudioStems } from './audioTools';
import { orderNodesByShot } from './shotPlanning';
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
  executeAudioStemSplit?: typeof splitAudioStems;
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

export type VideoAvSplitAudio = 'full' | 'vocals' | 'background';

const AV_SPLIT_AUDIO_SUFFIX: Record<VideoAvSplitAudio, string> = { full: '音频', vocals: '人声', background: '背景音' };

export async function runWorkflowVideoAvSplitOperation(
  projectId: string,
  sourceNodeId: string,
  runtime: WorkflowVideoOperationRuntime,
  audio: VideoAvSplitAudio = 'full',
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'video.av-split@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_video' }],
    parameters: { audio },
  });
  return executeVideoAvSplit(projectId, started, audio, runtime);
}

async function executeVideoAvSplit(
  projectId: string,
  started: StartedWorkflowOperation,
  audio: VideoAvSplitAudio,
  runtime: WorkflowVideoOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const result = await (runtime.executeVideoAvSplit || splitAudioVideo)(blob, source.metadata.name || 'video.mp4');
    const baseName = (source.metadata.name || 'video').replace(/\.[^.]+$/, '');
    let audioBlob = result.audioBlob;
    if (audio !== 'full') {
      // 人声/背景音：在分离出的音轨上做相位抵消分离；与 videoTools 共享 ffmpeg 单例，必须走串行队列。
      const stems = await enqueueFFmpegTask(() => (runtime.executeAudioStemSplit || splitAudioStems)(result.audioBlob, 'audio-' + baseName + '.mp3'));
      audioBlob = audio === 'vocals' ? stems.vocalsBlob : stems.instrumentalBlob;
    }
    const label = source.title || baseName;
    const suffix = AV_SPLIT_AUDIO_SUFFIX[audio];
    return await commitWorkflowOperation(runtime, projectId, started, [
      { blob: result.videoBlob, title: label + '_无声', fileName: 'video-only-' + (source.metadata.name || 'video.mp4'), mimeType: result.videoBlob.type || 'video/mp4', role: 'result_video' },
      { blob: audioBlob, title: label + '_' + suffix, fileName: (audio === 'full' ? 'audio' : audio) + '-' + baseName + '.mp3', mimeType: audioBlob.type || 'audio/mpeg', role: 'result_audio' },
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
    // 镜头表拼接：有 shot.index 的按镜号排序，其余按选择顺序。
    const ordered = orderNodesByShot(started.sourceNodes);
    const blobs = await Promise.all(ordered.map(source => loadWorkflowOperationSourceBlob(source, runtime)));
    const merged = await (runtime.executeVideoMerge || mergeVideos)(blobs, ordered.map(source => source.metadata.name || 'video.mp4'));
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
  currentTimeSec?: number,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'video.extract-frame@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_video' }],
    parameters: { position, ...(position === 'current' ? { currentTimeSec: Math.max(0, currentTimeSec || 0) } : {}) },
  });
  return executeVideoExtractFrame(projectId, started, position, runtime, currentTimeSec);
}

async function executeVideoExtractFrame(
  projectId: string,
  started: StartedWorkflowOperation,
  position: VideoFramePosition,
  runtime: WorkflowVideoOperationRuntime,
  currentTimeSec?: number,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const frame = await (runtime.executeVideoFrame || extractVideoFrame)(blob, position, currentTimeSec);
    const baseName = (source.metadata.name || 'video').replace(/\.[^.]+$/, '');
    const frameLabel = position === 'first' ? '首帧' : position === 'last' ? '尾帧' : '当前帧';
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: frame.blob,
      title: frameLabel,
      fileName: `${position === 'first' ? 'first-frame' : position === 'last' ? 'last-frame' : 'current-frame'}-${baseName}.png`,
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
    const { audio } = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { audio: VideoAvSplitAudio };
    return executeVideoAvSplit(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), audio, runtime);
  }
  if (record.capabilityId === 'video.merge@1') {
    return executeVideoMerge(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), runtime);
  }
  if (record.capabilityId === 'video.extract-frame@1') {
    const { position, currentTimeSec } = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { position: VideoFramePosition; currentTimeSec?: number };
    return executeVideoExtractFrame(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), position, runtime, currentTimeSec);
  }
  throw new Error('该 Operation 不是可重跑的视频处理步骤');
}
