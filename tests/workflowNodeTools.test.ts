import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';
import { runWorkflowNodeTool } from '../services/workflowNodeTools';
import type { UserApiKey } from '../types';

const apiKey: UserApiKey = {
  id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret', customModels: ['gpt-image-2'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' }, routeId: 'gpt-image-2', order: 0 }],
  createdAt: 1, updatedAt: 1,
};

function harness(initialNodes = [createWorkflowNode('source', 'image', { x: 0, y: 0 }, { storageKey: 'source-key', mimeType: 'image/png', config: { mode: 'image', modelId: 'flovart:gpt-image-2' } })]) {
  let current: WorkflowProject = {
    id: 'project', title: 'Agent 图片工具',
    nodes: initialNodes,
    connections: [], selectedNodeIds: ['source'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
    createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z', draftVersion: 1,
  };
  let index = 0;
  return {
    get current() { return current; },
    runtime: {
      userApiKeys: [apiKey],
      getProject: () => current,
      onProjectChange: (next: WorkflowProject) => { current = next; },
      createId: () => `id-${index++}`,
      loadMedia: vi.fn().mockResolvedValue(new Blob(['source'], { type: 'image/png' })),
      ingestMedia: vi.fn(async (file: File) => ({
        type: file.type.startsWith('video/') ? 'video' as const : file.type.startsWith('audio/') ? 'audio' as const : 'image' as const,
        storageKey: `result-${file.name}`, name: file.name, mimeType: file.type, bytes: file.size, naturalWidth: 640, naturalHeight: 360,
      })),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,U09VUkNF'),
    },
  };
}

describe('workflow node tools operation projection', () => {
  it('routes Agent crop through the explicit crop Operation executor', async () => {
    const state = harness();
    await runWorkflowNodeTool('project', 'source', 'crop', { x: .1, y: .1, width: .8, height: .8 }, {
      ...state.runtime,
      executeCrop: vi.fn().mockResolvedValue(new Blob(['crop'], { type: 'image/png' })),
    });
    expect(state.current.nodes.find(node => node.type === 'operation')?.metadata.operation?.capabilityId).toBe('image.crop@1');
    expect(state.current.connections.map(connection => connection.kind)).toEqual(['operation-input', 'operation-output']);
  });

  it('routes Agent upscale through the explicit upscale Operation executor', async () => {
    const state = harness();
    await runWorkflowNodeTool('project', 'source', 'upscale', { targetLongEdge: 2048, algorithm: 'nearest' }, {
      ...state.runtime,
      executeAgent: vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,UkVTVUxU', mimeType: 'image/png', width: 640, height: 360 }),
    });
    expect(state.current.nodes.find(node => node.type === 'operation')?.metadata.operation).toMatchObject({
      capabilityId: 'image.upscale@1', recipe: { parameters: { targetLongEdge: 2048, algorithm: 'nearest' } },
    });
  });

  it('routes Agent video tools through the same Operation lifecycle', async () => {
    const video = createWorkflowNode('video', 'video', { x: 0, y: 0 }, { storageKey: 'video-key', mimeType: 'video/mp4', name: 'source.mp4' });
    const state = harness([video]);
    await runWorkflowNodeTool('project', 'video', 'video-trim', { startSec: 1, endSec: 3 }, {
      ...state.runtime,
      executeVideoTrim: vi.fn().mockResolvedValue({ blob: new Blob(['trim'], { type: 'video/mp4' }), durationSec: 2 }),
    });
    expect(state.current.nodes.find(node => node.type === 'operation')?.metadata.operation).toMatchObject({
      capabilityId: 'video.trim@1', recipe: { parameters: { startSec: 1, endSec: 3 } }, takes: [{ status: 'success' }],
    });
  });
});
