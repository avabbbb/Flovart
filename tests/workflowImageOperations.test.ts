import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowProject } from '../components/workflow/types';
import type { UserApiKey } from '../types';
import { rerunWorkflowImageOperation, runWorkflowCropOperation, runWorkflowLayerOperation, runWorkflowUpscaleOperation } from '../services/workflowImageOperations';
import { deriveWorkflowLayerPreview } from '../components/workflow/layerPreview';

const apiKey: UserApiKey = {
  id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret', customModels: ['gpt-image-2'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'image-to-image' }, routeId: 'gpt-image-2', order: 0 }],
  createdAt: 1, updatedAt: 1,
};

function project(): WorkflowProject {
  return {
    id: 'project-1', title: '图片链路',
    nodes: [createWorkflowNode('source-1', 'image', { x: 0, y: 0 }, { storageKey: 'source-key', mimeType: 'image/png', status: 'success', config: { mode: 'image', modelId: 'flovart:gpt-image-2', submode: 'image-to-image' } })],
    connections: [], selectedNodeIds: ['source-1'], viewport: { x: 0, y: 0, k: 1 }, backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null,
    createdAt: '2026-08-05T00:00:00.000Z', updatedAt: '2026-08-05T00:00:00.000Z', draftVersion: 1,
  };
}

function runtime() {
  let current = project();
  let index = 0;
  return {
    get current() { return current; },
    deps: {
      userApiKeys: [apiKey],
      getProject: () => current,
      onProjectChange: vi.fn((next: WorkflowProject) => { current = next; }),
      loadMedia: vi.fn().mockResolvedValue(new Blob(['source'], { type: 'image/png' })),
      ingestMedia: vi.fn().mockResolvedValue({ type: 'image', storageKey: 'result-key', name: 'result.png', mimeType: 'image/png', bytes: 6, naturalWidth: 640, naturalHeight: 360 }),
      encodeDataUrl: vi.fn().mockResolvedValue('data:image/png;base64,U09VUkNF'),
      createId: () => `id-${index++}`,
    },
  };
}

describe('workflow image operation executors', () => {
  it('commits crop as source -> operation -> output with a durable Take', async () => {
    const state = runtime();
    const crop = { x: .1, y: .1, width: .8, height: .8 };
    const outcome = await runWorkflowCropOperation('project-1', 'source-1', crop, {
      ...state.deps,
      executeCrop: vi.fn().mockResolvedValue(new Blob(['crop'], { type: 'image/png' })),
    });
    expect(outcome.status).toBe('committed');
    const operation = state.current.nodes.find(node => node.type === 'operation');
    const output = state.current.nodes.find(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(operation?.metadata.operation).toMatchObject({ capabilityId: 'image.crop@1', recipe: { parameters: crop }, selectedTakeId: 'id-2' });
    expect(operation?.metadata.operation?.takes[0]).toMatchObject({ status: 'success', outputNodeIds: [output?.id] });
    expect(state.current.connections).toEqual([
      expect.objectContaining({ fromNodeId: 'source-1', toNodeId: operation?.id, kind: 'operation-input' }),
      expect.objectContaining({ fromNodeId: operation?.id, toNodeId: output?.id, kind: 'operation-output' }),
    ]);
  });

  it('commits upscale through the provider while preserving its actual route snapshot', async () => {
    const state = runtime();
    const executeAgent = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,UkVTVUxU', mimeType: 'image/png', width: 640, height: 360 });
    await runWorkflowUpscaleOperation('project-1', 'source-1', { targetLongEdge: 2048, algorithm: 'high' }, { ...state.deps, executeAgent });
    const operation = state.current.nodes.find(node => node.type === 'operation');
    expect(executeAgent).toHaveBeenCalledWith(expect.any(Object), 'upscale', 'gpt-image-2', apiKey, { targetLongEdge: 2048, algorithm: 'high' });
    expect(operation?.metadata.operation?.takes[0]).toMatchObject({ status: 'success', snapshot: { routeId: 'gpt-image-2' } });
  });

  it('keeps a failed operation node and retryable recipe on the canvas', async () => {
    const state = runtime();
    await expect(runWorkflowUpscaleOperation('project-1', 'source-1', { targetLongEdge: 2048, algorithm: 'high' }, {
      ...state.deps,
      executeAgent: vi.fn().mockRejectedValue(new Error('端点不可用')),
    })).rejects.toThrow('端点不可用');
    const operation = state.current.nodes.find(node => node.type === 'operation');
    expect(operation?.metadata).toMatchObject({ status: 'error', error: '端点不可用' });
    expect(operation?.metadata.operation?.takes[0]).toMatchObject({ status: 'error', error: '端点不可用' });
  });

  it('reruns the same operation recipe as a new Take instead of creating another operation', async () => {
    const state = runtime();
    const executeCrop = vi.fn().mockResolvedValue(new Blob(['crop'], { type: 'image/png' }));
    await runWorkflowCropOperation('project-1', 'source-1', { x: 0, y: 0, width: .5, height: .5 }, { ...state.deps, executeCrop });
    const operationId = state.current.nodes.find(node => node.type === 'operation')!.id;

    await rerunWorkflowImageOperation('project-1', operationId, { ...state.deps, executeCrop });

    const operations = state.current.nodes.filter(node => node.type === 'operation');
    expect(operations).toHaveLength(1);
    expect(operations[0].metadata.operation?.takes).toHaveLength(2);
    expect(operations[0].metadata.operation?.selectedTakeId).toBe(operations[0].metadata.operation?.takes[1].id);
    expect(state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operationId)).toHaveLength(2);
    expect(state.current.connections.filter(connection => connection.kind === 'operation-input')).toHaveLength(1);
  });

  it('generates four transparent layer candidates sequentially as one 2x2 Take', async () => {
    const state = runtime();
    const executeEdit = vi.fn().mockResolvedValue({ newImageBase64: 'data:image/png;base64,TEFZRVI=', newImageMimeType: 'image/png' });
    const outcome = await runWorkflowLayerOperation('project-1', 'source-1', { prompt: '在天空画一颗发光星星', style: 'glow' }, { ...state.deps, executeEdit });
    expect(outcome.status).toBe('committed');
    expect(executeEdit).toHaveBeenCalledTimes(4);
    const prompt = executeEdit.mock.calls[0][1] as string;
    expect(prompt).toContain('在天空画一颗发光星星');
    expect(prompt).toContain('完全透明');
    expect(prompt).toContain('不要包含原图像素');
    const operation = state.current.nodes.find(node => node.type === 'operation');
    expect(operation?.metadata.operation).toMatchObject({ capabilityId: 'image.layer@1', recipe: { parameters: { style: 'glow', count: 4 } } });
    const take = operation?.metadata.operation?.takes[0];
    expect(take?.status).toBe('success');
    expect(take?.outputNodeIds).toHaveLength(4);
    const outputs = state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operation?.id);
    expect(outputs).toHaveLength(4);
    const xs = new Set(outputs.map(node => node.position.x));
    const ys = new Set(outputs.map(node => node.position.y));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
    const preview = deriveWorkflowLayerPreview(operation!, state.current.nodes);
    expect(preview?.source?.id).toBe('source-1');
    expect(preview?.candidates.map(node => node.id)).toEqual(take?.outputNodeIds);
    expect(deriveWorkflowLayerPreview(state.current.nodes.find(node => node.id === 'source-1')!, state.current.nodes)).toBeUndefined();
  });

  it('fails the whole layer Take without committing a partial candidate set', async () => {
    const state = runtime();
    const executeEdit = vi.fn()
      .mockResolvedValueOnce({ newImageBase64: 'data:image/png;base64,TEFZRVI=', newImageMimeType: 'image/png' })
      .mockRejectedValueOnce(new Error('限流'));
    await expect(runWorkflowLayerOperation('project-1', 'source-1', { prompt: '加标题', style: 'title' }, { ...state.deps, executeEdit })).rejects.toThrow('限流');
    expect(executeEdit).toHaveBeenCalledTimes(2);
    const operation = state.current.nodes.find(node => node.type === 'operation');
    expect(operation?.metadata.operation?.takes[0]).toMatchObject({ status: 'error', error: '限流' });
    expect(state.current.nodes.filter(node => node.metadata.sourceOperationNodeId === operation?.id)).toHaveLength(0);
  });

  it('rejects an empty layer prompt before touching the provider', async () => {
    const state = runtime();
    const executeEdit = vi.fn();
    await expect(runWorkflowLayerOperation('project-1', 'source-1', { prompt: '   ' }, { ...state.deps, executeEdit })).rejects.toThrow();
    expect(executeEdit).not.toHaveBeenCalled();
    expect(state.current.nodes.some(node => node.type === 'operation')).toBe(false);
  });

  it('reruns a layer operation as a new Take on the same operation node', async () => {
    const state = runtime();
    const executeEdit = vi.fn().mockResolvedValue({ newImageBase64: 'data:image/png;base64,TEFZRVI=', newImageMimeType: 'image/png' });
    await runWorkflowLayerOperation('project-1', 'source-1', { prompt: '加涂鸦', count: 2 }, { ...state.deps, executeEdit });
    const operationId = state.current.nodes.find(node => node.type === 'operation')!.id;
    await rerunWorkflowImageOperation('project-1', operationId, { ...state.deps, executeEdit });
    const operations = state.current.nodes.filter(node => node.type === 'operation');
    expect(operations).toHaveLength(1);
    expect(operations[0].metadata.operation?.takes).toHaveLength(2);
    expect(operations[0].metadata.operation?.takes[1]).toMatchObject({ status: 'success' });
    expect(executeEdit).toHaveBeenCalledTimes(4);
  });
});
