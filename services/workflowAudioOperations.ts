import { parseWorkflowOperationParameters } from '../components/workflow/operationRegistry';
import { changeAudioSpeed, splitAudioStems, trimAudio } from './audioTools';
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

export interface WorkflowAudioOperationRuntime extends WorkflowOperationRuntime {
  executeAudioTrim?: typeof trimAudio;
  executeAudioSpeed?: typeof changeAudioSpeed;
  executeAudioStemSplit?: typeof splitAudioStems;
}

export async function runWorkflowAudioTrimOperation(
  projectId: string,
  sourceNodeId: string,
  parameters: { startSec: number; endSec: number },
  runtime: WorkflowAudioOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'audio.trim@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_audio' }],
    parameters,
  });
  return executeAudioTrim(projectId, started, parameters, runtime);
}

async function executeAudioTrim(
  projectId: string,
  started: StartedWorkflowOperation,
  parameters: { startSec: number; endSec: number },
  runtime: WorkflowAudioOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const result = await (runtime.executeAudioTrim || trimAudio)(blob, parameters.startSec, parameters.endSec, source.metadata.name || 'audio.mp3');
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: result.blob,
      title: `截取 ${result.durationSec.toFixed(1)}s`,
      fileName: `trim-${source.metadata.name || 'audio.mp3'}`,
      mimeType: result.blob.type || source.metadata.mimeType || 'audio/mpeg',
      role: 'result_audio',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowAudioStemSplitOperation(
  projectId: string,
  sourceNodeId: string,
  runtime: WorkflowAudioOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'audio.stem-split@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_audio' }],
    parameters: {},
  });
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const baseName = (source.metadata.name || 'audio').replace(/\.[^.]+$/, '');
    const result = await (runtime.executeAudioStemSplit || splitAudioStems)(blob, source.metadata.name || 'audio.mp3');
    return await commitWorkflowOperation(runtime, projectId, started, [
      { blob: result.vocalsBlob, title: '人声', fileName: `vocals-${baseName}.mp3`, mimeType: 'audio/mpeg', role: 'result_audio' },
      { blob: result.instrumentalBlob, title: '伴奏', fileName: `instrumental-${baseName}.mp3`, mimeType: 'audio/mpeg', role: 'result_audio' },
    ]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function runWorkflowAudioSpeedOperation(
  projectId: string,
  sourceNodeId: string,
  speed: number,
  runtime: WorkflowAudioOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const started = await startWorkflowOperation({
    runtime, projectId, capabilityId: 'audio.speed@1',
    sources: [{ nodeId: sourceNodeId, role: 'source_audio' }],
    parameters: { speed },
  });
  return executeAudioSpeed(projectId, started, speed, runtime);
}

async function executeAudioSpeed(
  projectId: string,
  started: StartedWorkflowOperation,
  speed: number,
  runtime: WorkflowAudioOperationRuntime,
) {
  try {
    const source = started.sourceNodes[0];
    const blob = await loadWorkflowOperationSourceBlob(source, runtime);
    const result = await (runtime.executeAudioSpeed || changeAudioSpeed)(blob, speed, source.metadata.name || 'audio.mp3');
    const baseName = (source.metadata.name || 'audio').replace(/\.[^.]+$/, '');
    return await commitWorkflowOperation(runtime, projectId, started, [{
      blob: result,
      title: `变速 ${speed.toFixed(2)}×`,
      fileName: `speed-${speed}x-${baseName}.mp3`,
      mimeType: 'audio/mpeg',
      role: 'result_audio',
    }]);
  } catch (error) {
    await failWorkflowOperation(runtime, projectId, started, error);
    throw error;
  }
}

export async function rerunWorkflowAudioOperation(
  projectId: string,
  operationNodeId: string,
  runtime: WorkflowAudioOperationRuntime,
): Promise<WorkflowOperationOutcome> {
  const { operation } = requireWorkflowOperation(runtime, projectId, operationNodeId);
  const record = operation.metadata.operation!;
  if (record.capabilityId === 'audio.trim@1') {
    const parameters = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { startSec: number; endSec: number };
    return executeAudioTrim(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), parameters, runtime);
  }
  if (record.capabilityId === 'audio.speed@1') {
    const { speed } = parseWorkflowOperationParameters(record.capabilityId, record.recipe.parameters) as { speed: number };
    return executeAudioSpeed(projectId, await restartWorkflowOperation(runtime, projectId, operationNodeId), speed, runtime);
  }
  throw new Error('该 Operation 不是可重跑的音频处理步骤');
}
