import { describe, expect, it, vi } from 'vitest';
import { createWorkflowDispatcher, type WorkflowDispatcherDependencies } from '../services/workflowDispatcher';
import { createWorkflowProject } from '../components/workflow/store';
import { createWorkflowNode } from '../components/workflow/constants';

const setup = () => {
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
    runNode: vi.fn(),
    stopNode: vi.fn(),
  };
  return { dispatch: createWorkflowDispatcher(dependencies), dependencies };
};

describe('workflow dispatcher', () => {
  it('returns redacted project snapshots', async () => {
    const { dispatch } = setup();
    const result = await dispatch({ id: 'read', command: 'workflow.inspect', args: {}, source: 'agent' });
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result.result)).not.toContain('base64,SECRET');
    expect(JSON.stringify(result.result)).not.toContain('private-key');
  });

  it('previews Agent mutations before applying them', async () => {
    const { dispatch, dependencies } = setup();
    const envelope = { id: 'create', command: 'workflow.node.create', args: { type: 'text', title: '脚本' }, source: 'agent' as const };
    const preview = await dispatch(envelope);
    expect(preview.confirmation?.required).toBe(true);
    expect(dependencies.getState().projects[0].nodes).toHaveLength(1);

    const applied = await dispatch({ ...envelope, args: { ...envelope.args, confirmed: true } });
    expect(applied.ok).toBe(true);
    expect(dependencies.getState().projects[0].nodes).toHaveLength(2);
  });

  it('deduplicates confirmed mutations by idempotency key', async () => {
    const { dispatch, dependencies } = setup();
    const envelope = { id: 'once', command: 'workflow.node.create', args: { type: 'text', confirmed: true }, source: 'mcp' as const, idempotencyKey: 'same' };
    await dispatch(envelope);
    await dispatch(envelope);
    expect(dependencies.getState().projects[0].nodes).toHaveLength(2);
  });

  it('creates audio nodes and connected nodes through canonical ops', async () => {
    const { dispatch, dependencies } = setup();
    const audio = await dispatch({ id: 'audio', command: 'workflow.node.create', args: { type: 'audio', confirmed: true }, source: 'agent' });
    expect(audio.ok).toBe(true);
    const connected = await dispatch({ id: 'connected', command: 'workflow.node.create-connected', args: { type: 'text', fromNodeId: 'image-1', confirmed: true }, source: 'mcp' });
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
    dependencies.runNode = undefined;
    dependencies.stopNode = undefined;
    expect((await dispatch({ id: 'run', command: 'workflow.node.run', args: { nodeId: 'image-1', confirmed: true }, source: 'agent' })).error?.code).toBe('RUNNER_UNAVAILABLE');
    expect((await dispatch({ id: 'stop', command: 'workflow.node.stop', args: { nodeId: 'image-1', confirmed: true }, source: 'agent' })).error?.code).toBe('RUNNER_UNAVAILABLE');
  });

  it('records agent/mcp draft actions into the project draft log but skips pure UI edits', async () => {
    const { dispatch, dependencies } = setup();
    await dispatch({ id: 'create', command: 'workflow.node.create', args: { type: 'text', title: '旁白', confirmed: true }, source: 'agent' });
    await dispatch({ id: 'move', command: 'workflow.node.move', args: { nodeId: 'image-1', x: 10, y: 20, confirmed: true }, source: 'mcp' });
    await dispatch({ id: 'select', command: 'workflow.select', args: { ids: ['image-1'] }, source: 'ui' });

    const log = dependencies.getState().projects[0].draftLog || [];
    expect(log).toHaveLength(2);
    expect(log[0].source).toBe('agent');
    expect(log[0].command).toBe('workflow.node.create');
    expect(log[0].summary).toBe('创建text节点「旁白」');
    const createdId = dependencies.getState().projects[0].nodes[1].id;
    expect(log[0].nodeIds).toEqual([createdId]);
    expect(log[1].source).toBe('mcp');
    expect(log[1].command).toBe('workflow.node.move');
    expect(log[1].summary).toBe('移动节点「image-1」');
    expect(log[1].nodeIds).toEqual(['image-1']);
  });

  it('routes workflow.node.tool to the canvas tool runner, records the action and strips confirmation flags', async () => {
    const { dispatch, dependencies } = setup();
    const nodeToolRunner = vi.fn().mockResolvedValue({ status: 'committed', project: null });
    dependencies.nodeToolRunner = nodeToolRunner;
    const result = await dispatch({
      id: 'tool', command: 'workflow.node.tool',
      args: { nodeId: 'image-1', tool: 'upscale', targetLongEdge: 2048, confirmed: true },
      source: 'agent',
    });
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
    const missing = await dispatch({ id: 'tool2', command: 'workflow.node.tool', args: { nodeId: 'image-1', tool: 'upscale', confirmed: true }, source: 'agent' });
    expect(missing.error?.code).toBe('RUNNER_UNAVAILABLE');

    dependencies.nodeToolRunner = vi.fn();
    const unknown = await dispatch({ id: 'tool3', command: 'workflow.node.tool', args: { nodeId: 'image-1', tool: 'explode', confirmed: true }, source: 'agent' });
    expect(unknown.ok).toBe(false);
    expect(unknown.error?.message).toContain('不支持的画布工具');
    expect(dependencies.nodeToolRunner).not.toHaveBeenCalled();
  });
});
