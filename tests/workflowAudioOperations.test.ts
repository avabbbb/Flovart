import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';
import {
  rerunWorkflowAudioOperation,
  runWorkflowAudioSpeedOperation,
  runWorkflowAudioTrimOperation,
} from '../services/workflowAudioOperations';

function project(): WorkflowProject {
  return {
    id: 'project-audio', title: '音频 Operation',
    nodes: [createWorkflowNode('audio-1', 'audio', { x: 0, y: 0 }, {
      storageKey: 'audio-key-1', name: 'song.wav', mimeType: 'audio/wav', durationMs: 8000, status: 'success',
    })],
    connections: [], selectedNodeIds: ['audio-1'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
    createdAt: '2026-08-06T00:00:00.000Z', updatedAt: '2026-08-06T00:00:00.000Z', draftVersion: 1,
  };
}

function harness() {
  let current = project();
  let index = 0;
  return {
    get current() { return current; },
    runtime: {
      getProject: () => current,
      onProjectChange: vi.fn((next: WorkflowProject) => { current = next; }),
      loadMedia: vi.fn(async () => new Blob(['audio'], { type: 'audio/wav' })),
      ingestMedia: vi.fn(async (file: File) => ({
        type: 'audio' as const, storageKey: `result-${file.name}`, name: file.name,
        mimeType: file.type, bytes: file.size, durationMs: 3000,
      })),
      createId: () => `id-${index++}`,
    },
  };
}

describe('workflow audio operation executors', () => {
  it('commits trim through the shared Operation, Snapshot and typed output chain', async () => {
    const state = harness();
    await runWorkflowAudioTrimOperation('project-audio', 'audio-1', { startSec: 1, endSec: 4 }, {
      ...state.runtime,
      executeAudioTrim: vi.fn().mockResolvedValue({ blob: new Blob(['trim'], { type: 'audio/wav' }), durationSec: 3 }),
    });
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const output = state.current.nodes.find(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(operation?.metadata.operation).toMatchObject({
      capabilityId: 'audio.trim@1',
      recipe: { parameters: { startSec: 1, endSec: 4 }, inputBindings: [expect.objectContaining({ sourceNodeId: 'audio-1', role: 'source_audio' })] },
      takes: [{ status: 'success', snapshot: { compilerVersion: 'workflow-operation@1' }, outputNodeIds: [output?.id] }],
    });
    expect(output).toMatchObject({ type: 'audio', metadata: { name: 'trim-song.wav', operationOutputRole: 'result_audio' } });
    expect(state.current.connections.map(connection => connection.kind)).toEqual(['operation-input', 'operation-output']);
  });

  it('commits speed as MP3 and reruns the same Operation with a new Take', async () => {
    const state = harness();
    const executeAudioSpeed = vi.fn().mockResolvedValue(new Blob(['speed'], { type: 'audio/mpeg' }));
    await runWorkflowAudioSpeedOperation('project-audio', 'audio-1', 1.5, { ...state.runtime, executeAudioSpeed });
    const operation = state.current.nodes.find(node => node.type === 'operation')!;
    const output = state.current.nodes.find(node => node.metadata.sourceOperationNodeId === operation.id);
    expect(output?.metadata).toMatchObject({ name: 'speed-1.5x-song.mp3', mimeType: 'audio/mpeg', operationOutputRole: 'result_audio' });

    await rerunWorkflowAudioOperation('project-audio', operation.id, { ...state.runtime, executeAudioSpeed });
    const rerun = state.current.nodes.find(node => node.id === operation.id)!;
    expect(state.current.nodes.filter(node => node.type === 'operation')).toHaveLength(1);
    expect(rerun.metadata.operation?.takes).toHaveLength(2);
    expect(rerun.metadata.operation?.selectedTakeId).toBe(rerun.metadata.operation?.takes[1].id);
  });

  it('rejects invalid parameters before creation and keeps execution failures retryable', async () => {
    const invalid = harness();
    await expect(runWorkflowAudioTrimOperation('project-audio', 'audio-1', { startSec: 4, endSec: 2 }, invalid.runtime)).rejects.toThrow('音频结束时间必须晚于开始时间');
    expect(invalid.current.nodes.some(node => node.type === 'operation')).toBe(false);

    const failed = harness();
    await expect(runWorkflowAudioSpeedOperation('project-audio', 'audio-1', 1.5, {
      ...failed.runtime,
      executeAudioSpeed: vi.fn().mockRejectedValue(new Error('ffmpeg 不可用')),
    })).rejects.toThrow('ffmpeg 不可用');
    expect(failed.current.nodes.find(node => node.type === 'operation')?.metadata).toMatchObject({
      status: 'error', error: 'ffmpeg 不可用', operation: { takes: [{ status: 'error', error: 'ffmpeg 不可用' }] },
    });
  });
});
