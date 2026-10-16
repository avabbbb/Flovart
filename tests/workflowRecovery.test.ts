import { describe, expect, it } from 'vitest';
import { findInterruptedWorkflowNodes } from '../services/workflowGeneration';
import type { WorkflowProject } from '../components/workflow/types';

const node = (id: string, metadata: Record<string, unknown>) => ({ id, type: 'video', metadata });

const project = {
  id: 'reload-project',
  nodes: [
    node('video-with-task', { status: 'loading', config: { mode: 'video' }, generationProviderTaskId: 'task-1' }),
    node('video-no-task', { status: 'loading', config: { mode: 'video' } }),
    node('image-loading', { status: 'loading', config: { mode: 'image' }, generationProviderTaskId: 'task-2' }),
    node('idle', { status: 'idle', config: { mode: 'video' } }),
  ],
  connections: [],
} as unknown as WorkflowProject;

const ids = (canResume: boolean) => findInterruptedWorkflowNodes(project, { canResume }).map(item => item.id);

describe('reload 后的 loading 节点恢复', () => {
  it('有 key 时只保留可续接的视频任务，其余 persisted loading 节点都判为中断', () => {
    expect(ids(true)).toEqual(['video-no-task', 'image-loading']);
  });

  it('零 key 时带 task ID 的视频也无法续接，不能永远转圈', () => {
    expect(ids(false)).toEqual(['video-with-task', 'video-no-task', 'image-loading']);
  });
});
