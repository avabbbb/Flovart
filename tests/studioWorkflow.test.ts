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
    expect(result.import).toMatchObject({ ok: true, targetId: 'new-layer' });
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
});
