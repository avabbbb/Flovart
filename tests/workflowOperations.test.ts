import { describe, expect, it } from 'vitest';
import {
  beginWorkflowOperationTake,
  completeWorkflowOperationTake,
  createWorkflowOperationInputBinding,
  createWorkflowOperationNode,
  createWorkflowOperationRecipe,
  ensureWorkflowImageGenerateOperation,
  updateWorkflowOperationRecipe,
  workflowOperationInputConnections,
} from '../components/workflow/operations';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject } from '../components/workflow/store';

describe('workflow operation records', () => {
  it('hashes semantically identical recipes to the same value', async () => {
    const base = { capabilityId: 'image.upscale@1' as const, prompt: '', productModelId: 'flovart:gpt-image-2', now: '2026-08-05T00:00:00.000Z' };
    const first = await createWorkflowOperationRecipe({ ...base, parameters: { targetLongEdge: 2048, algorithm: 'high' } });
    const second = await createWorkflowOperationRecipe({ ...base, parameters: { algorithm: 'high', targetLongEdge: 2048 } });
    expect(first.recipeHash).toHaveLength(64);
    expect(first.recipeHash).toBe(second.recipeHash);
  });

  it('uses one input binding as the operation edge projection', async () => {
    const binding = createWorkflowOperationInputBinding('binding-1', 'source-1', 'source_image', 0);
    const node = await createWorkflowOperationNode({
      id: 'operation-1', capabilityId: 'image.crop@1', position: { x: 400, y: 0 },
      parameters: { x: .1, y: .1, width: .8, height: .8 }, inputBindings: [binding], now: '2026-08-05T00:00:00.000Z',
    });
    expect(node.type).toBe('operation');
    expect(node.metadata.operation?.recipe.inputBindings).toEqual([binding]);
    expect(workflowOperationInputConnections(node)).toEqual([{
      id: 'binding-1', fromNodeId: 'source-1', toNodeId: 'operation-1', kind: 'operation-input', role: 'source_image', order: 0,
    }]);
  });

  it('keeps a late result as an outdated take without selecting it', async () => {
    const binding = createWorkflowOperationInputBinding('binding-1', 'source-1', 'source_image', 0);
    let node = await createWorkflowOperationNode({
      id: 'operation-1', capabilityId: 'image.upscale@1', position: { x: 0, y: 0 },
      parameters: { targetLongEdge: 2048, algorithm: 'high' }, inputBindings: [binding], now: '2026-08-05T00:00:00.000Z',
    });
    const started = await beginWorkflowOperationTake(node, { id: 'take-1', snapshotId: 'snapshot-1', now: '2026-08-05T00:01:00.000Z' });
    node = updateWorkflowOperationRecipe(started.node, { parameters: { targetLongEdge: 4096, algorithm: 'high' }, now: '2026-08-05T00:02:00.000Z' });
    expect(node.metadata.operation?.recipe.recipeHash).toBeNull();
    node = completeWorkflowOperationTake(node, 'take-1', ['output-1'], { now: '2026-08-05T00:03:00.000Z' });
    expect(node.metadata.operation?.takes[0]).toMatchObject({ status: 'outdated_recipe', outputNodeIds: ['output-1'] });
    expect(node.metadata.operation?.selectedTakeId).toBeUndefined();
    expect(node.metadata.status).toBe('idle');
  });

  it('selects a successful take for the unchanged recipe', async () => {
    const node = await createWorkflowOperationNode({
      id: 'operation-1', capabilityId: 'image.generate@1', position: { x: 0, y: 0 }, prompt: '一只白兔',
      parameters: { count: 1 }, now: '2026-08-05T00:00:00.000Z',
    });
    const started = await beginWorkflowOperationTake(node, { id: 'take-1', snapshotId: 'snapshot-1', renderedPrompt: '一只白兔, studio light', now: '2026-08-05T00:01:00.000Z' });
    const completed = completeWorkflowOperationTake(started.node, 'take-1', ['output-1'], { now: '2026-08-05T00:02:00.000Z' });
    expect(completed.metadata.operation?.selectedTakeId).toBe('take-1');
    expect(completed.metadata.operation?.takes[0].snapshot.renderedPrompt).toBe('一只白兔, studio light');
  });

  it('records cancellation without turning the operation into an error', async () => {
    const node = await createWorkflowOperationNode({
      id: 'operation-1', capabilityId: 'image.generate@1', position: { x: 0, y: 0 }, prompt: '一只白兔',
      parameters: { count: 1 }, now: '2026-08-05T00:00:00.000Z',
    });
    const started = await beginWorkflowOperationTake(node, { id: 'take-1', snapshotId: 'snapshot-1', now: '2026-08-05T00:01:00.000Z' });
    const canceled = completeWorkflowOperationTake(started.node, 'take-1', [], { canceled: true, error: '生成已停止', now: '2026-08-05T00:02:00.000Z' });
    expect(canceled.metadata.status).toBe('idle');
    expect(canceled.metadata.error).toBeUndefined();
    expect(canceled.metadata.operation?.takes[0]).toMatchObject({ status: 'canceled', error: '生成已停止' });
  });

  it('turns an empty image generator into an explicit operation and canonicalizes its input edge', async () => {
    const project = createWorkflowProject('图片链路');
    const source = createWorkflowNode('reference-1', 'image', { x: 0, y: 0 }, { storageKey: 'image-1', status: 'success' });
    const target = createWorkflowNode('generator-1', 'image', { x: 420, y: 0 }, {
      prompt: '参考 @图片1 生成海报', mentionedNodeIds: ['reference-1'], imageReferenceOrder: ['reference-1'],
      config: { mode: 'image', modelId: 'flovart:gpt-image-2', count: 1 },
    });
    project.nodes = [source, target];
    project.connections = [{ id: 'legacy-edge', fromNodeId: source.id, toNodeId: target.id }];
    const ids = ['binding-1'];
    const result = await ensureWorkflowImageGenerateOperation({ project, nodeId: target.id, createId: () => ids.shift()!, now: '2026-08-05T00:00:00.000Z' });
    expect(result.operationNodeId).toBe('generator-1');
    expect(result.project.nodes.find(node => node.id === 'generator-1')?.type).toBe('operation');
    expect(result.project.nodes.find(node => node.id === 'generator-1')?.metadata.operation?.recipe.parameters.submode).toBe('image-to-image');
    expect(result.project.connections).toEqual([{
      id: 'binding-1', fromNodeId: 'reference-1', toNodeId: 'generator-1', kind: 'operation-input', role: 'reference_image', order: 0,
    }]);
  });

  it('replaces the existing media node in place with a generate operation and keeps a hidden input node', async () => {
    const project = createWorkflowProject('重做图片');
    const source = createWorkflowNode('image-1', 'image', { x: 0, y: 0 }, {
      storageKey: 'image-1', prompt: '做成海报', status: 'success', config: { mode: 'image', modelId: 'flovart:gpt-image-2' },
    });
    project.nodes = [source];
    const ids = ['operation-1', 'binding-1'];
    const result = await ensureWorkflowImageGenerateOperation({ project, nodeId: source.id, createId: () => ids.shift()!, now: '2026-08-05T00:00:00.000Z' });
    // 原节点原位替换为 operation（id/位置不变），画布不新增可见节点
    expect(result.project.nodes).toHaveLength(2);
    const operation = result.project.nodes.find(node => node.id === 'image-1');
    expect(operation).toMatchObject({ id: 'image-1', type: 'operation', isVisible: true });
    expect(operation?.metadata.operation?.recipe.inputBindings[0]).toMatchObject({ role: 'reference_image' });
    // 原图保留为隐藏输入节点
    const hidden = result.project.nodes.find(node => node.id === 'operation-1');
    expect(hidden).toMatchObject({ type: 'image', isVisible: false, isLocked: true });
    expect(hidden?.metadata).toHaveProperty('storageKey');
    expect(result.project.connections.some(connection => connection.fromNodeId === 'operation-1' && connection.toNodeId === 'image-1')).toBe(true);
  });
});
