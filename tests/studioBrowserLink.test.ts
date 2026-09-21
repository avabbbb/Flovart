import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

import { installStudioBrowserLink } from '../services/studio/browserLink';
import { registerWorkflowArtifact, clearWorkflowArtifacts } from '../services/studio/artifactRegistry';
import { setWorkflowExecutor, dispatchWorkflowCommand } from '../services/workflowDispatcher';
import { createWorkflowExecutor } from '../services/workflowExecutor';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { CreativeHostAdapter, HostContext, HostSelection, MaterializedHostSelection } from '../services/studio/studioContract';

const selection: HostSelection = {
  host: 'photoshop',
  selectionId: 'layer-1',
  label: 'Hero',
  kind: 'image',
  locator: { documentId: 'doc-1', layerId: 1 },
  mimeType: 'image/png',
};

function hostAdapter(): CreativeHostAdapter {
  return {
    id: 'photoshop',
    getContext: vi.fn(async (): Promise<HostContext> => ({ host: 'photoshop', available: true, title: 'Poster.psd', documentId: 'doc-1' })),
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

function workspaceWithSelectedImage() {
  const project = createWorkflowProject('Link 测试');
  project.id = 'project-link';
  project.nodes = [createWorkflowNode('image-1', 'image', { x: 0, y: 0 })];
  project.nodes[0].metadata.storageKey = 'workflow-media/source';
  project.selectedNodeIds = ['image-1'];
  useWorkflowStore.setState({ projects: [project], activeProjectId: project.id, hydrated: true });
  return project;
}

beforeEach(() => {
  clearWorkflowArtifacts();
  delete (globalThis as Record<string, unknown>).__FLOVART_STUDIO_CONTROLLER__;
  delete (globalThis as Record<string, unknown>).__FLOVART_BROWSER_WORKSPACE__;
  delete (globalThis as Record<string, unknown>).__FLOVART_OPEN_CANVAS__;
});

afterEach(() => {
  setWorkflowExecutor(undefined);
  useWorkflowStore.setState({ projects: [], activeProjectId: null, hydrated: true });
  clearWorkflowArtifacts();
});

describe('Studio Browser-Link bridge', () => {
  it('routes panel generate() through dispatchWorkflowCommand → draftAuthority and returns the artifactId', async () => {
    const project = workspaceWithSelectedImage();
    const revisionBefore = project.draftVersion || 1;

    // Executor mirrors App.tsx: a completed run registers a session artifact bound to a stored blob.
    const runNode = vi.fn().mockImplementation(async () => {
      await workflowMediaStorage.set('workflow-media/result', new Blob(['result'], { type: 'image/png' }));
      registerWorkflowArtifact({ artifactId: 'artifact-run-1', storageKey: 'workflow-media/result', kind: 'image', mimeType: 'image/png' });
      return { status: 'completed', artifact: { artifactId: 'artifact-run-1', kind: 'image', mimeType: 'image/png' } };
    });
    setWorkflowExecutor(createWorkflowExecutor({ runNode }, { createRunId: () => 'run-link-1' }));

    const link = installStudioBrowserLink({ adapter: hostAdapter() });
    const controller = (globalThis as Record<string, unknown>).__FLOVART_STUDIO_CONTROLLER__ as { generate: (prompt: string, target?: unknown) => Promise<unknown> };
    expect(controller).toBe(link.controller);

    const result = await controller.generate('做成夜景海报') as {
      projectId: string;
      executionTarget: { revision: number; hostTarget: string };
      import: { ok: boolean };
      run: unknown;
    };

    // generate() reached studioWorkflowController.generate → core.apply + core.run
    // → dispatchWorkflowCommand → applyWorkflowMutation: the draft version moved
    // and the source/target nodes were committed to the real store project.
    const committed = useWorkflowStore.getState().projects.find(item => item.id === project.id)!;
    expect(committed.draftVersion).toBeGreaterThan(revisionBefore);
    expect(committed.nodes.length).toBe(3); // image-1 + source + target
    expect(committed.workflowMutationReceipts?.length).toBeGreaterThan(0);
    expect(runNode).toHaveBeenCalledOnce();
    expect(result.projectId).toBe(project.id);
    expect(result.executionTarget.revision).toBe(revisionBefore);
    expect(result.import).toMatchObject({ ok: true });
    link.dispose();
  });

  it('keeps target/revision/idempotency inside draftAuthority — not on the bridge', async () => {
    const project = workspaceWithSelectedImage();
    const runNode = vi.fn().mockResolvedValue({ status: 'completed', artifact: { artifactId: 'artifact-x', kind: 'image', mimeType: 'image/png' } });
    setWorkflowExecutor(createWorkflowExecutor({ runNode }));
    installStudioBrowserLink({ adapter: hostAdapter() });

    // Same apply payload + same mutationId → draftAuthority replays the receipt
    // (replayed:true), applies once. This is the path studio generate() uses.
    const node = createWorkflowNode('fixed-node', 'text', { x: 0, y: 0 });
    const ops = [{ type: 'add_node', node }];
    const applyArgs = { projectId: project.id, expectedRevision: project.draftVersion || 1, mutationId: 'm-1', idempotencyKey: 'm-1', operations: ops };
    const first = await dispatchWorkflowCommand({ id: 'p1', command: 'workflow.apply', source: 'operator', idempotencyKey: 'm-1', args: applyArgs });
    const replay = await dispatchWorkflowCommand({ id: 'p2', command: 'workflow.apply', source: 'operator', idempotencyKey: 'm-1', args: applyArgs });
    expect(first.ok).toBe(true);
    expect(replay).toMatchObject({ ok: true, result: { replayed: true } });
    const committed = useWorkflowStore.getState().projects.find(item => item.id === project.id)!;
    expect(committed.nodes.filter(item => item.id === 'fixed-node')).toHaveLength(1);

    // Divergent payload under the same key is rejected by the receipt, not by
    // any bridge-side cache — proof the authority, not the link, owns it.
    const divergent = await dispatchWorkflowCommand({
      id: 'p3', command: 'workflow.apply', source: 'operator', idempotencyKey: 'm-1',
      args: { ...applyArgs, operations: [{ type: 'add_node', node: createWorkflowNode('other-node', 'text', { x: 0, y: 0 }) }] },
    });
    expect(divergent.ok).toBe(false);
    expect(divergent.error?.code).toBe('IDEMPOTENCY_KEY_REUSE');
  });

  it('fails explicitly (not fake success) when no Workflow project is open', async () => {
    useWorkflowStore.setState({ projects: [], activeProjectId: null, hydrated: true });
    const link = installStudioBrowserLink({ adapter: hostAdapter() });
    expect(link.status().state).toBe('unavailable');
    await expect(link.controller.generate('生成')).rejects.toMatchObject({ code: 'WORKSPACE_UNAVAILABLE', retryable: true });
    link.dispose();
  });

  it('exposes a live __FLOVART_BROWSER_WORKSPACE__ getter that the shared host-contract adapter binds to', async () => {
    const project = workspaceWithSelectedImage();
    await workflowMediaStorage.set('workflow-media/source', new Blob(['source'], { type: 'image/png' }));
    const link = installStudioBrowserLink();

    const source = readFileSync(join(process.cwd(), 'integrations', 'studio', 'shared', 'host-contract.js'), 'utf8');
    const sandbox = { Blob, setInterval, clearInterval, console, window: undefined as unknown };
    vm.runInNewContext(source, sandbox);
    const hosts = (sandbox as Record<string, any>).FlovartStudioHosts;
    // The panel-side adapter resolves through the injected live getter.
    const workspace = (globalThis as Record<string, any>).__FLOVART_BROWSER_WORKSPACE__;
    const adapter = hosts.createBrowserWorkspaceAdapter({ workspace });

    const context = await adapter.getContext();
    expect(context).toMatchObject({ host: 'browser-workspace', available: true, projectId: project.id });
    const selected = await adapter.getSelection();
    expect(selected).toMatchObject({ host: 'browser-workspace', selectionId: 'image-1', locator: { projectId: project.id, nodeId: 'image-1' } });

    // Live getter: changing store selection is visible on next read — no snapshot copy.
    project.selectedNodeIds = [];
    useWorkflowStore.setState({ projects: [{ ...project }] });
    await expect(adapter.getSelection()).resolves.toBeNull();
    link.dispose();
  });
});
