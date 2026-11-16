import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDispatcher, withWorkflowHumanApproval, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { extractMentions } from '../components/MediaMentionExtension';
import { buildCanonicalGenerationInput, resolveWorkflowInputs } from '../components/workflow/inputResolver';
import { getOrderedImageReferences } from '../components/workflow/references';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { collectWorkflowRunOutputNodes } from '../services/workflowRunOutputs';
import type { WorkflowProject } from '../components/workflow/types';
import type { UserApiKey } from '../types';

const rhVideoKey: UserApiKey = {
  id: 'rh',
  provider: 'runningHub',
  capabilities: ['video'],
  key: 'secret',
  models: [],
  routeMappings: (['text-to-video', 'image-to-video'] as const).map(mode => ({
    target: { kind: 'product-mode' as const, productModelId: 'flovart:veo-3.1', mode },
    routeId: `rhart-video-v3.1-fast/${mode}`,
    order: 0,
  })),
  createdAt: 1,
  updatedAt: 1,
};

const setup = (options: { runNode?: ReturnType<typeof vi.fn>; keys?: UserApiKey[] } = {}) => {
  let projects: WorkflowProject[] = [createWorkflowProject('生成')];
  projects[0].nodes = [
    { ...createWorkflowNode('img-a', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png', storageKey: 'a', mimeType: 'image/png' }), title: '女主' },
    createWorkflowNode('img-b', 'image', { x: 0, y: 400 }, { href: 'https://cdn.example.com/b.png', storageKey: 'b', mimeType: 'image/png' }),
    createWorkflowNode('note-1', 'text', { x: 0, y: 800 }, { content: '导演备注' }),
  ];
  let activeProjectId: string | null = projects[0].id;
  const runNode = options.runNode || vi.fn();
  const dependencies: WorkflowDispatcherDependencies = {
    getState: () => ({ projects, activeProjectId }),
    createProject: () => { throw new Error('unused'); },
    setActiveProject: id => { activeProjectId = id; },
    deleteProjects: () => {},
    updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
    executor: createWorkflowExecutor({ runNode: runNode as Parameters<typeof createWorkflowExecutor>[0]['runNode'], stopNode: vi.fn() }, { createRunId: () => 'run-1' }),
    getUserApiKeys: () => options.keys || [],
  };
  const project = () => dependencies.getState().projects[0];
  return { dispatch: createWorkflowDispatcher(dependencies), project, runNode };
};

describe('workflow.generate', () => {
  it('creates exactly one generation node with the prompt, @chips and connections in its Prompt Bar', async () => {
    const { dispatch, project } = setup();
    const result = await dispatch({
      id: 'gen', command: 'workflow.generate', source: 'agent', idempotencyKey: 'gen-1',
      args: { type: 'image', title: '海报', prompt: '让 @ref:img-a 站在 @图片2 的街景里', references: ['img-a', 'img-b'] },
    });
    expect(result.ok).toBe(true);
    const body = result.result as { nodeId: string; created: boolean; model: { submode: string }; references: Array<{ nodeId: string; label: string; mentioned: boolean }>; ran: boolean };
    expect(body).toMatchObject({ created: true, ran: false, model: { submode: 'image-to-image' } });
    expect(body.references).toEqual([
      expect.objectContaining({ nodeId: 'img-a', label: '图片1', mentioned: true }),
      expect.objectContaining({ nodeId: 'img-b', label: '图片2', mentioned: true }),
    ]);
    const after = project();
    const created = after.nodes.filter(node => !['img-a', 'img-b', 'note-1'].includes(node.id));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ id: body.nodeId, type: 'image', title: '海报' });
    expect(after.nodes.filter(node => node.type === 'text')).toHaveLength(1);
    expect(created[0].metadata.prompt).toBe('让 @图片1 站在 @图片2 的街景里');
    expect(extractMentions(created[0].metadata.richTextDocument!).map(item => item.id)).toEqual(['img-a', 'img-b']);
    expect(created[0].metadata.config).toMatchObject({ mode: 'image', submode: 'image-to-image' });
    expect(after.connections.filter(connection => connection.toNodeId === body.nodeId).map(connection => connection.fromNodeId)).toEqual(['img-a', 'img-b']);
    expect(after.draftChangeSets?.at(-1)?.actor).toBe('agent');
  });

  it('reuses a node, follows references order and passes first/last frame roles to the executor', async () => {
    const runNode = vi.fn().mockResolvedValue({
      outputs: { batchId: 'b1', headNodeId: 'vid-1', nodeIds: ['vid-1', 'vid-2'], artifacts: [
        { nodeId: 'vid-1', artifactId: 'run-1', kind: 'video', mimeType: 'video/mp4' },
        { nodeId: 'vid-2', artifactId: 'run-1:1', kind: 'video', mimeType: 'video/mp4' },
      ] },
      artifact: { artifactId: 'run-1', kind: 'video', mimeType: 'video/mp4' },
    });
    const { dispatch, project } = setup({ runNode, keys: [rhVideoKey] });
    const current = project();
    current.nodes.push(createWorkflowNode('vid-1', 'video', { x: 600, y: 0 }));
    current.connections.push({ id: 'old', fromNodeId: 'img-b', toNodeId: 'vid-1' });
    const args = { nodeId: 'vid-1', prompt: '从首帧过渡到尾帧', references: [{ nodeId: 'img-a', role: 'first_frame' }, { nodeId: 'img-b', role: 'last_frame' }], run: true };

    const gated = await dispatch({ id: 'gen-run', command: 'workflow.generate', source: 'agent', idempotencyKey: 'gen-run', args });
    expect(gated.confirmation?.required).toBe(true);
    expect(runNode).not.toHaveBeenCalled();

    const result = await dispatch(withWorkflowHumanApproval({ id: 'gen-run', command: 'workflow.generate', source: 'agent', idempotencyKey: 'gen-run-approved', args }));
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const after = project();
    expect(after.connections.filter(connection => connection.toNodeId === 'vid-1').map(connection => connection.fromNodeId)).toEqual(['img-a', 'img-b']);
    const target = after.nodes.find(node => node.id === 'vid-1')!;
    expect(target.metadata.config).toMatchObject({ mode: 'video', submode: 'first-last-frame', modelId: expect.any(String) });
    expect(getOrderedImageReferences(target, after.nodes, after.connections).map(node => node.id)).toEqual(['img-a', 'img-b']);
    const [command] = runNode.mock.calls[0];
    expect(command.promptIntent.mentions).toEqual([
      expect.objectContaining({ id: 'img-a', role: 'first_frame' }),
      expect.objectContaining({ id: 'img-b', role: 'last_frame' }),
    ]);
    const inputs = resolveWorkflowInputs(target, after.nodes, after.connections, { promptIntent: command.promptIntent });
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: target.metadata.prompt || '', mode: 'video', submode: 'first-last-frame' });
    expect(canonical.references.map(reference => reference.role)).toEqual(['first_frame', 'last_frame']);
    expect(result.result).toMatchObject({
      ran: true,
      run: {
        runId: 'run-1',
        batch: { batchId: 'b1', headNodeId: 'vid-1', memberNodeIds: ['vid-1', 'vid-2'] },
        takes: [{ nodeId: 'vid-1', artifactId: 'run-1' }, { nodeId: 'vid-2', artifactId: 'run-1:1' }],
      },
    });
  });

  it('never targets or references a text note', async () => {
    const { dispatch, project } = setup();
    const onNote = await dispatch({ id: 'n1', command: 'workflow.generate', source: 'agent', args: { nodeId: 'note-1', prompt: 'x' } });
    expect(onNote.error?.code).toBe('NOTE_IS_ANNOTATION');
    const fromNote = await dispatch({ id: 'n2', command: 'workflow.generate', source: 'agent', args: { type: 'image', prompt: 'x', references: ['note-1'] } });
    expect(fromNote.error?.code).toBe('NOTE_IS_ANNOTATION');
    const asText = await dispatch({ id: 'n3', command: 'workflow.generate', source: 'agent', args: { type: 'text', prompt: 'x' } });
    expect(asText.error?.message).toMatch(/备注/);
    expect(project().nodes).toHaveLength(3);
  });

  it('reports an incompatible model with the models that would work instead of downgrading', async () => {
    const { dispatch, project } = setup();
    const result = await dispatch({ id: 'bad', command: 'workflow.generate', source: 'agent', args: { type: 'image', prompt: '改成水彩', references: ['img-a'], modelId: 'flovart:imagen-4' } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('MODE_UNSUPPORTED');
    const compatible = (result.error?.details?.compatibleModels || []) as Array<{ id: string }>;
    expect(compatible.length).toBeGreaterThan(0);
    expect(compatible.map(item => item.id)).not.toContain('flovart:imagen-4');
    expect(project().nodes).toHaveLength(3);
  });

  it('rejects an out-of-range reference count before writing, with (modelId, mode) candidates', async () => {
    const { dispatch, project } = setup();
    const result = await dispatch({ id: 'cnt', command: 'workflow.generate', source: 'agent', args: { type: 'video', prompt: '首尾帧过渡', references: ['img-a'], submode: 'first-last-frame', modelId: 'flovart:seedance-2' } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('REFERENCE_COUNT_OUT_OF_RANGE');
    expect(result.error?.details).toMatchObject({ mode: 'first-last-frame', kind: 'image', min: 2, max: 2, got: 1 });
    const candidates = (result.error?.details?.candidates || []) as Array<{ modelId: string; mode: string }>;
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some(item => item.mode === 'first-last-frame')).toBe(false);
    expect(project().nodes).toHaveLength(3);
  });

  it('lists min/max reference counts per mode', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'ml', command: 'workflow.models.list', source: 'agent', args: { mode: 'video', includeUnavailable: true } });
    const models = (result.result as { models: Array<{ id: string; modes: Array<{ mode: string; minReferences: Record<string, number>; requires: string[] }> }> }).models;
    const fl = models.find(model => model.id === 'flovart:seedance-2')?.modes.find(mode => mode.mode === 'first-last-frame');
    expect(fl).toMatchObject({ minReferences: { image: 2 }, requires: ['media'] });
  });

  it('auto-links nodes mentioned by @"name" and reports them; rejects ambiguous names', async () => {
    const { dispatch, project } = setup();
    const result = await dispatch({ id: 'al', command: 'workflow.generate', source: 'agent', args: { type: 'image', prompt: '让 @"女主" 换成水彩风', modelId: 'flovart:gemini-3-pro-image' } });
    expect(result.ok).toBe(true);
    const body = result.result as { nodeId: string; autoLinked: string[]; references: Array<{ nodeId: string; mentioned: boolean }> };
    expect(body.autoLinked).toEqual(['img-a']);
    expect(body.references).toMatchObject([{ nodeId: 'img-a', mentioned: true }]);
    expect(project().connections.some(connection => connection.fromNodeId === 'img-a' && connection.toNodeId === body.nodeId)).toBe(true);
    const rejected = await dispatch({ id: 'rj', command: 'workflow.generate', source: 'agent', args: { type: 'image', prompt: '参考 @ref:img-b', linkPolicy: 'reject' } });
    expect(rejected.error?.code).toBe('REFERENCE_NOT_LINKED');
  });

  it('clears the @chip in the downstream Prompt Bar when its connection is removed, and says so', async () => {
    const { dispatch, project } = setup();
    const generated = await dispatch({ id: 'g2', command: 'workflow.generate', source: 'agent', args: { type: 'image', prompt: '把 @ref:img-a 放进 @ref:img-b', references: ['img-a', 'img-b'] } });
    const nodeId = (generated.result as { nodeId: string }).nodeId;
    const connection = project().connections.find(item => item.fromNodeId === 'img-a' && item.toNodeId === nodeId)!;
    const result = await dispatch({ id: 'dc', command: 'workflow.disconnect', source: 'agent', args: { connectionId: connection.id } });
    expect(result.ok).toBe(true);
    expect((result.result as { prunedMentions: unknown[] }).prunedMentions).toMatchObject([{ nodeId, removedReferenceIds: ['img-a'] }]);
    const node = project().nodes.find(item => item.id === nodeId)!;
    expect(JSON.stringify(node.metadata.richTextDocument)).not.toContain('"img-a"');
  });

  it('dry-runs without touching the canvas and replays the same key without duplicating', async () => {
    const { dispatch, project } = setup();
    const dry = await dispatch({ id: 'dry', command: 'workflow.generate', source: 'cli', args: { type: 'video', prompt: '慢推', references: ['img-a'], dryRun: true } });
    expect(dry.result).toMatchObject({ dryRun: true, applied: false, model: { submode: 'image-to-video' } });
    expect(project().nodes).toHaveLength(3);
    const envelope = { id: 'g', command: 'workflow.generate', source: 'cli' as const, idempotencyKey: 'same-key', args: { type: 'image', prompt: '主视觉' } };
    const first = await dispatch(envelope);
    const second = await dispatch({ ...envelope, id: 'g2' });
    expect(second.result).toEqual(first.result);
    expect(project().nodes).toHaveLength(4);
  });
});

describe('workflow.note.write', () => {
  it('writes a note beside a node without any connection, and updates it in place', async () => {
    const { dispatch, project } = setup();
    const created = await dispatch({ id: 'note', command: 'workflow.note.write', source: 'agent', idempotencyKey: 'note-a', args: { text: '这张是女主定妆', attachToNodeId: 'img-a', placement: 'right' } });
    expect(created.ok).toBe(true);
    const noteId = (created.result as { noteId: string }).noteId;
    const note = project().nodes.find(node => node.id === noteId)!;
    expect(note).toMatchObject({ type: 'text', metadata: expect.objectContaining({ content: '这张是女主定妆' }) });
    const anchor = project().nodes.find(node => node.id === 'img-a')!;
    expect(note.position.x).toBeGreaterThan(anchor.position.x + anchor.width);
    expect(project().connections.some(connection => connection.fromNodeId === noteId || connection.toNodeId === noteId)).toBe(false);

    const updated = await dispatch({ id: 'note-2', command: 'workflow.note.write', source: 'agent', idempotencyKey: 'note-b', args: { noteId, text: '改：女主定妆 v2' } });
    expect(updated.ok).toBe(true);
    expect(project().nodes.find(node => node.id === noteId)?.metadata.content).toBe('改：女主定妆 v2');
    const wrong = await dispatch({ id: 'note-3', command: 'workflow.note.write', source: 'agent', args: { noteId: 'img-a', text: 'x' } });
    expect(wrong.ok).toBe(false);
  });

  it('rejects text nodes created by Agents through the generic write paths but not by the canvas UI', async () => {
    const { dispatch, project } = setup();
    const viaCreate = await dispatch({ id: 't1', command: 'workflow.node.create', source: 'agent', args: { type: 'text', title: '脚本' } });
    expect(viaCreate.error?.code).toBe('NOTE_IS_ANNOTATION');
    const viaApply = await dispatch({ id: 't2', command: 'workflow.apply', source: 'cli', args: {
      projectId: project().id, expectedRevision: project().draftVersion || 1, mutationId: 'm-text',
      operations: [{ type: 'add_node', node: createWorkflowNode('prompt-node', 'text', { x: 0, y: 0 }, { content: '提示词' }) }],
    } });
    expect(viaApply.error?.code).toBe('NOTE_IS_ANNOTATION');
    const missingType = await dispatch({ id: 't3', command: 'workflow.node.create', source: 'cli', args: { title: '无类型' } });
    expect(missingType.error?.message).toMatch(/type 不能为空/);
    const fromUi = await dispatch({ id: 't4', command: 'workflow.node.create', source: 'ui', args: { type: 'text', title: '用户备注' } });
    expect(fromUi.ok).toBe(true);
  });
});

describe('workflow.models.list', () => {
  it('lists live capabilities and marks only routable modes as configured', async () => {
    const { dispatch } = setup({ keys: [rhVideoKey] });
    const result = await dispatch({ id: 'models', command: 'workflow.models.list', source: 'agent', args: { mode: 'video' } });
    expect(result.ok).toBe(true);
    const body = result.result as { models: Array<{ id: string; available: boolean; isDefault: boolean; modes: Array<{ mode: string; configured: boolean; maxReferences: { image: number } }> }>; defaultModelIds: Record<string, string> };
    expect(body.models.every(model => model.available)).toBe(true);
    const veo = body.models.find(model => model.id === 'flovart:veo-3.1')!;
    expect(veo.isDefault).toBe(true);
    expect(veo.modes.find(mode => mode.mode === 'image-to-video')).toMatchObject({ configured: true, maxReferences: { image: 1 } });
    expect(veo.modes.find(mode => mode.mode === 'first-last-frame')?.configured).toBe(false);
    expect(body.defaultModelIds.video).toBe('flovart:veo-3.1');
  });

  it('falls back to every candidate with a note when no key is configured, and filters by mode', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'models', command: 'workflow.models.list', source: 'agent', args: { mode: 'video', submode: 'first-last-frame' } });
    const body = result.result as { models: Array<{ available: boolean; modes: Array<{ mode: string }> }>; note?: string };
    expect(body.note).toBeTruthy();
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models.every(model => !model.available && model.modes.some(mode => mode.mode === 'first-last-frame'))).toBe(true);
  });
});

describe('workflow.media.import and node.stop', () => {
  it('imports a URL as a media node attached to a generation node with an @chip', async () => {
    const { dispatch, project } = setup();
    project().nodes.push(createWorkflowNode('vid-1', 'video', { x: 600, y: 0 }, { prompt: '慢推' }));
    const commit = vi.fn();
    const deps = await import('../services/workflowDispatcher');
    let state = project();
    const dispatchWithImport = deps.createWorkflowDispatcher({
      getState: () => ({ projects: [state], activeProjectId: state.id }),
      createProject: () => '',
      setActiveProject: () => {},
      deleteProjects: () => {},
      updateProject: (_id, patch) => { state = { ...state, ...patch }; },
      importMediaUrl: async () => ({ type: 'image', metadata: { storageKey: 'imported', mimeType: 'image/png', status: 'success' }, width: 300, height: 200, commit }),
    });
    const result = await dispatchWithImport({ id: 'imp', command: 'workflow.media.import', source: 'agent', idempotencyKey: 'imp-1', args: { url: 'https://cdn.example.com/ref.png', attachToNodeId: 'vid-1' } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const nodeId = (result.result as { nodeId: string }).nodeId;
    expect(commit).toHaveBeenCalled();
    expect(state.connections).toContainEqual(expect.objectContaining({ fromNodeId: nodeId, toNodeId: 'vid-1' }));
    const target = state.nodes.find(node => node.id === 'vid-1')!;
    expect(extractMentions(target.metadata.richTextDocument!).map(item => item.id)).toEqual([nodeId]);
    expect(target.metadata.prompt).toBe('慢推 @图片1');
    void dispatch;
  });

  it('stops a running node through the public surface', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'stop', command: 'workflow.node.stop', source: 'agent', args: { nodeId: 'img-a' } });
    expect(result.ok).toBe(true);
  });
});

describe('collectWorkflowRunOutputNodes', () => {
  it('returns the in-place cover plus every batch member in batch order', () => {
    const before = { nodes: [createWorkflowNode('n1', 'image', { x: 0, y: 0 })] };
    const head = { ...createWorkflowNode('n1', 'image', { x: 0, y: 0 }, { storageKey: 's0' }), batchId: 'b', batchIndex: 0 };
    const second = { ...createWorkflowNode('n2', 'image', { x: 0, y: 0 }, { storageKey: 's1' }), batchId: 'b', batchIndex: 2 };
    const first = { ...createWorkflowNode('n3', 'image', { x: 0, y: 0 }, { storageKey: 's2' }), batchId: 'b', batchIndex: 1 };
    expect(collectWorkflowRunOutputNodes(before, { nodes: [head, second, first], connections: [] }, 'n1')).toEqual({ batchId: 'b', headNodeId: 'n1', nodeIds: ['n1', 'n3', 'n2'] });
  });

  it('reports a detached result node when the user replaced the source media mid-run', () => {
    const before = { nodes: [createWorkflowNode('n1', 'image', { x: 0, y: 0 }, { storageKey: 'user' })] };
    const result = createWorkflowNode('r1', 'image', { x: 400, y: 0 }, { storageKey: 'gen' });
    expect(collectWorkflowRunOutputNodes(before, { nodes: [{ ...before.nodes[0] }, result], connections: [{ id: 'c', fromNodeId: 'n1', toNodeId: 'r1' }] }, 'n1')?.nodeIds).toEqual(['r1']);
  });
});

describe('workflow.apply reorder_connections', () => {
  it('reorders a node\'s references by source ids as undoable reconnects', async () => {
    const { dispatch, project } = setup();
    project().nodes.push(createWorkflowNode('vid-1', 'video', { x: 600, y: 0 }));
    project().connections.push({ id: 'c-b', fromNodeId: 'img-b', toNodeId: 'vid-1' }, { id: 'c-a', fromNodeId: 'img-a', toNodeId: 'vid-1' });
    const result = await dispatch({ id: 'r', command: 'workflow.apply', source: 'agent', args: {
      projectId: project().id, expectedRevision: project().draftVersion || 1, mutationId: 'reorder-1',
      operations: [{ type: 'reorder_connections', targetNodeId: 'vid-1', orderedSourceIds: ['img-a', 'img-b'] }],
    } });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    const target = project().nodes.find(node => node.id === 'vid-1')!;
    expect(getOrderedImageReferences(target, project().nodes, project().connections).map(node => node.id)).toEqual(['img-a', 'img-b']);
    expect(project().draftChangeSets?.at(-1)?.connectionChanges.length).toBeGreaterThan(0);
    const stray = await dispatch({ id: 'r2', command: 'workflow.apply', source: 'agent', args: {
      projectId: project().id, expectedRevision: project().draftVersion || 1, mutationId: 'reorder-2',
      operations: [{ type: 'reorder_connections', targetNodeId: 'vid-1', orderedSourceIds: ['note-1'] }],
    } });
    expect(stray.ok).toBe(false);
  });
});
