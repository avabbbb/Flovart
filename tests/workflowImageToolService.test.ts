import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';
import {
  rerunWorkflowImageOperation,
  runWorkflowImageEditOperation,
  runWorkflowRemoveBackgroundOperation,
  runWorkflowRotateOperation,
  runWorkflowSplitGridOperation,
  runWorkflowSplitLayersOperation,
} from '../services/workflowImageOperations';
import type { UserApiKey } from '../types';

const apiKey: UserApiKey = {
  id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret', baseUrl: 'https://tools.example/v1',
  customModels: ['gpt-image-2'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' }, routeId: 'gpt-image-2', order: 0 }],
  createdAt: 1, updatedAt: 1,
};

function project(): WorkflowProject {
  return {
    id: 'project', title: '图片工具',
    nodes: [createWorkflowNode('source', 'image', { x: 10, y: 20 }, {
      storageKey: 'source-key', name: 'source.png', mimeType: 'image/png', status: 'success',
      config: { mode: 'image', modelId: 'flovart:gpt-image-2', submode: 'image-to-image' },
    })],
    connections: [], selectedNodeIds: ['source'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', draftVersion: 1,
  };
}

function harness() {
  let current = project();
  let id = 0;
  let media = 0;
  return {
    get current() { return current; },
    runtime: {
      userApiKeys: [apiKey],
      getProject: () => current,
      onProjectChange: vi.fn((next: WorkflowProject) => { current = next; }),
      loadMedia: vi.fn().mockResolvedValue(new Blob(['source'], { type: 'image/png' })),
      ingestMedia: vi.fn(async (file: File) => ({
        type: 'image' as const, storageKey: `media-${media++}`, name: file.name,
        mimeType: file.type, bytes: file.size, naturalWidth: 640, naturalHeight: 360,
      })),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,U09VUkNF'),
      createId: () => `id-${id++}`,
    },
  };
}

describe('workflow remaining image operation executors', () => {
  it('runs background removal as a provider Operation with a durable typed result', async () => {
    const state = harness();
    const executeAgent = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,UkVTVUxU', mimeType: 'image/png', width: 640, height: 360 });
    await runWorkflowRemoveBackgroundOperation('project', 'source', { ...state.runtime, executeAgent });
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const output = state.current.nodes.find(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(executeAgent).toHaveBeenCalledWith(expect.objectContaining({ mimeType: 'image/png' }), 'remove-background', 'gpt-image-2', apiKey, {});
    expect(operation?.metadata.operation).toMatchObject({
      capabilityId: 'image.remove-background@1', takes: [{ status: 'success', outputNodeIds: [output?.id] }],
    });
    expect(output?.metadata.operationOutputRole).toBe('result_image');
  });

  it('turns an ephemeral edit mask into a bound media node and freezes the Prompt Document', async () => {
    const state = harness();
    const executeEdit = vi.fn().mockResolvedValue({ newImageBase64: 'UkVTVUxU', newImageMimeType: 'image/png', textResponse: null });
    await runWorkflowImageEditOperation(
      'project', 'source', '替换蒙版区域', 'mask',
      { href: 'data:image/png;base64,TUFTSw==', mimeType: 'image/png' },
      { ...state.runtime, executeEdit },
    );
    const operation = state.current.nodes.find(node => node.type === 'operation')!;
    const mask = state.current.nodes.find(node => node.title === '编辑蒙版')!;
    expect(operation.metadata.operation?.recipe).toMatchObject({
      promptDocument: { text: '替换蒙版区域' }, parameters: { variant: 'mask' },
      inputBindings: [
        expect.objectContaining({ sourceNodeId: 'source', role: 'source_image', order: 0 }),
        expect.objectContaining({ sourceNodeId: mask.id, role: 'mask_image', order: 1 }),
      ],
    });
    expect(executeEdit).toHaveBeenCalledWith(expect.any(Array), '替换蒙版区域', 'gpt-image-2', apiKey, {
      mask: expect.objectContaining({ href: 'data:image/png;base64,U09VUkNF', mimeType: 'image/png' }),
    });
    expect(operation.metadata.operation?.takes[0].snapshot.inputBindings).toHaveLength(2);
  });

  it('commits every provider layer as one Take with typed multi-output edges', async () => {
    const state = harness();
    const executeSplit = vi.fn().mockResolvedValue([
      { name: '主体', dataUrl: 'data:image/png;base64,QQ==', width: 100, height: 80, offsetX: 4, offsetY: 6 },
      { name: '背景', dataUrl: 'data:image/png;base64,Qg==', width: 120, height: 90, offsetX: 8, offsetY: 10 },
    ]);
    await runWorkflowSplitLayersOperation('project', 'source', { ...state.runtime, executeSplit });
    const operation = state.current.nodes.find(node => node.type === 'operation')!;
    const outputs = state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operation.id);
    expect(operation.metadata.operation).toMatchObject({ capabilityId: 'image.split-layers@1', takes: [{ outputNodeIds: outputs.map(node => node.id) }] });
    expect(outputs.map(node => node.title)).toEqual(['主体', '背景']);
    expect(state.current.connections.filter(connection => connection.kind === 'operation-output')).toHaveLength(2);
  });

  it('uses the shared lifecycle for rotate and grid, then reruns the same local Operation', async () => {
    const rotate = harness();
    await runWorkflowRotateOperation('project', 'source', 'flip-h', {
      ...rotate.runtime, executeRotate: vi.fn().mockResolvedValue(new Blob(['rotate'], { type: 'image/png' })),
    });
    expect(rotate.current.nodes.find(node => node.type === 'operation')?.metadata.operation).toMatchObject({
      capabilityId: 'image.rotate@1', recipe: { parameters: { action: 'flip-h' } },
    });

    const grid = harness();
    const executeSplitGrid = vi.fn().mockResolvedValue([
      { blob: new Blob(['a'], { type: 'image/png' }), index: 0, row: 0, col: 0 },
      { blob: new Blob(['b'], { type: 'image/png' }), index: 1, row: 0, col: 1 },
    ]);
    await runWorkflowSplitGridOperation('project', 'source', { rows: 1, cols: 2 }, { ...grid.runtime, executeSplitGrid });
    const operation = grid.current.nodes.find(node => node.type === 'operation')!;
    expect(operation.metadata.operation?.takes[0].outputNodeIds).toHaveLength(2);
    await rerunWorkflowImageOperation('project', operation.id, { ...grid.runtime, executeSplitGrid });
    expect(grid.current.nodes.find(node => node.id === operation.id)?.metadata.operation?.takes).toHaveLength(2);
  });

  it('keeps provider failures retryable and ignores a late result after the Operation disappears', async () => {
    const failed = harness();
    await expect(runWorkflowRemoveBackgroundOperation('project', 'source', {
      ...failed.runtime, executeAgent: vi.fn().mockRejectedValue(new Error('端点不可用')),
    })).rejects.toThrow('端点不可用');
    expect(failed.current.nodes.find(node => node.type === 'operation')?.metadata).toMatchObject({
      status: 'error', error: '端点不可用', operation: { takes: [{ status: 'error' }] },
    });

    const stale = harness();
    let resolve!: (value: ImageToolResultLike) => void;
    const pending = new Promise<ImageToolResultLike>(done => { resolve = done; });
    const running = runWorkflowRemoveBackgroundOperation('project', 'source', { ...stale.runtime, executeAgent: vi.fn(() => pending) as never });
    await vi.waitFor(() => expect(stale.current.nodes.some(node => node.type === 'operation')).toBe(true));
    stale.runtime.onProjectChange({ ...stale.current, nodes: stale.current.nodes.filter(node => node.type !== 'operation') });
    resolve({ dataUrl: 'data:image/png;base64,UkVTVUxU', mimeType: 'image/png', width: 1, height: 1 });
    await expect(running).resolves.toMatchObject({ status: 'stale' });
    expect(stale.runtime.ingestMedia).not.toHaveBeenCalled();
  });
});

type ImageToolResultLike = { dataUrl: string; mimeType: string; width: number; height: number };
