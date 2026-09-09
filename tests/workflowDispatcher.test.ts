import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDispatcher, withWorkflowHumanApproval, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';
import { undoWorkflowDraftChangeSet } from '../components/workflow/draftAuthority';
import { buildCanonicalGenerationInput, resolveWorkflowInputs } from '../components/workflow/inputResolver';
import { createWorkflowExecutor, WorkflowExecutionError } from '../services/workflowExecutor';

const setup = (executor = createWorkflowExecutor({ runNode: vi.fn(), stopNode: vi.fn() })) => {
  let projects = [createWorkflowProject('测试')];
  projects[0].nodes = [createWorkflowNode('image-1', 'image', { x: 0, y: 0 }, { href: 'data:image/png;base64,SECRET', mimeType: 'image/png' })];
  projects[0].nodes[0].metadata.storageKey = 'workflow-media/private-key';
  let activeProjectId = projects[0].id;
  const dependencies: WorkflowDispatcherDependencies = {
    getState: () => ({ projects, activeProjectId }),
    createProject: title => {
      const project = createWorkflowProject(title);
      projects = [project, ...projects];
      activeProjectId = project.id;
      return project.id;
    },
    setActiveProject: id => { activeProjectId = id; },
    deleteProjects: ids => { projects = projects.filter(project => !ids.includes(project.id)); },
    updateProject: (id, patch) => { projects = projects.map(project => project.id === id ? { ...project, ...patch } : project); },
    executor,
  };
  return { dispatch: createWorkflowDispatcher(dependencies), dependencies, executor };
};

describe('workflow dispatcher', () => {
  it('returns redacted project snapshots', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'read', command: 'workflow.inspect', args: {}, source: 'agent' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.result)).not.toContain('base64,SECRET');
    expect(JSON.stringify(result.result)).not.toContain('private-key');
  });

  it('reads the current selection without changing document revision or exposing media', async () => {
    const { dispatch, dependencies } = setup();
    const project = dependencies.getState().projects[0];
    project.selectedNodeIds = ['image-1', 'missing-node'];
    const beforeRevision = project.draftVersion;
    const result = await dispatch({ id: 'selection', command: 'workflow.selection.get', args: {}, source: 'agent' });

    expect(result).toMatchObject({
      ok: true,
      result: {
        projectId: project.id,
        selectedNodeIds: ['image-1'],
        nodes: [expect.objectContaining({ id: 'image-1' })],
        draftVersion: beforeRevision,
      },
    });
    expect(JSON.stringify(result.result)).not.toContain('base64,SECRET');
    expect(JSON.stringify(result.result)).not.toContain('private-key');
    expect(dependencies.getState().projects[0].draftVersion).toBe(beforeRevision);
  });

  it('does not cache selection reads under a reused Agent turn key', async () => {
    const { dispatch, dependencies } = setup();
    const project = dependencies.getState().projects[0];
    project.selectedNodeIds = ['image-1'];
    const first = await dispatch({ id: 'selection-1', command: 'workflow.selection.get', args: {}, source: 'agent', idempotencyKey: 'turn-1' });
    project.selectedNodeIds = [];
    const second = await dispatch({ id: 'selection-2', command: 'workflow.selection.get', args: {}, source: 'agent', idempotencyKey: 'turn-1' });

    expect(first.result).toMatchObject({ selectedNodeIds: ['image-1'] });
    expect(second.result).toMatchObject({ selectedNodeIds: [] });
  });

  it('applies reversible Agent canvas edits without stopping for confirmation', async () => {
    const { dispatch, dependencies } = setup();
    const envelope = { id: 'create', command: 'workflow.node.create', args: { type: 'text', title: '脚本' }, source: 'agent' as const };
    const applied = await dispatch(envelope);
    expect(applied.ok).toBe(true);
    expect(dependencies.getState().projects[0].nodes).toHaveLength(2);
    const created = dependencies.getState().projects[0].nodes.at(-1)!;
    expect(applied.result).toMatchObject({
      affectedNodeIds: [created.id],
      objectVersions: { [created.id]: 1 },
    });
  });

  it('records an Agent mutation as an undoable semantic Draft ChangeSet', async () => {
    const { dispatch, dependencies } = setup();
    const projectId = dependencies.getState().activeProjectId!;

    const applied = await dispatch({
      id: 'create-change-set',
      command: 'workflow.node.create',
      args: { id: 'outline-1', type: 'text', title: '脚本大纲', confirmed: true },
      source: 'agent',
      idempotencyKey: 'create-outline-v1',
    });
    expect(applied.ok).toBe(true);
    expect(applied.result).toMatchObject({ affectedNodeIds: ['outline-1'], objectVersions: { 'outline-1': 1 } });
    const changed = dependencies.getState().projects[0];
    expect(changed.draftChangeSets?.at(-1)).toMatchObject({
      actor: 'agent',
      intent: '创建text节点「脚本大纲」',
      status: 'completed',
      baseDraftVersion: 1,
      resultDraftVersion: 2,
    });

    const undone = undoWorkflowDraftChangeSet(changed);
    expect(undone.ok).toBe(true);
    if (undone.ok === false) throw new Error(undone.error.message);
    dependencies.updateProject(projectId, undone.project);
    expect(dependencies.getState().projects[0].nodes.map(node => node.id)).toEqual(['image-1']);
    expect(dependencies.getState().projects[0].draftChangeSets?.at(-1)?.status).toBe('undone');
  });

  it('does not create a Draft ChangeSet for selection or viewport navigation', async () => {
    const { dispatch, dependencies } = setup();
    await dispatch({ id: 'select-only', command: 'workflow.select', args: { ids: ['image-1'] }, source: 'agent' });
    await dispatch({ id: 'viewport-only', command: 'workflow.viewport.set', args: { x: 40, y: 60, k: 1.25 }, source: 'agent' });

    const project = dependencies.getState().projects[0];
    expect(project.selectedNodeIds).toEqual(['image-1']);
    expect(project.viewport).toEqual({ x: 40, y: 60, k: 1.25 });
    expect(project.draftVersion).toBe(1);
    expect(project.draftChangeSets).toEqual([]);
  });

  it('publishes workflow.apply as one atomic revisioned batch', async () => {
    const { dispatch, dependencies } = setup();
    const project = dependencies.getState().projects[0];
    const result = await dispatch({
      id: 'apply-batch',
      command: 'workflow.apply',
      source: 'cli',
      args: {
        projectId: project.id,
        expectedRevision: 1,
        mutationId: 'apply-batch-1',
        operations: [
          { type: 'add_node', node: createWorkflowNode('script-1', 'text', { x: 0, y: 320 }) },
          { type: 'add_node', node: createWorkflowNode('shot-1', 'image', { x: 420, y: 320 }) },
          { type: 'connect_nodes', id: 'edge-1', fromNodeId: 'script-1', toNodeId: 'shot-1' },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      result: { mutationId: 'apply-batch-1', previousRevision: 1, revision: 2, replayed: false },
    });
    const changed = dependencies.getState().projects[0];
    expect(changed.draftVersion).toBe(2);
    expect(changed.draftChangeSets).toHaveLength(1);
    expect(changed.connections).toEqual([expect.objectContaining({ id: 'edge-1' })]);
  });

  it('replays persisted workflow.apply receipts across dispatcher instances and rejects payload reuse', async () => {
    const first = setup();
    const project = first.dependencies.getState().projects[0];
    const request = {
      id: 'apply-once', command: 'workflow.apply', source: 'agent' as const,
      args: {
        projectId: project.id, expectedRevision: 1, mutationId: 'persisted-mutation',
        operations: [{ type: 'add_node', node: createWorkflowNode('persisted-node', 'text', { x: 40, y: 40 }) }],
      },
    };
    const applied = await first.dispatch(request);
    const dispatchAfterReload = createWorkflowDispatcher(first.dependencies);
    const replayed = await dispatchAfterReload(request);
    const reused = await dispatchAfterReload({
      ...request,
      args: { ...request.args, operations: [{ type: 'update_node', id: 'persisted-node', patch: { title: '冲突' } }] },
    });

    expect(applied).toMatchObject({ ok: true, result: { replayed: false, revision: 2 } });
    expect(replayed).toMatchObject({ ok: true, result: { replayed: true, revision: 2 } });
    expect(reused).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_KEY_REUSE' } });
    expect(first.dependencies.getState().projects[0].nodes).toHaveLength(2);
    expect(first.dependencies.getState().projects[0].draftChangeSets).toHaveLength(1);
  });

  it('returns REVISION_CONFLICT for stale workflow.apply without committing', async () => {
    const { dispatch, dependencies } = setup();
    const project = dependencies.getState().projects[0];
    const result = await dispatch({
      id: 'stale-apply', command: 'workflow.apply', source: 'cli',
      args: {
        projectId: project.id, expectedRevision: 0, mutationId: 'stale-mutation',
        operations: [{ type: 'add_node', node: createWorkflowNode('never-created', 'text', { x: 0, y: 0 }) }],
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'REVISION_CONFLICT' } });
    expect(dependencies.getState().projects[0].nodes.some(node => node.id === 'never-created')).toBe(false);
  });

  it('adapts a granular command into the same mutation result as workflow.apply', async () => {
    const legacy = setup();
    const canonical = setup();
    const legacyProject = legacy.dependencies.getState().projects[0];
    const canonicalProject = canonical.dependencies.getState().projects[0];
    const node = createWorkflowNode('parity-node', 'text', { x: 20, y: 30 });

    await legacy.dispatch({
      id: 'parity-mutation', command: 'workflow.node.create', source: 'cli',
      args: { projectId: legacyProject.id, id: node.id, type: node.type, x: 20, y: 30 },
    });
    await canonical.dispatch({
      id: 'canonical-command', command: 'workflow.apply', source: 'cli',
      args: {
        projectId: canonicalProject.id, expectedRevision: 1, mutationId: 'parity-mutation',
        operations: [{ type: 'add_node', node }],
      },
    });

    const legacyState = legacy.dependencies.getState().projects[0];
    const canonicalState = canonical.dependencies.getState().projects[0];
    expect(legacyState.nodes.map(({ id, type, position, objectVersion }) => ({ id, type, position, objectVersion })))
      .toEqual(canonicalState.nodes.map(({ id, type, position, objectVersion }) => ({ id, type, position, objectVersion })));
    expect(legacyState.connections).toEqual(canonicalState.connections);
    expect(legacyState.draftVersion).toBe(canonicalState.draftVersion);
    expect(legacyState.draftChangeSets?.map(changeSet => changeSet.id)).toEqual(['parity-mutation']);
  });

  it('uses object versions for conflict detection and increments a changed object exactly once', async () => {
    const { dispatch, dependencies } = setup();
    const initial = dependencies.getState().projects[0];
    initial.nodes[0].objectVersion = 3;

    const stale = await dispatch({
      id: 'stale-update',
      command: 'workflow.node.update',
      args: { nodeId: 'image-1', patch: { title: '过期修改' }, expectedObjectVersions: { 'image-1': 2 } },
      source: 'agent',
    });
    expect(stale.error).toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(dependencies.getState().projects[0].nodes[0]).toMatchObject({ title: '图片', objectVersion: 3 });

    const applied = await dispatch({
      id: 'fresh-update',
      command: 'workflow.node.update',
      args: { nodeId: 'image-1', patch: { title: '新标题' }, expectedObjectVersions: { 'image-1': 3 } },
      source: 'agent',
    });
    expect(applied.ok).toBe(true);
    expect(dependencies.getState().projects[0].nodes[0]).toMatchObject({ title: '新标题', objectVersion: 4 });
  });

  it('deduplicates confirmed mutations by idempotency key', async () => {
    const { dispatch, dependencies } = setup();
    const envelope = { id: 'once', command: 'workflow.node.create', args: { type: 'text', confirmed: true }, source: 'operator' as const, idempotencyKey: 'same' };
    await dispatch(envelope);
    await dispatch(envelope);
    expect(dependencies.getState().projects[0].nodes).toHaveLength(2);
  });

  it('creates audio nodes and connected nodes through canonical ops', async () => {
    const { dispatch, dependencies } = setup();
    const audio = await dispatch({ id: 'audio', command: 'workflow.node.create', args: { type: 'audio', confirmed: true }, source: 'agent' });
    expect(audio.ok).toBe(true);
    const connected = await dispatch({ id: 'connected', command: 'workflow.node.create-connected', args: { type: 'text', fromNodeId: 'image-1', confirmed: true }, source: 'operator' });
    expect(connected.ok).toBe(true);
    expect(dependencies.getState().projects[0].connections).toHaveLength(1);
  });

  it('returns canonical connection rejection reasons', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'cycle', command: 'workflow.connect', args: { fromNodeId: 'image-1', toNodeId: 'image-1', confirmed: true }, source: 'agent' });
    expect(result.error?.message).toContain('不能连接节点自身');
  });

  it('fails run and stop commands when browser adapters are absent', async () => {
    const { dispatch, dependencies } = setup();
    dependencies.executor = undefined;
    expect((await dispatch(withWorkflowHumanApproval({ id: 'run', command: 'workflow.node.run', args: { nodeId: 'image-1' }, source: 'agent' }))).error?.code).toBe('RUNNER_UNAVAILABLE');
    expect((await dispatch({ id: 'stop', command: 'workflow.node.stop', args: { nodeId: 'image-1', confirmed: true }, source: 'agent' })).error?.code).toBe('RUNNER_UNAVAILABLE');
  });

  it('returns a stable confirmation state before an Agent can submit generation', async () => {
    const runNode = vi.fn();
    const { dispatch } = setup(createWorkflowExecutor({ runNode }));
    const result = await dispatch({ id: 'confirm-run', command: 'workflow.node.run', args: { nodeId: 'image-1' }, source: 'agent' });

    expect(result).toMatchObject({
      ok: true,
      confirmation: { required: true, code: 'CONFIRMATION_REQUIRED' },
    });
    expect(runNode).not.toHaveBeenCalled();
  });

  it('does not accept a caller-controlled confirmed flag as human approval', async () => {
    const runNode = vi.fn();
    const { dispatch } = setup(createWorkflowExecutor({ runNode }));
    const result = await dispatch({
      id: 'forged-confirmation',
      command: 'workflow.node.run',
      args: { nodeId: 'image-1', confirmed: true },
      source: 'agent',
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: { required: true, code: 'CONFIRMATION_REQUIRED' },
    });
    expect(runNode).not.toHaveBeenCalled();
  });

  it('gates a CLI command carrying an Agent identity before submitting generation', async () => {
    const runNode = vi.fn();
    const { dispatch } = setup(createWorkflowExecutor({ runNode }));
    const result = await dispatch({
      id: 'cli-confirm-run',
      command: 'workflow.node.run',
      args: { nodeId: 'image-1' },
      source: 'cli',
      caller: { agentIdentity: 'codex' },
    });

    expect(result).toMatchObject({
      ok: true,
      confirmation: { required: true, code: 'CONFIRMATION_REQUIRED' },
    });
    expect(runNode).not.toHaveBeenCalled();
  });

  it('routes UI, Browser Agent, CLI, and Runtime through one executor without changing canonical input', async () => {
    const firstFrame = createWorkflowNode('A', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png' });
    const character = createWorkflowNode('C', 'image', { x: 0, y: 120 }, { href: 'https://cdn.example.com/c.png' });
    const target = createWorkflowNode('B', 'video', { x: 420, y: 0 }, { prompt: '人物缓慢转身' });
    const inputs = resolveWorkflowInputs(target, [firstFrame, character, target], [
      { id: 'a-edge', fromNodeId: 'A', toNodeId: 'B', role: 'source_image' },
      { id: 'c-edge', fromNodeId: 'C', toNodeId: 'B', role: 'reference_image' },
    ]);
    const canonicalInput = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '人物缓慢转身', mode: 'video', submode: 'image-to-video' });
    const runNode = vi.fn().mockImplementation(async command => ({
      runId: 'adapter-run', projectId: command.projectId, nodeId: command.nodeId, canonicalInput,
      artifact: { artifactId: 'artifact-run', kind: 'image' as const, mimeType: 'image/png' },
    }));
    let sequence = 0;
    const executor = createWorkflowExecutor({ runNode, stopNode: vi.fn() }, { createRunId: () => `run-${++sequence}` });
    const { dispatch, dependencies } = setup(executor);
    const projectId = dependencies.getState().activeProjectId!;
    const command = { projectId, nodeId: 'image-1' };

    const ui = await executor.runNode(command, { surface: 'ui', correlationId: 'ui-run' });
    const agentResult = await dispatch(withWorkflowHumanApproval({ id: 'agent-run', command: 'workflow.node.run', args: { nodeId: 'image-1' }, source: 'agent' }));
    await dispatch({ id: 'cli-run', command: 'workflow.node.run', args: { nodeId: 'image-1' }, source: 'cli' });
    await dispatch({ id: 'runtime-run', command: 'workflow.node.run', args: { nodeId: 'image-1' }, source: 'operator' });

    expect(ui.canonicalInput).toEqual(canonicalInput);
    expect(agentResult.result).toMatchObject({ projectId, nodeId: 'image-1', runId: 'run-2', artifact: { artifactId: 'artifact-run' } });
    expect(runNode.mock.calls).toHaveLength(4);
    expect(runNode.mock.calls.map(([, context]) => context.surface)).toEqual(['ui', 'browser-agent', 'cli', 'runtime']);
    expect(runNode.mock.calls.map(([, context]) => context.correlationId)).toEqual(['ui-run', 'agent-run', 'cli-run', 'runtime-run']);
    expect(runNode.mock.results.map(result => result.value)).toHaveLength(4);
    expect(runNode.mock.calls.map(() => canonicalInput)).toEqual([canonicalInput, canonicalInput, canonicalInput, canonicalInput]);
  });

  it('rejects a stale expected revision before invoking the executor', async () => {
    const { dispatch, executor } = setup();
    const runNode = vi.spyOn(executor, 'runNode');
    const result = await dispatch({ id: 'stale-run', command: 'workflow.node.run', args: { nodeId: 'image-1', expectedRevision: 2, confirmed: true }, source: 'cli' });

    expect(result.error).toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(runNode).not.toHaveBeenCalled();
  });

  it('returns the same structured execution error to every dispatcher surface', async () => {
    const executor = createWorkflowExecutor({
      runNode: vi.fn().mockRejectedValue(new WorkflowExecutionError('PROVIDER_REQUEST_FAILED', 'Provider 暂时不可用。')),
    });
    const { dispatch } = setup(executor);

    const result = await dispatch(withWorkflowHumanApproval({ id: 'provider-error', command: 'workflow.node.run', args: { nodeId: 'image-1' }, source: 'agent' }));

    expect(result).toMatchObject({ ok: false, commandId: 'provider-error', error: { code: 'PROVIDER_REQUEST_FAILED', message: 'Provider 暂时不可用。' } });
  });

  it('records agent/operator draft actions into the project draft log but skips pure UI edits', async () => {
    const { dispatch, dependencies } = setup();
    await dispatch({ id: 'create', command: 'workflow.node.create', args: { type: 'text', title: '旁白', confirmed: true }, source: 'agent' });
    await dispatch({ id: 'move', command: 'workflow.node.move', args: { nodeId: 'image-1', x: 10, y: 20, confirmed: true }, source: 'operator' });
    await dispatch({ id: 'select', command: 'workflow.select', args: { ids: ['image-1'] }, source: 'ui' });

    const log = dependencies.getState().projects[0].draftLog || [];
    expect(log).toHaveLength(2);
    expect(log[0].source).toBe('agent');
    expect(log[0].command).toBe('workflow.node.create');
    expect(log[0].summary).toBe('创建text节点「旁白」');
    const createdId = dependencies.getState().projects[0].nodes[1].id;
    expect(log[0].nodeIds).toEqual([createdId]);
    expect(log[1].source).toBe('operator');
    expect(log[1].command).toBe('workflow.node.move');
    expect(log[1].summary).toBe('移动节点「image-1」');
    expect(log[1].nodeIds).toEqual(['image-1']);
  });

  it('routes workflow.node.tool to the canvas tool runner, records the action and strips confirmation flags', async () => {
    const { dispatch, dependencies } = setup();
    const nodeToolRunner = vi.fn().mockResolvedValue({ status: 'committed', project: null });
    dependencies.nodeToolRunner = nodeToolRunner;
    const result = await dispatch(withWorkflowHumanApproval({
      id: 'tool', command: 'workflow.node.tool',
      args: { nodeId: 'image-1', tool: 'upscale', targetLongEdge: 2048 },
      source: 'agent',
    }));
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ nodeId: 'image-1', tool: 'upscale', committed: true });
    expect(nodeToolRunner).toHaveBeenCalledWith(expect.any(String), 'image-1', 'upscale', { targetLongEdge: 2048, algorithm: 'high' });
    const log = dependencies.getState().projects[0].draftLog || [];
    expect(log.at(-1)?.command).toBe('workflow.node.tool');
    expect(log.at(-1)?.summary).toBe('对节点「image-1」执行 upscale 工具');
    expect(log.at(-1)?.nodeIds).toEqual(['image-1']);
  });

  it('derives operation-tool validation and confirmation from the capability registry', async () => {
    const { dispatch, dependencies } = setup();
    const nodeToolRunner = vi.fn().mockResolvedValue({ status: 'committed', project: null });
    dependencies.nodeToolRunner = nodeToolRunner;

    const crop = await dispatch({
      id: 'crop', command: 'workflow.node.tool',
      args: { nodeId: 'image-1', tool: 'crop', x: .1, y: .1, width: .8, height: .8 },
      source: 'agent',
    });
    expect(crop.confirmation).toBeUndefined();
    expect(crop.ok).toBe(true);
    expect(nodeToolRunner).toHaveBeenCalledWith(expect.any(String), 'image-1', 'crop', { x: .1, y: .1, width: .8, height: .8 });

    const paid = await dispatch({
      id: 'upscale-preview', command: 'workflow.node.tool',
      args: { nodeId: 'image-1', tool: 'upscale', targetLongEdge: 2048 },
      source: 'agent',
    });
    expect(paid.confirmation?.required).toBe(true);

    nodeToolRunner.mockClear();
    const merge = await dispatch({
      id: 'merge', command: 'workflow.node.tool',
      args: { nodeId: 'image-1', tool: 'video-merge', sourceNodeIds: ['video-2', 'video-1'], ignored: true },
      source: 'agent',
    });
    expect(merge.confirmation).toBeUndefined();
    expect(nodeToolRunner).toHaveBeenCalledWith(expect.any(String), 'image-1', 'video-merge', { sourceNodeIds: ['video-2', 'video-1'] });

    nodeToolRunner.mockClear();
    const invalid = await dispatch({
      id: 'bad-crop', command: 'workflow.node.tool',
      args: { nodeId: 'image-1', tool: 'crop', x: .8, y: 0, width: .5, height: 1 },
      source: 'agent',
    });
    expect(invalid.error?.code).toBe('BAD_REQUEST');
    expect(invalid.error?.message).toContain('裁剪范围不能超出图片');
    expect(nodeToolRunner).not.toHaveBeenCalled();
  });

  it('rejects unknown canvas tools and requires a connected tool adapter', async () => {
    const { dispatch, dependencies } = setup();
    dependencies.nodeToolRunner = undefined;
    const missing = await dispatch(withWorkflowHumanApproval({ id: 'tool2', command: 'workflow.node.tool', args: { nodeId: 'image-1', tool: 'upscale' }, source: 'agent' }));
    expect(missing.error?.code).toBe('RUNNER_UNAVAILABLE');

    dependencies.nodeToolRunner = vi.fn();
    const unknown = await dispatch({ id: 'tool3', command: 'workflow.node.tool', args: { nodeId: 'image-1', tool: 'explode', confirmed: true }, source: 'agent' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.message).toContain('不支持的画布工具');
    expect(dependencies.nodeToolRunner).not.toHaveBeenCalled();
  });
});
