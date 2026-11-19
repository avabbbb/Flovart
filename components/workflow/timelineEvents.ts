import localforage from 'localforage';
import { nanoid } from 'nanoid';
import { create } from 'zustand';

import type { WorkflowExecutionSurface, WorkflowRunAdapterResult } from '../../services/workflowExecutor';
import { useWorkflowStore } from './store';
import type { WorkflowNode } from './types';
import type { TimelineActor, WorkflowTimelineEvent } from './timeline';

// Timeline 的补充日志：生成结果不走 ChangeSet（不推进 rev），在这里按画布追加记录。
// 有界追加（每个画布最近 500 条），独立的 localforage 实例，不进入 Workflow 主持久化（不动 version 4）。

export const WORKFLOW_TIMELINE_EVENT_LIMIT = 500;
const storage = localforage.createInstance({ name: 'iris', storeName: 'workflow_timeline_v1' });

export const actorFromSurface = (surface: WorkflowExecutionSurface | undefined): TimelineActor => (
  surface === 'browser-agent' ? 'agent' : surface === 'cli' || surface === 'dsh' || surface === 'runtime' ? 'external' : 'you'
);

/** 生成历史的来源标记（只在新记录上有）。 */
export const historyOriginFromSurface = (surface: WorkflowExecutionSurface | undefined): 'user' | 'agent' | 'external-agent' | undefined => {
  if (surface === 'browser-agent') return 'agent';
  if (surface === 'cli' || surface === 'dsh' || surface === 'runtime') return 'external-agent';
  if (surface === 'ui') return 'user';
  return undefined;
};

export function appendTimelineEvent(list: WorkflowTimelineEvent[], event: WorkflowTimelineEvent, limit = WORKFLOW_TIMELINE_EVENT_LIMIT) {
  if (list.some(item => item.id === event.id)) return list;
  return [...list, event].slice(-limit);
}

interface TimelineEventState {
  byProject: Record<string, WorkflowTimelineEvent[]>;
  loaded: Record<string, boolean>;
  load: (projectId: string) => Promise<void>;
  record: (event: Omit<WorkflowTimelineEvent, 'id' | 'at'> & { id?: string; at?: string }) => Promise<void>;
}

export const useWorkflowTimelineEvents = create<TimelineEventState>((set, get) => ({
  byProject: {},
  loaded: {},
  load: async projectId => {
    if (get().loaded[projectId]) return;
    let stored: unknown = null;
    try { stored = await storage.getItem(projectId); } catch { stored = null; }
    const list = Array.isArray(stored) ? (stored as WorkflowTimelineEvent[]).filter(item => item && typeof item.id === 'string' && typeof item.at === 'string') : [];
    // 加载期间可能已经记了新事件：合并而不是覆盖。
    set(state => ({
      byProject: { ...state.byProject, [projectId]: (state.byProject[projectId] || []).reduce((acc, event) => appendTimelineEvent(acc, event), list) },
      loaded: { ...state.loaded, [projectId]: true },
    }));
  },
  record: async input => {
    const event: WorkflowTimelineEvent = { ...input, id: input.id || nanoid(), at: input.at || new Date().toISOString() };
    if (!get().loaded[event.projectId]) await get().load(event.projectId);
    const next = appendTimelineEvent(get().byProject[event.projectId] || [], event);
    set(state => ({ byProject: { ...state.byProject, [event.projectId]: next } }));
    try { await storage.setItem(event.projectId, next); } catch { /* Timeline 是辅助记录，写失败不影响画布。 */ }
  },
}));

export function recordWorkflowTimelineEvent(input: Omit<WorkflowTimelineEvent, 'id' | 'at'> & { id?: string; at?: string }) {
  void useWorkflowTimelineEvents.getState().record(input);
}

const mediaTypeOf = (node: WorkflowNode | undefined): WorkflowTimelineEvent['mediaType'] => {
  if (!node) return 'image';
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio' || node.type === 'text') return node.type as WorkflowTimelineEvent['mediaType'];
  const mode = node.metadata?.config?.mode;
  return mode === 'video' || mode === 'audio' || mode === 'text' ? mode : 'image';
};

/** 执行器一次运行结束后调用：完成记「生成了」，失败记「生成失败」，取消不记。 */
export function recordWorkflowRunInTimeline(projectId: string, nodeId: string, surface: WorkflowExecutionSurface | undefined, result: WorkflowRunAdapterResult | void) {
  if (!result || (result.status !== 'completed' && result.status !== 'failed')) return;
  const project = useWorkflowStore.getState().projects.find(item => item.id === projectId);
  if (!project) return;
  const outputIds = result.outputs?.nodeIds?.length ? result.outputs.nodeIds : [result.outputs?.headNodeId || nodeId];
  const nodes = outputIds.map(id => project.nodes.find(node => node.id === id)).filter((node): node is WorkflowNode => Boolean(node));
  const head = nodes[0] || project.nodes.find(node => node.id === nodeId);
  recordWorkflowTimelineEvent({
    projectId,
    revision: project.draftVersion || 1,
    actor: actorFromSurface(surface),
    kind: result.status === 'completed' ? 'generated' : 'failed',
    mediaType: mediaTypeOf(head),
    nodeIds: nodes.length ? nodes.map(node => node.id) : [nodeId],
    nodeTitles: head ? [head.title] : [],
    count: result.status === 'completed' ? Math.max(1, result.outputs?.nodeIds?.length || 1) : undefined,
  });
}
