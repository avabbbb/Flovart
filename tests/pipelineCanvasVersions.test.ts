import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../components/workflow/media', async importOriginal => {
  const actual = await importOriginal<typeof import('../components/workflow/media')>();
  let counter = 0;
  return {
    ...actual,
    ingestWorkflowMedia: vi.fn(async (file: File) => ({
      type: 'video', storageKey: `key-${++counter}`, name: file.name, mimeType: 'video/mp4', bytes: file.size,
      naturalWidth: 1280, naturalHeight: 720, durationMs: 4000, status: 'success',
    })),
    releaseWorkflowMediaRecord: vi.fn(),
    discardWorkflowMediaRecord: vi.fn(async () => undefined),
  };
});

import { insertPipelineVersionsIntoProject } from '../components/workflow/WorkflowWorkspace';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';

describe('pipeline versions on the canvas', () => {
  beforeEach(() => {
    const project = { ...createWorkflowProject('流水线'), id: 'project-pipeline' };
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
  });

  it('keeps every version of a run on one node: newest is the node, older versions are its alternates, no duplicates', async () => {
    const loadBlob = vi.fn(async () => new Blob(['x'], { type: 'video/mp4' }));
    const renders = [
      { version: 1, artifactId: 'a1', preset: 'draft', verdict: 'revise' },
      { version: 2, artifactId: 'a2', preset: 'final', verdict: 'pass' },
    ];
    const first = await insertPipelineVersionsIntoProject({ runId: 'run_x', title: '演示' }, renders.slice(0, 1), loadBlob);
    expect(first).toMatchObject({ ok: true, inserted: 1 });
    const second = await insertPipelineVersionsIntoProject({ runId: 'run_x', title: '演示' }, renders, loadBlob);
    expect(second).toMatchObject({ ok: true, inserted: 1 });
    expect(loadBlob).toHaveBeenCalledTimes(2);

    const nodes = useWorkflowStore.getState().projects[0].nodes;
    expect(nodes).toHaveLength(1);
    const [owner] = nodes;
    expect(owner.type).toBe('video');
    expect(owner.title).toBe('演示 · v2');
    expect(owner.metadata.pipelineRender).toEqual({ runId: 'run_x', version: 2, artifactId: 'a2', preset: 'final' });
    expect((owner.metadata.alternates || []).map(item => [item.title, item.batchId, item.metadata.pipelineRender?.version, item.metadata.pipelineRender?.artifactId])).toEqual([
      ['演示 · v1', 'pipeline-run_x', 1, 'a1'],
    ]);
    expect(useWorkflowStore.getState().projects[0].selectedNodeIds).toEqual([owner.id]);

    const third = await insertPipelineVersionsIntoProject({ runId: 'run_x', title: '演示' }, renders, loadBlob);
    expect(third).toMatchObject({ ok: true, inserted: 0 });
  });
});
