import { nanoid } from 'nanoid';
import type { WorkflowNamedSnapshot, WorkflowProject } from './types';

export const WORKFLOW_SNAPSHOT_LIMIT = 30;
export const WORKFLOW_SNAPSHOT_NAME_MAX = 60;

const pad = (value: number) => String(value).padStart(2, '0');

export function defaultWorkflowSnapshotName(now = new Date()): string {
  return '快照 ' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
}

// 快照只保存文档本身（节点、连线、视口）；媒体仍按 storageKey 引用，由 media 模块保持可达。
export function createWorkflowSnapshot(
  project: Pick<WorkflowProject, 'nodes' | 'connections' | 'viewport'>,
  name: string,
  now = new Date(),
  id: string = nanoid(),
): WorkflowNamedSnapshot {
  return {
    id,
    name: name.trim().slice(0, WORKFLOW_SNAPSHOT_NAME_MAX) || defaultWorkflowSnapshotName(now),
    createdAt: now.toISOString(),
    nodes: structuredClone(project.nodes),
    connections: structuredClone(project.connections),
    viewport: { ...project.viewport },
  };
}

export function addWorkflowSnapshot(list: WorkflowNamedSnapshot[] | undefined, snapshot: WorkflowNamedSnapshot): WorkflowNamedSnapshot[] {
  return [...(list || []), snapshot].slice(-WORKFLOW_SNAPSHOT_LIMIT);
}

export function removeWorkflowSnapshot(list: WorkflowNamedSnapshot[] | undefined, id: string): WorkflowNamedSnapshot[] {
  return (list || []).filter(snapshot => snapshot.id !== id);
}

export function renameWorkflowSnapshot(list: WorkflowNamedSnapshot[] | undefined, id: string, name: string): WorkflowNamedSnapshot[] {
  const next = name.trim().slice(0, WORKFLOW_SNAPSHOT_NAME_MAX);
  if (!next) return list || [];
  return (list || []).map(snapshot => (snapshot.id === id ? { ...snapshot, name: next } : snapshot));
}

// 恢复时返回独立副本，避免画布编辑反向修改已保存的快照。
export function workflowSnapshotFrame(snapshot: WorkflowNamedSnapshot) {
  return { nodes: structuredClone(snapshot.nodes), connections: structuredClone(snapshot.connections) };
}
