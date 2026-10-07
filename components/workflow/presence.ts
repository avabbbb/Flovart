import type { WorkflowDraftActor, WorkflowProject } from './types';

/**
 * Agent 在场标记（派生，不落盘）。
 *
 * 来源只有一个：项目已提交的 draftChangeSets（每条记录 actor、intent、修订号）。
 * 一个节点最近一次被改动若来自非 UI 的写者（Agent / CLI / 面板 operator），就在画布上标出来；
 * 人随后再改这个节点，标记自然消失。不模拟光标，也不依赖时间流逝。
 */
export interface WorkflowNodePresence {
  actor: Exclude<WorkflowDraftActor, 'ui'>;
  intent: string;
  at: string;
  revision: number;
}

export function deriveWorkflowPresence(project: Pick<WorkflowProject, 'nodes' | 'draftChangeSets'>): Map<string, WorkflowNodePresence> {
  const live = new Set(project.nodes.map(node => node.id));
  const latest = new Map<string, { actor: WorkflowDraftActor; intent: string; at: string; revision: number }>();
  for (const changeSet of project.draftChangeSets || []) {
    if (changeSet.status !== 'completed' && changeSet.status !== 'partial') continue;
    for (const change of changeSet.nodeChanges) {
      if (!change.after) { latest.delete(change.id); continue; }
      const previous = latest.get(change.id);
      if (previous && previous.revision > changeSet.resultDraftVersion) continue;
      latest.set(change.id, { actor: changeSet.actor, intent: changeSet.intent, at: changeSet.at, revision: changeSet.resultDraftVersion });
    }
  }
  const result = new Map<string, WorkflowNodePresence>();
  latest.forEach((entry, nodeId) => {
    if (entry.actor === 'ui' || !live.has(nodeId)) return;
    result.set(nodeId, { actor: entry.actor, intent: entry.intent, at: entry.at, revision: entry.revision });
  });
  return result;
}
