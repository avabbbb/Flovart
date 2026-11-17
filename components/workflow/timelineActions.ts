import { nanoid } from 'nanoid';

import { applyWorkflowMutation, workflowDocumentOperationsFromFrames } from './draftAuthority';
import { addWorkflowSnapshot, createWorkflowSnapshot, WORKFLOW_SNAPSHOT_LIMIT } from './snapshots';
import { useWorkflowStore } from './store';
import { planWorkflowRestore } from './timeline';
import type { WorkflowNamedSnapshot } from './types';

// Timeline 的两个写操作。都不改写历史：
// - 另存快照：只往 snapshots 里加一份（快照里的节点让媒体保持可达）。
// - 恢复到此版本：先把当前画布存成快照，再把目标帧作为一次新的、可撤销的 ui 修改提交。

const projectOf = (projectId: string) => useWorkflowStore.getState().projects.find(project => project.id === projectId);

/** 恢复前确认需要的信息：会撤回几次修改、会不会挤掉最早的快照。 */
export function describeWorkflowRestore(projectId: string, changeSetId: string) {
  const project = projectOf(projectId);
  if (!project) return null;
  const plan = planWorkflowRestore(project, changeSetId);
  if (plan.ok === false) return { ok: false as const, reason: plan.reason };
  const snapshots = project.snapshots || [];
  const evicted: WorkflowNamedSnapshot | undefined = snapshots.length >= WORKFLOW_SNAPSHOT_LIMIT ? snapshots[0] : undefined;
  return { ok: true as const, undoCount: plan.undoCount, revision: plan.revision, currentRevision: project.draftVersion || 1, evicted };
}

export function saveWorkflowTimelineSnapshot(projectId: string, changeSetId: string | undefined, name: string) {
  const project = projectOf(projectId);
  if (!project) return null;
  let frame = { nodes: project.nodes, connections: project.connections };
  if (changeSetId) {
    const plan = planWorkflowRestore(project, changeSetId);
    if (plan.ok === true) frame = plan.frame;
    else if (plan.reason !== 'latest') return null;
  }
  const snapshot = createWorkflowSnapshot({ ...frame, viewport: project.viewport }, name);
  useWorkflowStore.getState().updateProject(projectId, { snapshots: addWorkflowSnapshot(project.snapshots, snapshot) });
  return snapshot;
}

export function restoreWorkflowToChangeSet(projectId: string, changeSetId: string, safetyName: string): { ok: true; revision: number } | { ok: false } {
  const project = projectOf(projectId);
  if (!project) return { ok: false };
  const plan = planWorkflowRestore(project, changeSetId);
  if (plan.ok === false) return { ok: false };
  const ops = workflowDocumentOperationsFromFrames({ nodes: project.nodes, connections: project.connections }, plan.frame);
  if (!ops.length) return { ok: true, revision: plan.revision };
  const safety = createWorkflowSnapshot(project, safetyName);
  const withSafety = { ...project, snapshots: addWorkflowSnapshot(project.snapshots, safety) };
  const result = applyWorkflowMutation(withSafety, {
    projectId,
    expectedRevision: project.draftVersion || 1,
    mutationId: nanoid(),
    source: 'ui',
    intent: `恢复到 rev ${plan.revision}`,
    ops,
  });
  if (result.ok === false) return { ok: false };
  useWorkflowStore.getState().updateProject(projectId, {
    snapshots: withSafety.snapshots,
    nodes: result.project.nodes,
    connections: result.project.connections,
    selectedNodeIds: result.project.selectedNodeIds,
    draftVersion: result.project.draftVersion,
    draftChangeSets: result.project.draftChangeSets,
    draftRedoStack: result.project.draftRedoStack,
    workflowMutationReceipts: result.project.workflowMutationReceipts,
  });
  return { ok: true, revision: plan.revision };
}
