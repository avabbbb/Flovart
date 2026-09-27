import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { StudioWorkflowController } from '../services/studio/studioWorkflow';
import type { CreativeHostAdapter, FlovartStudioCore, HostContext, HostSelection, MaterializedHostSelection } from '../services/studio/studioContract';
import type { WorkflowProject } from '../components/workflow/types';

const selection: HostSelection = {
  host: 'photoshop',
  selectionId: 'layer-1',
  label: 'Hero',
  kind: 'image',
  locator: { documentId: 'doc-1', layerId: 1 },
  mimeType: 'image/png',
};

const project: WorkflowProject = {
  id: 'project-1',
  title: 'Studio',
  nodes: [createWorkflowNode('brief', 'text', { x: 0, y: 0 }, { content: 'brief' })],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  draftVersion: 3,
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
};

function adapter(): CreativeHostAdapter {
  return {
    id: 'photoshop',
    getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'photoshop', available: true, title: 'Product.psd', documentId: 'doc-1' })),
    getSelection: vi.fn(async () => selection),
    materializeSelection: vi.fn(async (current): Promise<MaterializedHostSelection> => ({
      selection: current,
      resource: { resourceId: 'creative-host:photoshop:layer-1', title: current.label, kind: current.kind, locator: { kind: 'creative-host', host: current.host, locator: current.locator } },
      reference: { id: 'reference-1', resourceId: 'creative-host:photoshop:layer-1', resourceOrigin: 'creative-host', sourceId: current.selectionId, kind: current.kind, source: 'manual' },
      blob: new Blob(['layer'], { type: 'image/png' }),
    })),
    importArtifact: vi.fn(async () => ({ ok: true, targetId: 'new-layer', message: '已添加' })),
  };
}

describe('Studio Workflow controller', () => {
  it('uses the existing apply/run authority and imports the returned artifact', async () => {
    const host = adapter();
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project),
      selection: vi.fn(),
      registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })),
      run: vi.fn(async () => ({ artifact: { artifactId: 'artifact-session-1', kind: 'image', mimeType: 'image/png' } })),
      artifactGet: vi.fn(async () => ({ taskId: 'task-1', artifactId: 'artifact-1', mimeType: 'image/png', blob: new Blob(['result'], { type: 'image/png' }) })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `id-${++id}`);

    const result = await controller.generate('做成夜景海报');

    expect(core.apply).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1', expectedRevision: 3, idempotencyKey: 'id-3',
      operations: expect.arrayContaining([
        expect.objectContaining({ type: 'add_node', node: expect.objectContaining({ metadata: expect.objectContaining({ resourceLocator: expect.objectContaining({ kind: 'creative-host' }) }) }) }),
      ]),
    }));
    expect(core.run).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', expectedRevision: 4 }));
    expect(core.artifactGet).toHaveBeenCalledWith({ artifactId: 'artifact-session-1' });
    expect(host.importArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'artifact-1' }), undefined);
    expect(result.executionTarget).toMatchObject({ projectId: 'project-1', hostTarget: 'photoshop', revision: 3 });
    expect(result.executionTarget.selectionSnapshot).toMatchObject({ selectionId: 'layer-1' });
    expect(result.executionTarget.references).toEqual([expect.objectContaining({ resourceId: 'creative-host:photoshop:layer-1' })]);
    expect(result.import).toMatchObject({ ok: true, targetId: 'new-layer' });
  });

  it('freezes the execution target at submit: artifact lands on the selection captured at submit, not the live one', async () => {
    const host = adapter();
    const selectionB: HostSelection = {
      host: 'photoshop', selectionId: 'layer-9', label: 'Other', kind: 'image',
      locator: { documentId: 'doc-2', layerId: 9 }, mimeType: 'image/png',
    };
    // 运行期间把 live selection 换成 B：submit 后 getSelection 返回 B。
    let swapped = false;
    vi.mocked(host.getSelection).mockImplementation(async () => (swapped ? selectionB : selection));
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project),
      selection: vi.fn(),
      registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })),
      run: vi.fn(async () => {
        swapped = true; // run 提交后、产物回写前切换宿主选择
        return { artifact: { artifactId: 'artifact-session-1', kind: 'image', mimeType: 'image/png' } };
      }),
      artifactGet: vi.fn(async () => ({ taskId: 'task-1', artifactId: 'artifact-1', mimeType: 'image/png', blob: new Blob(['result'], { type: 'image/png' }) })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `id-${++id}`);

    const result = await controller.generate('做成夜景海报', { kind: 'new-layer' });

    // artifact 回写使用冻结的 outputTarget（钉住 submit 时 doc-1/layer-1），不认 live 的 doc-2/layer-9。
    expect(host.importArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'artifact-1' }),
      expect.objectContaining({ kind: 'new-layer', documentId: 'doc-1', sourceSelectionId: 'layer-1' }),
    );
    expect(result.executionTarget.selectionSnapshot.selectionId).toBe('layer-1');
    expect(result.executionTarget.hostTarget).toBe('photoshop');
    expect(result.executionTarget.projectId).toBe('project-1');
    expect(result.import).toMatchObject({ ok: true, targetId: 'new-layer' });
  });

  it('pins the Resolve project id into the pending Media Pool import target', async () => {
    const resolveSelection: HostSelection = {
      host: 'resolve',
      selectionId: 'clip-1',
      label: 'Interview.mov',
      kind: 'video',
      locator: { projectId: 'resolve-project-1', clipId: 'clip-1' },
      mimeType: 'video/mp4',
    };
    const host: CreativeHostAdapter = {
      ...adapter(),
      id: 'resolve',
      getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'resolve', available: true, documentId: 'resolve-project-1' })),
      getSelection: vi.fn(async () => resolveSelection),
      materializeSelection: vi.fn(async (current: HostSelection): Promise<MaterializedHostSelection> => ({
        selection: current,
        resource: { resourceId: 'creative-host:resolve:clip-1', title: current.label, kind: current.kind, locator: { kind: 'creative-host', host: current.host, locator: current.locator } },
        reference: { id: 'reference-resolve-1', resourceId: 'creative-host:resolve:clip-1', resourceOrigin: 'creative-host', sourceId: current.selectionId, kind: current.kind, source: 'manual' },
        blob: new Blob(['clip'], { type: 'video/mp4' }),
      })),
    };
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project),
      selection: vi.fn(),
      registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })),
      run: vi.fn(async () => ({ artifact: { artifactId: 'artifact-session-1', kind: 'video', mimeType: 'video/mp4' } })),
      artifactGet: vi.fn(async () => ({ taskId: 'task-1', artifactId: 'artifact-1', mimeType: 'video/mp4', blob: new Blob(['result'], { type: 'video/mp4' }) })),
    };
    const controller = new StudioWorkflowController(host, core, () => 'resolve-test-id');

    await controller.generate('Rainy-night version', { kind: 'media-pool' });

    expect(host.importArtifact).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: 'artifact-1' }),
      expect.objectContaining({ kind: 'media-pool', projectId: 'resolve-project-1', sourceSelectionId: 'clip-1' }),
    );
  });

  it('does not continue when the host selection disappears', async () => {
    const host = adapter();
    vi.mocked(host.getSelection).mockResolvedValue(null);
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project),
      selection: vi.fn(),
      registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(),
      run: vi.fn(),
      artifactGet: vi.fn(),
    };
    const controller = new StudioWorkflowController(host, core);

    await expect(controller.generate('生成')).rejects.toMatchObject({ code: 'HOST_CONTEXT_UNAVAILABLE' });
    expect(core.apply).not.toHaveBeenCalled();
  });

  it('persists a Resolve artifact before exposing a candidate and returns a path-free receipt', async () => {
    const events: string[] = [];
    const resolveSelection: HostSelection = {
      host: 'resolve', selectionId: 'clip-a', label: 'Interview_A.mov', kind: 'video',
      locator: { projectId: 'resolve-project-a', timelineId: 'timeline-1', track: 'V1' }, mimeType: 'video/mp4',
    };
    const host: CreativeHostAdapter = {
      ...adapter(), id: 'resolve',
      getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'resolve', available: true, projectId: 'resolve-project-a', documentId: 'resolve-project-a' })),
      getSelection: vi.fn(async () => resolveSelection),
      materializeSelection: vi.fn(async (current: HostSelection): Promise<MaterializedHostSelection> => ({
        selection: current,
        resource: { resourceId: 'creative-host:resolve:clip-a', title: current.label, kind: current.kind, locator: { kind: 'creative-host', host: current.host, locator: current.locator } },
        reference: { id: 'ref-a', resourceId: 'creative-host:resolve:clip-a', resourceOrigin: 'creative-host', sourceId: current.selectionId, kind: current.kind, source: 'manual' },
        blob: new Blob(['source'], { type: 'video/mp4' }),
      })),
      persistArtifact: vi.fn(async artifact => {
        events.push('persist');
        const receipt = {
          status: 'persisted' as const,
          artifactId: artifact.artifactId!, taskId: artifact.taskId, modelId: artifact.modelId,
          sha256: artifact.sha256!, byteSize: artifact.byteSize!, mimeType: artifact.mimeType,
          createdAt: '2026-09-27T00:00:00.000Z',
          filePath: 'must-not-leak',
        };
        return receipt;
      }),
      importArtifact: vi.fn(async () => ({ ok: true, targetId: 'media-pool' })),
    };
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project), selection: vi.fn(),
      registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })),
      run: vi.fn(async () => { events.push('run'); return { taskId: 'task-a', artifactId: 'artifact-job-a' }; }),
      artifactGet: vi.fn(async () => ({
        taskId: 'task-a', artifactId: 'artifact-a', modelId: 'spark-video', mimeType: 'video/mp4',
        blob: new Blob(['candidate bytes'], { type: 'video/mp4' }),
      })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `candidate-id-${++id}`);

    const candidate = await controller.prepareCandidate('Rainy night', { kind: 'media-pool' });

    expect(events).toEqual(['run', 'persist']);
    expect(host.persistArtifact).toHaveBeenCalledTimes(1);
    expect(host.importArtifact).not.toHaveBeenCalled();
    expect(candidate).toMatchObject({
      candidateId: 'candidate-id-5',
      artifact: { artifactId: 'artifact-a', taskId: 'task-a', modelId: 'spark-video', byteSize: 15, mimeType: 'video/mp4', blob: expect.any(Blob) },
      persistenceReceipt: { status: 'persisted', artifactId: 'artifact-a', taskId: 'task-a', sha256: expect.stringMatching(/^[a-f0-9]{64}$/), byteSize: 15, mimeType: 'video/mp4' },
      executionTarget: { hostTarget: 'resolve', selectionSnapshot: { selectionId: 'clip-a' }, outputTarget: { kind: 'media-pool', projectId: 'resolve-project-a', sourceSelectionId: 'clip-a' } },
    });
    expect(candidate.persistenceReceipt).not.toHaveProperty('filePath');
    expect(Object.isFrozen(candidate.executionTarget.selectionSnapshot.locator)).toBe(true);
  });

  it('imports the frozen Resolve target after selection drift without rereading the live selection', async () => {
    const selectionA: HostSelection = {
      host: 'resolve', selectionId: 'clip-a', label: 'A.mov', kind: 'video',
      locator: { projectId: 'resolve-project-a', clipId: 'clip-a' }, mimeType: 'video/mp4',
    };
    const selectionB: HostSelection = {
      host: 'resolve', selectionId: 'clip-b', label: 'B.mov', kind: 'video',
      locator: { projectId: 'resolve-project-b', clipId: 'clip-b' }, mimeType: 'video/mp4',
    };
    let selectionChanged = false;
    const host: CreativeHostAdapter = {
      ...adapter(), id: 'resolve',
      getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'resolve', available: true, projectId: 'resolve-project-a', documentId: 'resolve-project-a' })),
      getSelection: vi.fn(async () => selectionChanged ? selectionB : selectionA),
      materializeSelection: vi.fn(async (current: HostSelection): Promise<MaterializedHostSelection> => ({
        selection: current,
        resource: { resourceId: `creative-host:resolve:${current.selectionId}`, title: current.label, kind: current.kind, locator: { kind: 'creative-host', host: current.host, locator: current.locator } },
        reference: { id: `ref-${current.selectionId}`, resourceId: `creative-host:resolve:${current.selectionId}`, resourceOrigin: 'creative-host', sourceId: current.selectionId, kind: current.kind, source: 'manual' },
        blob: new Blob(['source'], { type: 'video/mp4' }),
      })),
      persistArtifact: vi.fn(async artifact => ({
        status: 'persisted' as const, artifactId: artifact.artifactId!, taskId: artifact.taskId,
        sha256: artifact.sha256!, byteSize: artifact.byteSize!, mimeType: artifact.mimeType, createdAt: '2026-09-27T00:00:00.000Z',
      })),
      importArtifact: vi.fn(async (_artifact, target) => ({ ok: true, targetId: target?.kind })),
    };
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project), selection: vi.fn(), registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })),
      run: vi.fn(async () => { selectionChanged = true; return { taskId: 'task-a', artifactId: 'artifact-job-a' }; }),
      artifactGet: vi.fn(async () => ({ artifactId: 'artifact-a', taskId: 'task-a', mimeType: 'video/mp4', blob: new Blob(['candidate'], { type: 'video/mp4' }) })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `id-${++id}`);
    const candidate = await controller.prepareCandidate('Make rainy', { kind: 'media-pool' });
    expect(host.getSelection).toHaveBeenCalledTimes(2); // initial snapshot plus pre-submit drift guard

    const imported = await controller.importCandidate(candidate.candidateId);

    expect(imported).toMatchObject({ ok: true, targetId: 'media-pool' });
    expect(host.getSelection).toHaveBeenCalledTimes(2); // import never consults live selection
    expect(host.importArtifact).toHaveBeenCalledWith(
      candidate.artifact,
      expect.objectContaining({ kind: 'media-pool', projectId: 'resolve-project-a', sourceSelectionId: 'clip-a' }),
      candidate.persistenceReceipt,
    );
  });

  it('retains a candidate for retry after failed import and prevents duplicate imports after success', async () => {
    const resolveSelection: HostSelection = {
      host: 'resolve', selectionId: 'clip-a', label: 'A.mov', kind: 'video',
      locator: { projectId: 'resolve-project-a', clipId: 'clip-a' }, mimeType: 'video/mp4',
    };
    const host: CreativeHostAdapter = {
      ...adapter(), id: 'resolve',
      getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'resolve', available: true, projectId: 'resolve-project-a', documentId: 'resolve-project-a' })),
      getSelection: vi.fn(async () => resolveSelection),
      materializeSelection: vi.fn(async (current: HostSelection): Promise<MaterializedHostSelection> => ({
        selection: current,
        resource: { resourceId: `creative-host:resolve:${current.selectionId}`, title: current.label, kind: current.kind, locator: { kind: 'creative-host', host: current.host, locator: current.locator } },
        reference: { id: 'ref-a', resourceId: `creative-host:resolve:${current.selectionId}`, resourceOrigin: 'creative-host', sourceId: current.selectionId, kind: current.kind, source: 'manual' },
        blob: new Blob(['source'], { type: 'video/mp4' }),
      })),
      persistArtifact: vi.fn(async artifact => ({
        status: 'persisted' as const, artifactId: artifact.artifactId!, taskId: artifact.taskId,
        sha256: artifact.sha256!, byteSize: artifact.byteSize!, mimeType: artifact.mimeType, createdAt: '2026-09-27T00:00:00.000Z',
      })),
      importArtifact: vi.fn()
        .mockResolvedValueOnce({ ok: false, importStatus: 'rejected', message: 'Resolve project changed' })
        .mockImplementationOnce(async () => {
          await new Promise(resolve => setTimeout(resolve, 0));
          return { ok: true, importStatus: 'confirmed' as const, targetId: 'media-pool' };
        }),
    };
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project), selection: vi.fn(), registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })), run: vi.fn(async () => ({ artifactId: 'artifact-job-a' })),
      artifactGet: vi.fn(async () => ({ artifactId: 'artifact-a', mimeType: 'video/mp4', blob: new Blob(['candidate'], { type: 'video/mp4' }) })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `id-${++id}`);
    const candidate = await controller.prepareCandidate('Make rainy', { kind: 'media-pool' });

    await expect(controller.importCandidate(candidate.candidateId)).resolves.toMatchObject({ ok: false });
    const duplicateImport = controller.importCandidate(candidate.candidateId);
    const inFlightDuplicate = controller.importCandidate(candidate.candidateId);
    const results = await Promise.all([duplicateImport, inFlightDuplicate]);
    expect(results).toEqual([
      { ok: true, importStatus: 'confirmed', targetId: 'media-pool' },
      { ok: true, importStatus: 'confirmed', targetId: 'media-pool' },
    ]);
    await expect(controller.importCandidate(candidate.candidateId)).resolves.toMatchObject({ ok: true, importStatus: 'confirmed' });

    expect(host.importArtifact).toHaveBeenCalledTimes(2);
    expect(host.persistArtifact).toHaveBeenCalledTimes(1);
  });

  it('latches an unknown import result after an adapter throw and never blindly retries', async () => {
    const resolveSelection: HostSelection = {
      host: 'resolve', selectionId: 'clip-a', label: 'A.mov', kind: 'video',
      locator: { projectId: 'resolve-project-a', clipId: 'clip-a' }, mimeType: 'video/mp4',
    };
    const host: CreativeHostAdapter = {
      ...adapter(), id: 'resolve',
      getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'resolve', available: true, projectId: 'resolve-project-a', documentId: 'resolve-project-a' })),
      getSelection: vi.fn(async () => resolveSelection),
      materializeSelection: vi.fn(async (current: HostSelection): Promise<MaterializedHostSelection> => ({
        selection: current,
        resource: { resourceId: `creative-host:resolve:${current.selectionId}`, title: current.label, kind: current.kind, locator: { kind: 'creative-host', host: current.host, locator: current.locator } },
        reference: { id: 'ref-a', resourceId: `creative-host:resolve:${current.selectionId}`, resourceOrigin: 'creative-host', sourceId: current.selectionId, kind: current.kind, source: 'manual' },
        blob: new Blob(['source'], { type: 'video/mp4' }),
      })),
      persistArtifact: vi.fn(async artifact => ({
        status: 'persisted' as const, artifactId: artifact.artifactId!, taskId: artifact.taskId,
        sha256: artifact.sha256!, byteSize: artifact.byteSize!, mimeType: artifact.mimeType, createdAt: '2026-09-27T00:00:00.000Z',
      })),
      importArtifact: vi.fn(async () => { throw new Error('IPC channel disconnected after request'); }),
    };
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project), selection: vi.fn(), registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })), run: vi.fn(async () => ({ artifactId: 'artifact-job-a' })),
      artifactGet: vi.fn(async () => ({ artifactId: 'artifact-a', mimeType: 'video/mp4', blob: new Blob(['candidate'], { type: 'video/mp4' }) })),
    };
    let id = 0;
    const controller = new StudioWorkflowController(host, core, () => `id-${++id}`);
    const candidate = await controller.prepareCandidate('Make rainy', { kind: 'media-pool' });

    const first = await controller.importCandidate(candidate.candidateId);
    const repeated = await controller.importCandidate(candidate.candidateId);

    expect(first).toMatchObject({ ok: false, importStatus: 'unknown', artifactId: 'artifact-a', message: expect.stringContaining('结果未知') });
    expect(repeated).toBe(first);
    expect(host.importArtifact).toHaveBeenCalledTimes(1);
  });

  it('keeps legacy generate() auto-import behavior for existing non-Resolve hosts', async () => {
    const host = adapter();
    const core: FlovartStudioCore = {
      inspect: vi.fn(async () => project), selection: vi.fn(), registerHostResource: vi.fn(async () => undefined),
      apply: vi.fn(async () => ({ draftVersion: 4 })), run: vi.fn(async () => ({ artifactId: 'artifact-job' })),
      artifactGet: vi.fn(async () => ({ artifactId: 'artifact-1', mimeType: 'image/png', blob: new Blob(['result'], { type: 'image/png' }) })),
    };
    const controller = new StudioWorkflowController(host, core);

    const result = await controller.generate('Legacy Photoshop workflow');

    expect(host.importArtifact).toHaveBeenCalledTimes(1);
    expect(host.importArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifactId: 'artifact-1' }), undefined);
    expect(result.import).toMatchObject({ ok: true });
    expect(host.persistArtifact).toBeUndefined();
  });
});
