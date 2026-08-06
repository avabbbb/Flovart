import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';
import {
  rerunWorkflowVideoOperation,
  runWorkflowVideoAvSplitOperation,
  runWorkflowVideoExtractFrameOperation,
  runWorkflowVideoMergeOperation,
  runWorkflowVideoTrimOperation,
} from '../services/workflowVideoOperations';

function project(): WorkflowProject {
  return {
    id: 'project-video', title: '视频 Operation',
    nodes: [
      createWorkflowNode('video-1', 'video', { x: 0, y: 0 }, { storageKey: 'video-key-1', name: 'one.mp4', mimeType: 'video/mp4', status: 'success' }),
      createWorkflowNode('video-2', 'video', { x: 0, y: 300 }, { storageKey: 'video-key-2', name: 'two.mp4', mimeType: 'video/mp4', status: 'success' }),
    ],
    connections: [], selectedNodeIds: ['video-1'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
    createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z', draftVersion: 1,
  };
}

function harness() {
  let current = project();
  let index = 0;
  const ingestMedia = vi.fn(async (file: File) => ({
    type: file.type.startsWith('audio/') ? 'audio' as const : file.type.startsWith('image/') ? 'image' as const : 'video' as const,
    storageKey: `result-${file.name}`,
    name: file.name,
    mimeType: file.type,
    bytes: file.size,
    ...(file.type.startsWith('audio/') ? { durationMs: 3000 } : { naturalWidth: 1280, naturalHeight: 720, durationMs: 3000 }),
  }));
  return {
    get current() { return current; },
    runtime: {
      getProject: () => current,
      onProjectChange: vi.fn((next: WorkflowProject) => { current = next; }),
      loadMedia: vi.fn(async (storageKey: string) => new Blob([storageKey], { type: 'video/mp4' })),
      ingestMedia,
      createId: () => `id-${index++}`,
    },
  };
}

describe('workflow video operation executors', () => {
  it('commits trim as source -> operation -> output with a generic execution snapshot', async () => {
    const state = harness();
    await runWorkflowVideoTrimOperation('project-video', 'video-1', { startSec: 1, endSec: 4 }, {
      ...state.runtime,
      executeVideoTrim: vi.fn().mockResolvedValue({ blob: new Blob(['trim'], { type: 'video/mp4' }), durationSec: 3 }),
    });
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const output = state.current.nodes.find(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(operation?.metadata.operation).toMatchObject({
      capabilityId: 'video.trim@1',
      recipe: { parameters: { startSec: 1, endSec: 4 }, inputBindings: [expect.objectContaining({ sourceNodeId: 'video-1', role: 'source_video' })] },
      selectedTakeId: 'id-2',
      takes: [{ status: 'success', outputNodeIds: [output?.id], snapshot: { compilerVersion: 'workflow-operation@1' } }],
    });
    expect(output?.metadata).toMatchObject({ operationTakeId: 'id-2', operationOutputRole: 'result_video' });
    expect(state.current.connections).toEqual([
      expect.objectContaining({ fromNodeId: 'video-1', toNodeId: operation?.id, kind: 'operation-input', role: 'source_video', order: 0 }),
      expect.objectContaining({ fromNodeId: operation?.id, toNodeId: output?.id, kind: 'operation-output', role: 'result_video', order: 0 }),
    ]);
  });

  it('records the two typed outputs of audio/video split in one Take', async () => {
    const state = harness();
    await runWorkflowVideoAvSplitOperation('project-video', 'video-1', {
      ...state.runtime,
      executeVideoAvSplit: vi.fn().mockResolvedValue({
        videoBlob: new Blob(['video'], { type: 'video/mp4' }),
        audioBlob: new Blob(['audio'], { type: 'audio/mpeg' }),
      }),
    });
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const outputs = state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(outputs.map(node => [node.type, node.metadata.operationOutputRole])).toEqual([
      ['video', 'result_video'], ['audio', 'result_audio'],
    ]);
    expect(outputs.map(node => node.metadata.name)).toEqual(['video-only-one.mp4', 'audio-one.mp3']);
    expect(operation?.metadata.operation?.takes[0].outputNodeIds).toEqual(outputs.map(node => node.id));
    expect(state.current.connections.filter(connection => connection.kind === 'operation-output').map(connection => connection.role)).toEqual(['result_video', 'result_audio']);
  });

  it('preserves ordered multi-video bindings for merge and reruns the same Operation', async () => {
    const state = harness();
    const executeVideoMerge = vi.fn().mockResolvedValue(new Blob(['merged'], { type: 'video/mp4' }));
    await runWorkflowVideoMergeOperation('project-video', ['video-2', 'video-1'], { ...state.runtime, executeVideoMerge });
    const operation = state.current.nodes.find(node => node.type === 'operation')!;
    expect(operation.metadata.operation?.recipe.inputBindings.map(binding => binding.sourceNodeId)).toEqual(['video-2', 'video-1']);
    expect(executeVideoMerge).toHaveBeenCalledWith(
      [expect.any(Blob), expect.any(Blob)], ['two.mp4', 'one.mp4'],
    );

    await rerunWorkflowVideoOperation('project-video', operation.id, { ...state.runtime, executeVideoMerge });

    const rerun = state.current.nodes.find(node => node.id === operation.id)!;
    expect(state.current.nodes.filter(node => node.type === 'operation')).toHaveLength(1);
    expect(rerun.metadata.operation?.takes).toHaveLength(2);
    expect(rerun.metadata.operation?.selectedTakeId).toBe(rerun.metadata.operation?.takes[1].id);
  });

  it('commits extracted first/last frames as typed image outputs', async () => {
    const state = harness();
    await runWorkflowVideoExtractFrameOperation('project-video', 'video-1', 'last', {
      ...state.runtime,
      executeVideoFrame: vi.fn().mockResolvedValue({ blob: new Blob(['frame'], { type: 'image/png' }), width: 1280, height: 720 }),
    });
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const output = state.current.nodes.find(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(operation?.metadata.operation?.recipe.parameters).toEqual({ position: 'last' });
    expect(output).toMatchObject({ type: 'image', title: '尾帧', metadata: { operationOutputRole: 'result_image', mimeType: 'image/png' } });
  });

  it('rejects an invalid merge before creating an Operation and keeps failures retryable', async () => {
    const invalid = harness();
    await expect(runWorkflowVideoMergeOperation('project-video', ['video-1'], invalid.runtime)).rejects.toThrow('至少需要 2 个 source_video 输入');
    expect(invalid.current.nodes.some(node => node.type === 'operation')).toBe(false);

    const failed = harness();
    await expect(runWorkflowVideoTrimOperation('project-video', 'video-1', { startSec: 0, endSec: 2 }, {
      ...failed.runtime,
      executeVideoTrim: vi.fn().mockRejectedValue(new Error('ffmpeg 不可用')),
    })).rejects.toThrow('ffmpeg 不可用');
    expect(failed.current.nodes.find(node => node.type === 'operation')?.metadata).toMatchObject({
      status: 'error', error: 'ffmpeg 不可用', operation: { takes: [{ status: 'error', error: 'ffmpeg 不可用' }] },
    });
  });
});
