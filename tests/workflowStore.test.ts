import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowProject, useWorkflowStore, WORKFLOW_STORE_KEY } from '../components/workflow/store';
import type { WorkflowProject } from '../components/workflow/types';
import { workflowStorage } from '../components/workflow/storage';

describe('workflow project persistence', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await workflowStorage.clear();
    useWorkflowStore.setState({ hydrated: true, projects: [], activeProjectId: null });
  });

  afterEach(() => {
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
    const metadata: WorkflowProject['nodes'][number]['metadata'] = {
      content: '视频说明',
      prompt: '海边日落',
      richTextDocument: { type: 'doc', content: [{ type: 'paragraph' }] },
      href: 'data:video/mp4;base64,AAAA',
      poster: 'data:image/jpeg;base64,BBBB',
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
    const projectId = useWorkflowStore.getState().createProject('A');
    useWorkflowStore.getState().updateProject(projectId, {
      nodes: [{
        id: 'video-1',
        type: 'video',
        title: '视频',
        position: { x: 0, y: 0 },
        width: 420,
        height: 236,
        metadata,
      }],
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
