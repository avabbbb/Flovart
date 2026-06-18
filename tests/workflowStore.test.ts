import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorkflowProject,
  getWorkflowPersistenceError,
  subscribeWorkflowPersistenceError,
  useWorkflowStore,
  workflowPersistStorage,
  WORKFLOW_STORE_KEY,
  type PersistedWorkflowState,
} from '../components/workflow/store';
import type { WorkflowProject } from '../components/workflow/types';
import { workflowStorage } from '../components/workflow/storage';

const metadata: WorkflowProject['nodes'][number]['metadata'] = {
  content: '视频说明',
  prompt: '海边日落',
  richTextDocument: { type: 'doc', content: [{ type: 'paragraph' }] },
  storageKey: 'workflow/media/video-1',
  mimeType: 'video/mp4',
  bytes: 1024,
  naturalWidth: 1920,
  naturalHeight: 1080,
  durationMs: 5000,
  generationRequestId: 'request-1',
  generationHistoryId: 'history-1',
  status: 'error',
  error: 'provider unavailable',
  progress: 72,
  config: {
    mode: 'video',
    providerId: 'openai',
    modelId: 'sora',
    aspectRatio: '16:9',
    resolution: '1080p',
    durationSec: 5,
    quality: 'high',
    count: 1,
    generateAudio: true,
    watermark: false,
    audioVoice: 'alloy',
    audioFormat: 'mp3',
    audioSpeed: '1.0',
    audioInstructions: '保持自然语速',
  },
};

const agentSessions: WorkflowProject['agentSessions'] = [{
  id: 'session-1',
  title: '视频会话',
  messages: [{ id: 'message-1', role: 'assistant', text: '已创建', createdAt: '2026-01-01T00:00:00.000Z' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
}];

const videoNode = () => ({
  id: 'video-1',
  type: 'video' as const,
  title: '视频',
  position: { x: 0, y: 0 },
  width: 420,
  height: 236,
  metadata,
});

describe('workflow project persistence', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    useWorkflowStore.setState({ hydrated: true, projects: [], activeProjectId: null });
    await vi.advanceTimersByTimeAsync(400);
    await workflowStorage.clear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await vi.runOnlyPendingTimersAsync();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('creates projects with isolated graph state', () => {
    const project = createWorkflowProject('镜头工作流');

    expect(project.title).toBe('镜头工作流');
    expect(project.nodes).toEqual([]);
    expect(project.connections).toEqual([]);
    expect('elements' in project).toBe(false);
  });

  it('persists media, provider config, rich prompt, and session metadata', async () => {
    const projectId = useWorkflowStore.getState().createProject('A');
    useWorkflowStore.getState().updateProject(projectId, {
      nodes: [videoNode()],
      selectedNodeIds: ['video-1'],
      agentSessions,
      activeAgentSessionId: 'session-1',
    });

    await vi.advanceTimersByTimeAsync(400);
    const persisted = await workflowStorage.get<{
      state: { projects: WorkflowProject[]; activeProjectId: string | null };
    }>(WORKFLOW_STORE_KEY);

    expect(persisted?.state.activeProjectId).toBe(projectId);
    expect(persisted?.state.projects[0].nodes[0].metadata).toEqual(metadata);
    expect(persisted?.state.projects[0].selectedNodeIds).toEqual(['video-1']);
    expect(persisted?.state.projects[0].agentSessions).toEqual(agentSessions);
    expect(persisted?.state.projects[0].activeAgentSessionId).toBe('session-1');
  });

  it('fully rehydrates canonical project metadata and normalizes selection', async () => {
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    const projectId = useWorkflowStore.getState().createProject('A');
    useWorkflowStore.getState().updateProject(projectId, {
      nodes: [videoNode()],
      selectedNodeIds: ['missing', 'video-1'],
      backgroundMode: 'lines',
      agentSessions,
      activeAgentSessionId: 'session-1',
    });
    await vi.advanceTimersByTimeAsync(400);

    useWorkflowStore.setState({ hydrated: false, projects: [], activeProjectId: null });
    await useWorkflowStore.persist.rehydrate();

    expect(useWorkflowStore.getState()).toMatchObject({ hydrated: true, activeProjectId: projectId });
    expect(useWorkflowStore.getState().projects[0]).toEqual({
      id: projectId,
      title: 'A',
      nodes: [videoNode()],
      connections: [],
      selectedNodeIds: ['video-1'],
      viewport: { x: 0, y: 0, k: 1 },
      backgroundMode: 'lines',
      agentSessions,
      activeAgentSessionId: 'session-1',
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-01-02T03:04:05.000Z',
    });
  });

  it('coalesces debounced writes and resolves every waiter after the final value is stored', async () => {
    const set = vi.spyOn(workflowStorage, 'set').mockResolvedValue();
    const firstProject = createWorkflowProject('first');
    const lastProject = createWorkflowProject('last');
    const first = workflowPersistStorage.setItem(WORKFLOW_STORE_KEY, {
      state: { projects: [firstProject], activeProjectId: firstProject.id },
    });
    const lastValue: { state: PersistedWorkflowState } = {
      state: { projects: [lastProject], activeProjectId: lastProject.id },
    };
    const last = workflowPersistStorage.setItem(WORKFLOW_STORE_KEY, lastValue);

    await vi.advanceTimersByTimeAsync(400);

    await expect(Promise.all([first, last])).resolves.toEqual([undefined, undefined]);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(WORKFLOW_STORE_KEY, lastValue);
  });

  it('exposes store action persistence failures without an unhandled rejection', async () => {
    const failure = new Error('storage unavailable');
    vi.spyOn(workflowStorage, 'set').mockRejectedValue(failure);
    const listener = vi.fn();
    const unsubscribe = subscribeWorkflowPersistenceError(listener);

    const projectId = useWorkflowStore.getState().createProject('A');
    useWorkflowStore.getState().updateProject(projectId, { backgroundMode: 'lines' });

    await vi.advanceTimersByTimeAsync(400);
    unsubscribe();

    expect(getWorkflowPersistenceError()).toEqual({ operation: 'write', error: failure });
    expect(listener).toHaveBeenLastCalledWith({ operation: 'write', error: failure });
  });

  it('clearStorage cancels a queued write and resolves its waiter', async () => {
    const set = vi.spyOn(workflowStorage, 'set').mockResolvedValue();
    const remove = vi.spyOn(workflowStorage, 'remove').mockResolvedValue();
    const project = createWorkflowProject('A');
    const pending = workflowPersistStorage.setItem(WORKFLOW_STORE_KEY, {
      state: { projects: [project], activeProjectId: project.id },
    });

    useWorkflowStore.persist.clearStorage();

    await expect(pending).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(400);
    expect(set).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(WORKFLOW_STORE_KEY);
  });

  it('finishes hydration with an empty state when storage reads fail', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(workflowStorage, 'get').mockRejectedValue(new Error('storage unavailable'));
    useWorkflowStore.setState({ hydrated: false, projects: [], activeProjectId: null });

    await useWorkflowStore.persist.rehydrate();

    expect(useWorkflowStore.getState()).toMatchObject({ hydrated: true, projects: [], activeProjectId: null });
    expect(useWorkflowStore.persist.hasHydrated()).toBe(true);
    expect(getWorkflowPersistenceError()).toMatchObject({ operation: 'read' });
  });

  it('removes missing node ids while rehydrating persisted projects', async () => {
    const project = createWorkflowProject('A');
    project.nodes = [{ id: 'text-1', type: 'text', title: '文本', position: { x: 0, y: 0 }, width: 340, height: 220, metadata: {} }];
    project.selectedNodeIds = ['missing', 'text-1'];

    await workflowStorage.set(WORKFLOW_STORE_KEY, {
      state: { projects: [project], activeProjectId: project.id },
      version: 0,
    });
    await useWorkflowStore.persist.rehydrate();

    expect(useWorkflowStore.getState().projects[0].selectedNodeIds).toEqual(['text-1']);
  });
});
