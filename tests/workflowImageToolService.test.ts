import { describe, expect, it, vi } from 'vitest';
import type { UserApiKey } from '../types';
import type { WorkflowProject } from '../components/workflow/types';
import { runWorkflowImageEdit, runWorkflowImageAgent, runWorkflowImageSplit } from '../services/workflowImageTools';

const apiKey: UserApiKey = {
  id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret', baseUrl: 'https://tools.example/v1',
  customModels: ['gpt-image-2'], createdAt: 1, updatedAt: 1,
};

const project = (): WorkflowProject => ({
  id: 'project', title: '图片工具',
  nodes: [{ id: 'source', type: 'image', title: '源图', position: { x: 10, y: 20 }, width: 320, height: 180, metadata: { storageKey: 'source-key', mimeType: 'image/png', status: 'success' } }],
  connections: [], selectedNodeIds: ['source'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
});

function runtime(initial = project()) {
  let current = initial;
  return {
    get current() { return current; },
    deps: {
      userApiKeys: [apiKey], modelPreference: { textModel: '', imageModel: 'gpt-image-2', videoModel: '' },
      getProject: () => current,
      onProjectChange: vi.fn((next: WorkflowProject) => { current = next; }),
      loadMedia: vi.fn().mockResolvedValue(new Blob(['source'], { type: 'image/png' })),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result-key', name: 'result.png', mimeType: 'image/png', bytes: 6, naturalWidth: 640, naturalHeight: 360 }),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,U09VUkNF'),
      createId: vi.fn().mockReturnValueOnce('request').mockReturnValueOnce('result').mockReturnValueOnce('edge'),
    },
  };
}

describe('workflow image tool service', () => {
  it.each(['upscale', 'remove-background'] as const)('runs %s through the image agent and adds a durable connected result', async task => {
    const state = runtime();
    const executeAgent = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,UkVTVUxU', mimeType: 'image/png', width: 640, height: 360 });
    await runWorkflowImageAgent('project', 'source', task, { ...state.deps, executeAgent });
    expect(executeAgent).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }), task, 'gpt-image-2', apiKey, expect.anything());
    expect(state.current.nodes.at(-1)).toMatchObject({ id: 'result', type: 'image', metadata: { storageKey: 'result-key', href: undefined } });
    expect(state.current.connections.at(-1)).toMatchObject({ fromNodeId: 'source', toNodeId: 'result' });
  });

  it.each([
    ['outpaint', undefined],
    ['mask', { href: 'data:image/png;base64,TUFTSw==', mimeType: 'image/png' }],
  ] as const)('runs %s through provider image editing', async (_kind, mask) => {
    const state = runtime();
    const executeEdit = vi.fn().mockResolvedValue({ newImageBase64: 'UkVTVUxU', newImageMimeType: 'image/png', textResponse: null });
    await runWorkflowImageEdit('project', 'source', '扩展右侧画面', mask, { ...state.deps, executeEdit });
    expect(executeEdit).toHaveBeenCalledWith(expect.any(Array), '扩展右侧画面', 'gpt-image-2', apiKey, mask ? { mask } : undefined);
    expect(state.current.nodes.at(-1)?.metadata.storageKey).toBe('result-key');
  });

  it('splits every provider layer into durable connected result nodes atomically', async () => {
    const state = runtime();
    state.deps.ingestMedia = vi.fn()
      .mockResolvedValueOnce({ type: 'image', storageKey: 'layer-a', name: 'A.png', mimeType: 'image/png', bytes: 1, naturalWidth: 100, naturalHeight: 80 })
      .mockResolvedValueOnce({ type: 'image', storageKey: 'layer-b', name: 'B.png', mimeType: 'image/png', bytes: 1, naturalWidth: 120, naturalHeight: 90 });
    state.deps.createId = vi.fn().mockReturnValueOnce('request').mockReturnValueOnce('a').mockReturnValueOnce('edge-a').mockReturnValueOnce('b').mockReturnValueOnce('edge-b');
    const executeSplit = vi.fn().mockResolvedValue([
      { name: 'A', dataUrl: 'data:image/png;base64,QQ==', width: 100, height: 80, offsetX: 4, offsetY: 6 },
      { name: 'B', dataUrl: 'data:image/png;base64,Qg==', width: 120, height: 90, offsetX: 8, offsetY: 10 },
    ]);
    await runWorkflowImageSplit('project', 'source', { ...state.deps, executeSplit });
    expect(state.current.nodes.slice(1).map(node => node.metadata.storageKey)).toEqual(['layer-a', 'layer-b']);
    expect(state.current.connections).toHaveLength(2);
    expect(state.deps.onProjectChange).toHaveBeenCalledTimes(2);
  });

  it('keeps provider errors on the source without creating a broken result', async () => {
    const state = runtime();
    await expect(runWorkflowImageAgent('project', 'source', 'upscale', { ...state.deps, executeAgent: vi.fn().mockRejectedValue(new Error('端点不可用')) })).rejects.toThrow('端点不可用');
    expect(state.current.nodes).toHaveLength(1);
    expect(state.current.nodes[0].metadata).toMatchObject({ status: 'error', error: '端点不可用' });
  });

  it('does not commit a result after the project or request becomes stale', async () => {
    const state = runtime();
    let resolve!: (value: any) => void;
    const pending = new Promise(value => { resolve = value; });
    const operation = runWorkflowImageAgent('project', 'source', 'upscale', { ...state.deps, executeAgent: vi.fn(() => pending) as any });
    state.deps.onProjectChange({ ...state.current, nodes: [] });
    resolve({ dataUrl: 'data:image/png;base64,UkVTVUxU', mimeType: 'image/png', width: 1, height: 1 });
    await operation;
    expect(state.current.nodes).toHaveLength(0);
    expect(state.deps.ingestMedia).not.toHaveBeenCalled();
  });
});
