import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateWorkflowPersistedState, WORKFLOW_BACKUP_KEY, WORKFLOW_PERSISTENCE_VERSION } from '../components/workflow/migrations';
import { useWorkflowStore, workflowPersistStorage, WORKFLOW_STORE_KEY } from '../components/workflow/store';
import { workflowStorage } from '../components/workflow/storage';

const legacyProject = {
  id: 'legacy-a',
  title: '旧项目 A',
  nodes: [{ id: 'plugin-node', type: 'plugin:storyboard', title: '插件节点', position: { x: 12, y: 24 }, metadata: { pluginData: { version: 1 } } }],
  connections: [],
  selectedNodeIds: ['plugin-node', 'missing'],
  viewport: { x: 4, y: 8, k: 1.25 },
  agentSessions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('workflow persistence migrations', () => {
  beforeEach(async () => {
    await workflowStorage.clear();
    useWorkflowStore.setState({ hydrated: false, projects: [], activeProjectId: null });
  });

  afterEach(() => vi.restoreAllMocks());

  it('migrates old project shapes without deleting unknown plugin nodes', async () => {
    const result = await migrateWorkflowPersistedState({ projects: [legacyProject], activeProjectId: legacyProject.id }, 0);
    expect(result.activeProjectId).toBe('legacy-a');
    expect(result.projects[0]).toMatchObject({
      draftVersion: 1,
      selectedNodeIds: ['plugin-node'],
      nodes: [{ id: 'plugin-node', type: 'plugin:storyboard', objectVersion: 1, isVisible: true, isLocked: false }],
    });
    expect(await workflowStorage.get(WORKFLOW_BACKUP_KEY)).toMatchObject({ version: 0, state: { activeProjectId: 'legacy-a' } });
  });

  it('accepts a second legacy shape with missing optional collections and filters broken edges', async () => {
    const result = await migrateWorkflowPersistedState({
      projects: [{ ...legacyProject, id: 'legacy-b', nodes: [{ ...legacyProject.nodes[0], id: 'node-b', width: 0, height: -1 }], connections: [{ fromNodeId: 'node-b', toNodeId: 'missing' }] }],
      activeProjectId: 'legacy-b',
    }, 0);
    expect(result.projects[0]).toMatchObject({ id: 'legacy-b', draftVersion: 1, draftChangeSets: [], draftRedoStack: [], workflowMutationReceipts: [], connections: [] });
    expect(result.projects[0].nodes[0]).toMatchObject({ width: 320, height: 200 });
  });

  it('preserves a resource-rich third historical shape across migration', async () => {
    const project = {
      ...legacyProject,
      id: 'legacy-c',
      title: '旧项目 C',
      nodes: [
        { ...legacyProject.nodes[0], id: 'source-c', type: 'image', metadata: {
          href: 'https://fixture.invalid/source-c.png',
          artifactRef: { taskId: 'task-c', kind: 'image', mimeType: 'image/png' },
          browserImport: { importId: 'import-c', artifactId: 'artifact-c', contentHash: 'hash-c' },
        } },
        { ...legacyProject.nodes[0], id: 'plugin-c', type: 'plugin:storyboard', metadata: { pluginData: { version: 3 } } },
      ],
      connections: [{ id: 'edge-c', fromNodeId: 'source-c', toNodeId: 'plugin-c', kind: 'data' }],
      providerConfig: { providerId: 'fixture-provider', modelId: 'fixture-image' },
      generationHistory: [{ taskId: 'task-c', status: 'success' }],
      assets: [{ id: 'asset-c', name: '素材 C', kind: 'image' }],
    };
    const result = await migrateWorkflowPersistedState({ projects: [project], activeProjectId: project.id }, 0);
    expect(result.projects[0]).toMatchObject({
      id: 'legacy-c',
      providerConfig: { providerId: 'fixture-provider', modelId: 'fixture-image' },
      generationHistory: [{ taskId: 'task-c', status: 'success' }],
      assets: [{ id: 'asset-c' }],
      connections: [{ id: 'edge-c', fromNodeId: 'source-c', toNodeId: 'plugin-c' }],
      nodes: [
        { id: 'source-c', metadata: { artifactRef: { taskId: 'task-c' }, browserImport: { artifactId: 'artifact-c' } } },
        { id: 'plugin-c', type: 'plugin:storyboard' },
      ],
    });
  });

  it('writes the backup before a migration exception and leaves source state untouched', async () => {
    const legacyState = { projects: [{ ...legacyProject, nodes: [{ id: 'broken', type: null }] }], activeProjectId: 'legacy-a' };
    await expect(migrateWorkflowPersistedState(legacyState, 0)).rejects.toThrow('缺少 id 或 type');
    expect(await workflowStorage.get(WORKFLOW_BACKUP_KEY)).toMatchObject({ version: 0, state: legacyState });
  });

  it('does not replace the source when taking a backup fails', async () => {
    const failure = new Error('storage unavailable');
    vi.spyOn(workflowStorage, 'set').mockRejectedValueOnce(failure);
    await expect(migrateWorkflowPersistedState({ projects: [legacyProject], activeProjectId: legacyProject.id }, 0)).rejects.toBe(failure);
  });

  it('recovers a truncated current envelope from the migration backup', async () => {
    await workflowStorage.set(WORKFLOW_BACKUP_KEY, { version: 0, state: { projects: [legacyProject], activeProjectId: legacyProject.id } });
    vi.spyOn(workflowStorage, 'get').mockRejectedValueOnce(new SyntaxError('Unexpected end of JSON input'));
    await expect(workflowPersistStorage.getItem(WORKFLOW_STORE_KEY)).resolves.toMatchObject({
      version: 0,
      state: { activeProjectId: 'legacy-a' },
    });
  });

  it('migrates legacy prompt text nodes into isolated notes with merge targets', async () => {
    const project = {
      ...legacyProject,
      id: 'legacy-note',
      nodes: [
        { ...legacyProject.nodes[0], id: 'note-a', type: 'text', title: '旧提示词', metadata: { content: '镜头缓慢推进' } },
        { ...legacyProject.nodes[0], id: 'video-a', type: 'video', title: '视频', metadata: { prompt: '已有提示词' } },
        { ...legacyProject.nodes[0], id: 'op-a', type: 'operation', title: '处理', metadata: {
          operation: { capabilityId: 'image.generate@1', recipe: { inputBindings: [{ id: 'b1', sourceNodeId: 'note-a', role: 'prompt_context', order: 0 }] }, takes: [] },
        } },
      ],
      connections: [
        { id: 'note-video', fromNodeId: 'note-a', toNodeId: 'video-a', kind: 'data' },
        { id: 'note-op', fromNodeId: 'note-a', toNodeId: 'op-a', kind: 'data' },
      ],
    };
    const result = await migrateWorkflowPersistedState({ projects: [project], activeProjectId: project.id }, 2);
    const migrated = result.projects[0];
    expect(migrated.connections).toEqual([]);
    expect(migrated.nodes.find(node => node.id === 'note-a')).toMatchObject({
      metadata: { content: '镜头缓慢推进', noteMergeTargetIds: expect.arrayContaining(['video-a', 'op-a']) },
    });
    const operationNode = migrated.nodes.find(node => node.id === 'op-a');
    expect(operationNode?.metadata.operation?.recipe.inputBindings).toEqual([]);
  });

  it('rehydrates a legacy storage envelope through the store migration and writes the current version', async () => {
    await workflowStorage.set(WORKFLOW_STORE_KEY, { state: { projects: [legacyProject], activeProjectId: legacyProject.id }, version: 0 });
    await useWorkflowStore.persist.rehydrate();
    expect(useWorkflowStore.getState().projects[0].nodes[0].type).toBe('plugin:storyboard');
    const persisted = await workflowStorage.get<{ version: number }>(WORKFLOW_STORE_KEY);
    expect(persisted?.version).toBe(WORKFLOW_PERSISTENCE_VERSION);
  });
});
