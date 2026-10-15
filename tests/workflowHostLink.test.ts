import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  buildWorkflowHostSendPatch,
  createWorkflowHostSourceNode,
  findWorkflowHostSourceFor,
  findWorkflowNodeForHandoff,
  listWorkflowHostClips,
  listWorkflowHostSendRequests,
  parseWorkflowHostHandoff,
  stripWorkflowHostHandoff,
  workflowHostSendEligibility,
} from '../components/workflow/hostLink';
import { applyWorkflowOps } from '../components/workflow/ops';
import { deriveWorkflowPresence } from '../components/workflow/presence';
import { StudioWorkflowController } from '../services/studio/studioWorkflow';
import type { CreativeHostAdapter, FlovartStudioCore, HostContext } from '../services/studio/studioContract';
import type { WorkflowConnection, WorkflowDraftChangeSet, WorkflowNode, WorkflowProject } from '../components/workflow/types';

const clipLocator = { projectId: 'resolve-a', timelineId: 'tl-1', timelineItemId: 'item-7' };

function clip(id = 'clip', x = 0): WorkflowNode {
  const node = createWorkflowNode(id, 'video', { x, y: 0 }, {
    name: 'Shot 04',
    resourceLocator: { kind: 'creative-host', host: 'resolve', locator: { ...clipLocator } },
  });
  node.title = 'Shot 04';
  return node;
}

function graph() {
  const source = clip();
  const prompt = createWorkflowNode('prompt', 'text', { x: 0, y: 300 }, { content: 'rain' });
  const result = createWorkflowNode('result', 'image', { x: 500, y: 0 }, { status: 'success', storageKey: 'result-key', artifactRef: { taskId: 'task-1', artifactId: 'artifact-1', kind: 'image' } });
  const loose = createWorkflowNode('loose', 'image', { x: 900, y: 0 }, { status: 'success', storageKey: 'loose-key' });
  const connections: WorkflowConnection[] = [
    { id: 'c1', fromNodeId: 'clip', toNodeId: 'result' },
    { id: 'c2', fromNodeId: 'prompt', toNodeId: 'result' },
  ];
  return { nodes: [source, prompt, result, loose], connections };
}

describe('host timeline strip', () => {
  it('projects creative-host nodes with their downstream result counts, left to right', () => {
    const base = graph();
    const second = clip('clip-2', -400);
    second.metadata.resourceLocator = { kind: 'creative-host', host: 'resolve', locator: { projectId: 'resolve-a', timelineItemId: 'item-9' } };
    const clips = listWorkflowHostClips({ ...base, nodes: [...base.nodes, second] });
    expect(clips.map(item => item.nodeId)).toEqual(['clip-2', 'clip']);
    expect(clips[1]).toMatchObject({ host: 'resolve', label: 'Shot 04', resultCount: 1, sentCount: 0 });
  });

  it('renders nothing for a project without host clips', () => {
    expect(listWorkflowHostClips({ nodes: [createWorkflowNode('a', 'image', { x: 0, y: 0 })], connections: [] })).toEqual([]);
  });

  it('finds the nearest upstream host clip, including through an operation output', () => {
    const base = graph();
    expect(findWorkflowHostSourceFor(base, 'result')?.nodeId).toBe('clip');
    expect(findWorkflowHostSourceFor(base, 'loose')).toBeNull();
  });
});

describe('send to timeline request', () => {
  it('records a frozen send request on a result that came from a host clip', () => {
    const base = graph();
    const patch = buildWorkflowHostSendPatch(base, 'result', { requestId: 'req-1', now: '2026-10-07T09:00:00.000Z' });
    expect(patch?.hostSend).toEqual({
      requestId: 'req-1', host: 'resolve', hostProjectId: 'resolve-a', sourceNodeId: 'clip',
      sourceLocator: clipLocator, target: 'media-pool', status: 'requested', requestedAt: '2026-10-07T09:00:00.000Z',
    });
  });

  it('refuses nodes without media, without a host source, the clip itself, or already requested', () => {
    const base = graph();
    expect(workflowHostSendEligibility(base, 'prompt')).toEqual({ ok: false, reason: 'no-media' });
    expect(workflowHostSendEligibility(base, 'loose')).toEqual({ ok: false, reason: 'no-host-source' });
    const withMedia = { ...base, nodes: base.nodes.map(node => node.id === 'clip' ? { ...node, metadata: { ...node.metadata, storageKey: 'clip-key' } } : node) };
    expect(workflowHostSendEligibility(withMedia, 'clip')).toEqual({ ok: false, reason: 'is-host-source' });
    const patch = buildWorkflowHostSendPatch(base, 'result', { requestId: 'req-1', now: 'now' })!;
    const requested = { ...base, nodes: base.nodes.map(node => node.id === 'result' ? { ...node, metadata: { ...node.metadata, ...patch } } : node) };
    expect(workflowHostSendEligibility(requested, 'result')).toEqual({ ok: false, reason: 'already-requested' });
    expect(listWorkflowHostSendRequests(requested, 'resolve').map(item => item.nodeId)).toEqual(['result']);
    expect(listWorkflowHostClips(requested)[0].sentCount).toBe(1);
  });

  it('a send request never touches an operation recipe (no false stale)', async () => {
    const { createWorkflowOperationNode, beginWorkflowOperationTake, completeWorkflowOperationTake } = await import('../components/workflow/operations');
    let operation = await createWorkflowOperationNode({ id: 'op', capabilityId: 'image.generate@1', position: { x: 0, y: 0 }, prompt: 'rain', parameters: { count: 1 }, now: '2026-10-07T09:00:00.000Z' });
    const begun = await beginWorkflowOperationTake(operation, { id: 't1', snapshotId: 's1', now: '2026-10-07T09:01:00.000Z' });
    operation = completeWorkflowOperationTake(begun.node, 't1', ['out'], { now: '2026-10-07T09:02:00.000Z' });
    const hash = operation.metadata.operation?.recipe.recipeHash;
    const result = applyWorkflowOps({ nodes: [operation], connections: [], selectedNodeIds: [] } as never, [{
      type: 'update_node', id: 'op', metadata: { hostSend: { requestId: 'r', host: 'resolve', sourceNodeId: 'clip', sourceLocator: {}, target: 'media-pool', status: 'requested', requestedAt: 'now' } },
    }]);
    const updated = result.snapshot.nodes[0];
    expect(updated.metadata.hostSend?.status).toBe('requested');
    expect(updated.metadata.operation?.recipe.recipeHash).toBe(hash);
  });
});

describe('Open in Iris handoff', () => {
  it('parses a whitelisted handoff and keeps other hash parameters when stripping it', () => {
    const hash = '#/app?flovartAgentUrl=x&host=resolve&label=Shot%2004&kind=video&loc.projectId=resolve-a&loc.timelineItemId=item-7';
    expect(parseWorkflowHostHandoff(hash)).toEqual({ host: 'resolve', label: 'Shot 04', kind: 'video', locator: { projectId: 'resolve-a', timelineItemId: 'item-7' } });
    expect(stripWorkflowHostHandoff(hash)).toBe('#/app?flovartAgentUrl=x');
    expect(stripWorkflowHostHandoff('#/app?host=resolve&loc.a=1')).toBe('#/app');
  });

  it('rejects handoffs with no locator, a bad host, or unsafe values', () => {
    expect(parseWorkflowHostHandoff('#/app')).toBeNull();
    expect(parseWorkflowHostHandoff('#/app?host=resolve')).toBeNull();
    expect(parseWorkflowHostHandoff('#/app?host=Resolve!&loc.a=1')).toBeNull();
    expect(parseWorkflowHostHandoff('#/app?host=resolve&loc.a=%3Cscript%3E')).toBeNull();
  });

  it('reuses an existing node for the same clip instead of adding a duplicate', () => {
    const handoff = parseWorkflowHostHandoff('#/app?host=resolve&label=Shot&loc.projectId=resolve-a&loc.timelineId=tl-1&loc.timelineItemId=item-7')!;
    expect(findWorkflowNodeForHandoff(graph(), handoff)?.id).toBe('clip');
    const other = parseWorkflowHostHandoff('#/app?host=resolve&loc.projectId=resolve-a&loc.timelineItemId=item-8')!;
    expect(findWorkflowNodeForHandoff(graph(), other)).toBeNull();
    const created = createWorkflowHostSourceNode('new', other, { x: 10, y: 20 });
    expect(created.metadata.resourceLocator).toEqual({ kind: 'creative-host', host: 'resolve', locator: { projectId: 'resolve-a', timelineItemId: 'item-8' } });
  });
});

describe('Agent presence', () => {
  function changeSet(id: string, actor: WorkflowDraftChangeSet['actor'], revision: number, nodeIds: string[], status: WorkflowDraftChangeSet['status'] = 'completed'): WorkflowDraftChangeSet {
    return {
      id, at: `2026-10-07T09:0${revision}:00.000Z`, actor, intent: `${actor} edit`, status,
      baseDraftVersion: revision - 1, resultDraftVersion: revision,
      nodeChanges: nodeIds.map(nodeId => ({ id: nodeId, after: createWorkflowNode(nodeId, 'image', { x: 0, y: 0 }) })),
      connectionChanges: [],
    } as WorkflowDraftChangeSet;
  }

  it('marks nodes whose latest change came from an Agent, and clears it after a human edit', () => {
    const nodes = ['a', 'b', 'c'].map(id => createWorkflowNode(id, 'image', { x: 0, y: 0 }));
    const presence = deriveWorkflowPresence({
      nodes,
      draftChangeSets: [changeSet('1', 'agent', 2, ['a', 'b']), changeSet('2', 'ui', 3, ['b']), changeSet('3', 'cli', 4, ['c'])],
    });
    expect(presence.get('a')).toMatchObject({ actor: 'agent', revision: 2 });
    expect(presence.has('b')).toBe(false);
    expect(presence.get('c')).toMatchObject({ actor: 'cli', revision: 4 });
  });

  it('ignores undone change sets and deleted nodes', () => {
    const nodes = [createWorkflowNode('a', 'image', { x: 0, y: 0 })];
    const presence = deriveWorkflowPresence({ nodes, draftChangeSets: [changeSet('1', 'agent', 2, ['a'], 'undone'), changeSet('2', 'agent', 3, ['gone'])] });
    expect(presence.size).toBe(0);
  });
});

describe('Resolve panel: sending a canvas result', () => {
  function setup(overrides: { hostProjectId?: string; artifactRef?: boolean } = {}) {
    const base = graph();
    const patch = buildWorkflowHostSendPatch(base, 'result', { requestId: 'req-1', now: '2026-10-07T09:00:00.000Z' })!;
    if (overrides.hostProjectId) patch.hostSend!.hostProjectId = overrides.hostProjectId;
    let project: WorkflowProject = {
      id: 'iris-1', title: 'Shots', connections: base.connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
      backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null, draftVersion: 7, createdAt: 'now', updatedAt: 'now',
      nodes: base.nodes.map(node => node.id === 'result'
        ? { ...node, metadata: { ...node.metadata, ...patch, ...(overrides.artifactRef === false ? { artifactRef: undefined } : {}) } }
        : node),
    };
    const host: CreativeHostAdapter = {
      id: 'resolve',
      getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'resolve', available: true, projectId: 'resolve-a', documentId: 'resolve-a' })),
      getSelection: vi.fn(async () => null),
      materializeSelection: vi.fn(),
      persistArtifact: vi.fn(async artifact => ({
        status: 'persisted' as const, artifactId: artifact.artifactId!, taskId: artifact.taskId,
        sha256: artifact.sha256!, byteSize: artifact.byteSize!, mimeType: artifact.mimeType, createdAt: 'now',
      })),
      importArtifact: vi.fn(async () => ({ ok: true, importStatus: 'confirmed' as const, targetId: 'media-pool' })),
    };
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project),
      selection: vi.fn(),
      registerHostResource: vi.fn(),
      apply: vi.fn(async request => {
        const op = request.operations[0] as { id: string; metadata: WorkflowNode['metadata'] };
        project = { ...project, draftVersion: (project.draftVersion || 1) + 1, nodes: project.nodes.map(node => node.id === op.id ? { ...node, metadata: { ...node.metadata, ...op.metadata } } : node) };
        return { draftVersion: project.draftVersion };
      }),
      run: vi.fn(),
      artifactGet: vi.fn(async () => ({ taskId: 'task-1', artifactId: 'artifact-1', mimeType: 'image/png', blob: new Blob(['png'], { type: 'image/png' }) })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `id-${++id}`);
    return { controller, host, core, get project() { return project; } };
  }

  it('lists pending requests for the current Resolve project only', async () => {
    expect((await setup().controller.listCanvasSendRequests()).map(item => item.nodeId)).toEqual(['result']);
    expect(await setup({ hostProjectId: 'resolve-b' }).controller.listCanvasSendRequests()).toEqual([]);
  });

  it('imports into the frozen Media Pool target and records the outcome on the node', async () => {
    const env = setup();
    const result = await env.controller.sendCanvasResult('result');
    expect(result.importStatus).toBe('confirmed');
    expect(env.host.importArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'artifact-1', sha256: expect.any(String) }),
      expect.objectContaining({ kind: 'media-pool', projectId: 'resolve-a', sourceSelectionId: 'clip' }),
      expect.objectContaining({ status: 'persisted' }),
    );
    expect(env.project.nodes.find(node => node.id === 'result')?.metadata.hostSend?.status).toBe('imported');
    expect(await env.controller.listCanvasSendRequests()).toEqual([]);
  });

  it('refuses to import into a different Resolve project or without a runtime artifact', async () => {
    await expect(setup({ hostProjectId: 'resolve-b' }).controller.sendCanvasResult('result')).rejects.toThrow('另一个 Resolve 项目');
    await expect(setup({ artifactRef: false }).controller.sendCanvasResult('result')).rejects.toThrow('可交接的运行产物');
  });
});
