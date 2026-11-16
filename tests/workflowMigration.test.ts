import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateWorkflowPersistedState, migrateWorkflowProjectsSafely, WORKFLOW_BACKUP_KEY, WORKFLOW_PERSISTENCE_VERSION, WORKFLOW_QUARANTINE_KEY } from '../components/workflow/migrations';
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

  it('writes the backup and drops an unrecoverable node instead of failing the whole migration', async () => {
    const legacyState = { projects: [{ ...legacyProject, nodes: [{ id: 'broken', type: null }, legacyProject.nodes[0]] }], activeProjectId: 'legacy-a' };
    const result = await migrateWorkflowPersistedState(legacyState, 0);
    expect(result.projects[0].nodes.map(node => node.id)).toEqual(['plugin-node']);
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

  it('recovers legacy manual groups that predate batchGroupSource', async () => {
    const project = {
      ...legacyProject,
      id: 'legacy-group',
      nodes: [
        { ...legacyProject.nodes[0], id: 'legacy-a', type: 'image', batchId: 'manual-legacy' },
        { ...legacyProject.nodes[0], id: 'legacy-b', type: 'image', batchId: 'manual-legacy' },
        { ...legacyProject.nodes[0], id: 'auto-a', type: 'image', batchId: 'auto-legacy', batchIndex: 0 },
        { ...legacyProject.nodes[0], id: 'auto-b', type: 'image', batchId: 'auto-legacy', batchIndex: 1 },
      ],
    };
    const result = await migrateWorkflowPersistedState({ projects: [project], activeProjectId: project.id }, 2);
    const nodes = result.projects[0].nodes;
    // v5：手动分组迁移成分组框，成员挂 parentId，不再占用 batchId。
    const frame = nodes.find(node => node.type === 'subgraph' && node.metadata.groupKind === 'group')!;
    expect(frame).toBeTruthy();
    expect(nodes.filter(node => node.parentId === frame.id).map(node => node.id).sort()).toEqual(['legacy-a', 'legacy-b']);
    expect(nodes.some(node => node.batchId === 'manual-legacy')).toBe(false);
    expect(nodes.filter(node => node.batchId === 'auto-legacy').every(node => node.batchGroupSource === undefined)).toBe(true);
  });

  it('rehydrates a legacy storage envelope through the store migration and writes the current version', async () => {
    await workflowStorage.set(WORKFLOW_STORE_KEY, { state: { projects: [legacyProject], activeProjectId: legacyProject.id }, version: 0 });
    await useWorkflowStore.persist.rehydrate();
    expect(useWorkflowStore.getState().projects[0].nodes[0].type).toBe('plugin:storyboard');
    const persisted = await workflowStorage.get<{ version: number }>(WORKFLOW_STORE_KEY);
    expect(persisted?.version).toBe(WORKFLOW_PERSISTENCE_VERSION);
  });

  // 2026-11-16 内置 Agent 实测 P0-1：Agent 写入无 id 节点 + 悬空连线后，刷新永远停在「正在加载 Workflow...」。
  // 形状取自 .tmp/eval/sim-bricked-project.json（当前版本 4 的信封，走 merge 而非 migrate）。
  const brickedProject = {
    id: '4S-q5Xm0r5VmOPBeWEnLn',
    title: '未命名工作流',
    nodes: [
      { id: 'PiC0NQuw4TTxoezyWPZAR', type: 'image', title: '图片 1', position: { x: 72, y: 140 }, width: 240, height: 320, isVisible: true, isLocked: false, metadata: { status: 'success', storageKey: 'workflow-media-x', mimeType: 'image/webp' }, objectVersion: 3 },
      { type: 'config', title: '空会议室·风格参考生成', position: { x: 420, y: 140 }, width: 360, height: 260, isVisible: true, isLocked: false, metadata: { prompt: '空会议室', status: 'idle', config: { mode: 'image', resolution: '1K', count: 2 }, origin: 'agent' }, objectVersion: 1 },
    ],
    connections: [{ id: 'FDHX7zcnSOrOfJ2H3JfUp', fromNodeId: 'PiC0NQuw4TTxoezyWPZAR', objectVersion: 1 }],
    selectedNodeIds: [null],
    viewport: { x: 0, y: 0, k: 1 },
    draftVersion: 5,
  };

  it('opens every workflow after a bricked agent write: repairs the id-less node and drops the dangling edge', async () => {
    await workflowStorage.set(WORKFLOW_STORE_KEY, {
      state: { projects: [brickedProject, { ...legacyProject, id: 'healthy' }, { title: '没有 id 的项目', nodes: [] }], activeProjectId: brickedProject.id },
      version: WORKFLOW_PERSISTENCE_VERSION,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await useWorkflowStore.persist.rehydrate();
    const state = useWorkflowStore.getState();
    expect(state.hydrated).toBe(true);
    expect(state.projects.map(project => project.id)).toEqual([brickedProject.id, 'healthy']);
    expect(state.activeProjectId).toBe(brickedProject.id);
    const repaired = state.projects[0];
    expect(repaired.nodes).toHaveLength(2);
    expect(repaired.nodes.every(node => typeof node.id === 'string' && node.id.length > 0)).toBe(true);
    expect(repaired.nodes[1]).toMatchObject({ type: 'config', title: '空会议室·风格参考生成', metadata: { prompt: '空会议室' } });
    expect(repaired.connections).toEqual([]);
    expect(repaired.selectedNodeIds).toEqual([]);
  });

  it('keeps unrecoverable projects in quarantine instead of discarding them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const projects = migrateWorkflowProjectsSafely([{ title: 'no id' }, { ...legacyProject, id: 'ok' }]);
    expect(projects.map(project => project.id)).toEqual(['ok']);
    await vi.waitFor(async () => expect(await workflowStorage.get(WORKFLOW_QUARANTINE_KEY)).toContainEqual({ title: 'no id' }));
  });

  it('repairs duplicate node ids instead of collapsing two nodes into one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const [project] = migrateWorkflowProjectsSafely([{ ...legacyProject, nodes: [legacyProject.nodes[0], legacyProject.nodes[0]] }]);
    expect(new Set(project.nodes.map(node => node.id)).size).toBe(2);
  });
});
