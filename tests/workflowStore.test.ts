import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkflowProject, useWorkflowStore, WORKFLOW_STORE_KEY } from '../components/workflow/store';
import type { WorkflowProject } from '../components/workflow/types';
import { workflowStorage } from '../components/workflow/storage';

describe('workflow project persistence', () => {
  beforeEach(async () => {
    await workflowStorage.clear();
    useWorkflowStore.setState({ hydrated: true, projects: [], activeProjectId: null });
  });

  it('creates projects with isolated graph state', () => {
    const project = createWorkflowProject('镜头工作流');

    expect(project.title).toBe('镜头工作流');
    expect(project.nodes).toEqual([]);
    expect(project.connections).toEqual([]);
    expect('elements' in project).toBe(false);
  });

  it('persists media, provider config, rich prompt, and session metadata', async () => {
    const project: WorkflowProject = {
      ...createWorkflowProject('A'),
      id: 'project-a',
      nodes: [{
        id: 'video-1',
        type: 'video',
        title: '视频',
        position: { x: 0, y: 0 },
        width: 420,
        height: 236,
        metadata: {
          prompt: '海边日落',
          richTextDocument: { type: 'doc', content: [{ type: 'paragraph' }] },
          storageKey: 'workflow/media/video-1',
          mimeType: 'video/mp4',
          bytes: 1024,
          naturalWidth: 1920,
          naturalHeight: 1080,
          durationMs: 5000,
          generationRequestId: 'request-1',
          status: 'success',
          config: { mode: 'video', providerId: 'openai', modelId: 'sora', durationSec: 5 },
        },
      }],
      selectedNodeIds: ['video-1'],
      agentSessions: [{
        id: 'session-1',
        title: '视频会话',
        messages: [{ id: 'message-1', role: 'assistant', text: '已创建', createdAt: '2026-01-01T00:00:00.000Z' }],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
      }],
      activeAgentSessionId: 'session-1',
    };

    await workflowStorage.set(WORKFLOW_STORE_KEY, {
      state: { projects: [project], activeProjectId: project.id },
      version: 0,
    });
    await useWorkflowStore.persist.rehydrate();

    expect(useWorkflowStore.getState()).toMatchObject({
      activeProjectId: 'project-a',
      projects: [{
        nodes: [{ metadata: {
          richTextDocument: { type: 'doc' },
          storageKey: 'workflow/media/video-1',
          generationRequestId: 'request-1',
          config: { mode: 'video', providerId: 'openai', modelId: 'sora' },
        } }],
        agentSessions: [{ id: 'session-1', messages: [{ id: 'message-1' }] }],
        activeAgentSessionId: 'session-1',
      }],
    });
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
