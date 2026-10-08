import { describe, expect, it } from 'vitest';
import {
  beginWorkflowOperationTake,
  completeWorkflowOperationTake,
  createWorkflowOperationInputBinding,
  createWorkflowOperationNode,
  isWorkflowOperationTakeSelectable,
  listWorkflowOperationVersions,
  selectWorkflowOperationTake,
  updateWorkflowOperationRecipe,
  workflowOperationInputConnections,
} from '../components/workflow/operations';
import { createWorkflowNode } from '../components/workflow/constants';
import { deriveWorkflowRunStates, planWorkflowStaleRerun } from '../components/workflow/runState';
import { collectWorkflowMediaKeys } from '../components/workflow/media';
import type { WorkflowConnection, WorkflowNode } from '../components/workflow/types';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 9, minute)).toISOString();

async function runTake(node: WorkflowNode, takeId: string, outputs: string[], started: number, finished: number) {
  const begun = await beginWorkflowOperationTake(node, { id: takeId, snapshotId: `snapshot-${takeId}`, now: at(started) });
  return completeWorkflowOperationTake(begun.node, takeId, outputs, { now: at(finished) });
}

function output(id: string, operationId: string): WorkflowNode {
  return createWorkflowNode(id, 'image', { x: 0, y: 0 }, { status: 'success', sourceOperationNodeId: operationId, storageKey: `${id}-key` });
}

/** source → crop(A) → A-out → upscale(B) → B-out */
async function chain() {
  const source = createWorkflowNode('source', 'image', { x: 0, y: 0 }, { status: 'success', storageKey: 'source-key' });
  let crop = await createWorkflowOperationNode({
    id: 'crop', capabilityId: 'image.crop@1', position: { x: 300, y: 0 },
    parameters: { x: .1, y: .1, width: .8, height: .8 },
    inputBindings: [createWorkflowOperationInputBinding('bind-crop', 'source', 'source_image', 0)], now: at(0),
  });
  crop = await runTake(crop, 'crop-1', ['crop-out'], 1, 2);
  let upscale = await createWorkflowOperationNode({
    id: 'upscale', capabilityId: 'image.upscale@1', position: { x: 600, y: 0 },
    parameters: { targetLongEdge: 2048, algorithm: 'high' },
    inputBindings: [createWorkflowOperationInputBinding('bind-up', 'crop-out', 'source_image', 0)], now: at(0),
  });
  upscale = await runTake(upscale, 'up-1', ['up-out'], 3, 4);
  const outputEdges: WorkflowConnection[] = [
    { id: 'crop-output', fromNodeId: 'crop', toNodeId: 'crop-out', kind: 'operation-output' },
    { id: 'up-output', fromNodeId: 'upscale', toNodeId: 'up-out', kind: 'operation-output' },
  ];
  const nodes = [source, crop, output('crop-out', 'crop'), upscale, output('up-out', 'upscale')];
  const connections = [...workflowOperationInputConnections(crop), ...workflowOperationInputConnections(upscale), ...outputEdges];
  return { nodes, connections };
}

const replace = (nodes: WorkflowNode[], next: WorkflowNode) => nodes.map(node => node.id === next.id ? next : node);

describe('derived workflow run state', () => {
  it('reports a freshly run chain as done, with no stale nodes', async () => {
    const graph = await chain();
    const states = deriveWorkflowRunStates(graph);
    expect([...states.values()].every(info => info.state === 'done')).toBe(true);
  });

  it('marks the edited node and everything downstream stale, leaving upstream untouched', async () => {
    const graph = await chain();
    const crop = graph.nodes.find(node => node.id === 'crop')!;
    const edited = updateWorkflowOperationRecipe(crop, { parameters: { x: 0, y: 0, width: .5, height: .5 }, now: at(5) });
    const states = deriveWorkflowRunStates({ ...graph, nodes: replace(graph.nodes, edited) });
    expect(states.get('source')).toEqual({ state: 'done' });
    expect(states.get('crop')).toEqual({ state: 'stale', reason: 'recipe-edited' });
    expect(states.get('crop-out')).toEqual({ state: 'stale', reason: 'recipe-edited' });
    expect(states.get('upscale')).toEqual({ state: 'stale', reason: 'upstream-stale' });
    expect(states.get('up-out')).toEqual({ state: 'stale', reason: 'upstream-stale' });
  });

  it('editing a downstream node never makes its upstream stale', async () => {
    const graph = await chain();
    const upscale = graph.nodes.find(node => node.id === 'upscale')!;
    const edited = updateWorkflowOperationRecipe(upscale, { parameters: { targetLongEdge: 4096, algorithm: 'high' }, now: at(5) });
    const states = deriveWorkflowRunStates({ ...graph, nodes: replace(graph.nodes, edited) });
    expect(states.get('crop')?.state).toBe('done');
    expect(states.get('crop-out')?.state).toBe('done');
    expect(states.get('upscale')?.state).toBe('stale');
  });

  it('after re-running the edited upstream, only the downstream stays stale', async () => {
    const graph = await chain();
    const crop = graph.nodes.find(node => node.id === 'crop')!;
    const edited = updateWorkflowOperationRecipe(crop, { parameters: { x: 0, y: 0, width: .5, height: .5 }, now: at(5) });
    const rerun = await runTake(edited, 'crop-2', ['crop-out'], 6, 7);
    const states = deriveWorkflowRunStates({ ...graph, nodes: replace(graph.nodes, rerun) });
    expect(states.get('crop')).toEqual({ state: 'done' });
    expect(states.get('upscale')).toEqual({ state: 'stale', reason: 'upstream-newer' });
    expect(states.get('up-out')).toEqual({ state: 'stale', reason: 'upstream-newer' });
  });

  it('plans a selective rerun of only the stale operations, upstream first', async () => {
    const graph = await chain();
    const crop = graph.nodes.find(node => node.id === 'crop')!;
    const edited = updateWorkflowOperationRecipe(crop, { parameters: { x: 0, y: 0, width: .5, height: .5 }, now: at(5) });
    expect(planWorkflowStaleRerun({ ...graph, nodes: replace(graph.nodes, edited) })).toEqual(['crop', 'upscale']);
    const upscale = graph.nodes.find(node => node.id === 'upscale')!;
    const downstreamOnly = updateWorkflowOperationRecipe(upscale, { parameters: { targetLongEdge: 4096, algorithm: 'high' }, now: at(5) });
    expect(planWorkflowStaleRerun({ ...graph, nodes: replace(graph.nodes, downstreamOnly) })).toEqual(['upscale']);
    expect(planWorkflowStaleRerun(graph)).toEqual([]);
  });

  it('keeps running and failed nodes in their own state', async () => {
    const graph = await chain();
    const upscale = graph.nodes.find(node => node.id === 'upscale')!;
    const crop = graph.nodes.find(node => node.id === 'crop')!;
    const edited = updateWorkflowOperationRecipe(crop, { parameters: { x: 0, y: 0, width: .5, height: .5 }, now: at(5) });
    const running = { ...upscale, metadata: { ...upscale.metadata, status: 'loading' as const } };
    const states = deriveWorkflowRunStates({ ...graph, nodes: replace(replace(graph.nodes, edited), running) });
    expect(states.get('upscale')).toEqual({ state: 'running' });
  });

  it('does not loop on a cyclic graph', async () => {
    const graph = await chain();
    const cyclic = [...graph.connections, { id: 'back', fromNodeId: 'up-out', toNodeId: 'crop' }];
    expect(() => deriveWorkflowRunStates({ ...graph, connections: cyclic })).not.toThrow();
  });
});

describe('operation versions and explicit selection', () => {
  async function twoTakes() {
    let node = await createWorkflowOperationNode({
      id: 'crop', capabilityId: 'image.crop@1', position: { x: 0, y: 0 },
      parameters: { x: .1, y: .1, width: .8, height: .8 },
      inputBindings: [createWorkflowOperationInputBinding('bind', 'source', 'source_image', 0)], now: at(0),
    });
    node = await runTake(node, 'take-1', ['out-1'], 1, 2);
    node = await runTake(node, 'take-2', ['out-2'], 3, 4);
    return node;
  }

  it('follows the newest result until the user explicitly chooses one', async () => {
    const node = await twoTakes();
    expect(node.metadata.operation?.selectedTakeId).toBe('take-2');
    expect(listWorkflowOperationVersions(node).map(version => [version.label, version.selected])).toEqual([['v1', false], ['v2', true]]);
  });

  it('a late result is kept as a new version and never replaces an explicit choice', async () => {
    let node = await twoTakes();
    node = selectWorkflowOperationTake(node, 'take-1');
    expect(node.metadata.operation).toMatchObject({ selectedTakeId: 'take-1', selectedTakeSource: 'explicit' });
    node = await runTake(node, 'take-3', ['out-3'], 5, 6);
    expect(node.metadata.operation?.selectedTakeId).toBe('take-1');
    const versions = listWorkflowOperationVersions(node);
    expect(versions.map(version => version.label)).toEqual(['v1', 'v2', 'v3']);
    expect(versions.find(version => version.latest)).toMatchObject({ label: 'v3', selected: false });
  });

  it('ignores selection of a missing, failed or in-place take', async () => {
    const node = await twoTakes();
    expect(selectWorkflowOperationTake(node, 'nope')).toBe(node);
    const inPlace = { ...node.metadata.operation!.takes[0], outputNodeIds: [node.id] };
    expect(isWorkflowOperationTakeSelectable(node, inPlace)).toBe(false);
    const failed = { ...node.metadata.operation!.takes[0], status: 'error' as const };
    expect(isWorkflowOperationTakeSelectable(node, failed)).toBe(false);
  });

  it('an explicit choice does not make the node stale', async () => {
    const node = selectWorkflowOperationTake(await twoTakes(), 'take-1');
    const states = deriveWorkflowRunStates({ nodes: [node], connections: [] });
    expect(states.get('crop')?.state).toBe('done');
  });

  it('in-place results keep their media per take, so an older version can be selected again', async () => {
    let node = await createWorkflowOperationNode({ id: 'gen', capabilityId: 'image.generate@1', position: { x: 0, y: 0 }, prompt: 'rain', parameters: { count: 1 }, now: at(0) });
    for (const [index, key] of ['key-1', 'key-2'].entries()) {
      const begun = await beginWorkflowOperationTake(node, { id: `t${index + 1}`, snapshotId: `s${index + 1}`, now: at(index * 2 + 1) });
      node = completeWorkflowOperationTake(begun.node, `t${index + 1}`, ['gen'], { now: at(index * 2 + 2), outputMedia: { storageKey: key, mimeType: 'image/png', naturalWidth: 10, naturalHeight: 10 } });
      node = { ...node, metadata: { ...node.metadata, storageKey: key } };
    }
    expect(listWorkflowOperationVersions(node).every(version => version.selectable)).toBe(true);
    const back = selectWorkflowOperationTake(node, 't1');
    expect(back.metadata).toMatchObject({ storageKey: 'key-1', operationTakeId: 't1' });
    expect([...collectWorkflowMediaKeys([{ nodes: [back] }])].sort()).toEqual(['key-1', 'key-2']);
  });

  it('a late in-place result keeps showing the version the user chose', async () => {
    const { applySelectedTakeMedia } = await import('../components/workflow/operations');
    let node = await createWorkflowOperationNode({ id: 'gen', capabilityId: 'image.generate@1', position: { x: 0, y: 0 }, prompt: 'rain', parameters: { count: 1 }, now: at(0) });
    for (const [index, key] of ['key-1', 'key-2'].entries()) {
      const begun = await beginWorkflowOperationTake(node, { id: `t${index + 1}`, snapshotId: `s${index + 1}`, now: at(index * 2 + 1) });
      node = completeWorkflowOperationTake(begun.node, `t${index + 1}`, ['gen'], { now: at(index * 2 + 2), outputMedia: { storageKey: key } });
    }
    node = selectWorkflowOperationTake(node, 't1');
    const begun = await beginWorkflowOperationTake(node, { id: 't3', snapshotId: 's3', now: at(9) });
    const late = completeWorkflowOperationTake(begun.node, 't3', ['gen'], { now: at(10), outputMedia: { storageKey: 'key-3' } });
    const written = applySelectedTakeMedia({ ...late, metadata: { ...late.metadata, storageKey: 'key-3' } });
    expect(written.metadata.storageKey).toBe('key-1');
    expect(written.metadata.operation?.selectedTakeId).toBe('t1');
    expect(listWorkflowOperationVersions(written).map(version => version.label)).toEqual(['v1', 'v2', 'v3']);
  });
});
