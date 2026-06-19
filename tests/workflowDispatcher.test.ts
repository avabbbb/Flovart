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
});
