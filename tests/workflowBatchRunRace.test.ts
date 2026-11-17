import { afterEach, describe, expect, it } from 'vitest';
import { beginWorkflowOperationTake, prepareWorkflowImageGenerateRun } from '../components/workflow/operations';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { createWorkflowDispatcher } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';

/**
 * 回归：`node.run --node-ids a,b` 批量运行时只有最后一个节点成功。
 * 根因：每个节点把图片节点转换成 Operation 后，等 await 返回才整体写回 store，
 * 而新 Take 又基于转换前读到的旧快照创建，后完成的节点把先完成节点的转换/Take 覆盖掉。
 */
describe('batch node.run converts and starts every node', () => {
  afterEach(() => { useWorkflowStore.setState({ projects: [], activeProjectId: null }); });

  it('runs two nodes in one batch and both succeed', async () => {
    const project = createWorkflowProject('批量运行');
    project.nodes = ['shot-a', 'shot-b'].map((id, index) => createWorkflowNode(id, 'image', { x: index * 400, y: 0 }, {
      prompt: `镜头 ${id}`,
      config: { mode: 'image', modelId: 'flovart:gpt-image-2', count: 1 },
    }));
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    const latest = () => useWorkflowStore.getState().projects.find(item => item.id === project.id)!;
    let seq = 0;
    const createId = () => `id-${++seq}`;

    // 与 App.tsx 的 handleRunWorkflowNode 相同的步骤：准备 Operation → 读最新状态 → 开新 Take → 只替换本节点写回。
    const executor = createWorkflowExecutor({
      runNode: async ({ projectId, nodeId }) => {
        const snapshot = latest();
        const prepared = await prepareWorkflowImageGenerateRun({ project: snapshot, nodeId, createId });
        // 让两个节点的后续步骤交错：a 在准备完成后稍晚才继续（真实场景里是网络/哈希耗时不同）。
        await new Promise(resolve => setTimeout(resolve, nodeId === 'shot-a' ? 5 : 0));
        const before = latest();
        const operation = before.nodes.find(node => node.id === prepared.operationNodeId);
        if (!operation?.metadata.operation) return { status: 'failed', error: { code: 'RUN_FAILED', message: `${nodeId} 未挂上生成记录` } };
        const started = await beginWorkflowOperationTake(operation, { id: createId(), snapshotId: createId() });
        const fresh = latest();
        useWorkflowStore.getState().updateProject(projectId, { nodes: fresh.nodes.map(node => node.id === nodeId ? started.node : node) });
        return { status: 'completed' };
      },
    });
    const dispatch = createWorkflowDispatcher({
      getState: () => useWorkflowStore.getState() as never,
      createProject: title => useWorkflowStore.getState().createProject(title),
      setActiveProject: id => useWorkflowStore.getState().setActiveProject(id),
      deleteProjects: ids => useWorkflowStore.getState().deleteProjects(ids),
      updateProject: (id, patch) => useWorkflowStore.getState().updateProject(id, patch),
      executor,
    });

    const result = await dispatch({ id: 'batch', command: 'workflow.node.run', args: { projectId: project.id, nodeIds: 'shot-a,shot-b' }, source: 'cli' });

    expect(result.ok).toBe(true);
    const runs = (result.result as { runs: Array<{ nodeId: string; ok: boolean }>; failed: number });
    expect(runs.failed).toBe(0);
    expect(runs.runs.map(run => [run.nodeId, run.ok])).toEqual([['shot-a', true], ['shot-b', true]]);
    for (const id of ['shot-a', 'shot-b']) {
      const node = latest().nodes.find(item => item.id === id);
      // 节点保持 image 类型，生成记录挂在节点自身。
      expect(node?.type).toBe('image');
      expect(node?.metadata.operation?.takes).toHaveLength(1);
      expect(node?.metadata.status).toBe('loading');
    }
  });
});
