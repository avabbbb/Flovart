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

  it('stacks every version of a run in one batch with the newest as the head, and does not duplicate', async () => {
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

    const nodes = useWorkflowStore.getState().projects[0].nodes.filter(node => node.batchId === 'pipeline-run_x');
    expect(nodes.map(node => [node.title, node.batchIndex, node.batchGroupSource])).toEqual([
      ['演示 · v1', 0, 'auto'],
      ['演示 · v2', 1, 'auto'],
    ]);
    const root = nodes.find(node => node.batchIndex === 0)!;
    const newest = nodes.find(node => node.metadata.pipelineRender?.version === 2)!;
    expect(root.metadata.primaryImageId).toBe(newest.id);
    expect(newest.metadata.pipelineRender).toEqual({ runId: 'run_x', version: 2, artifactId: 'a2', preset: 'final' });

    const third = await insertPipelineVersionsIntoProject({ runId: 'run_x', title: '演示' }, renders, loadBlob);
    expect(third).toMatchObject({ ok: true, inserted: 0 });
  });
});
