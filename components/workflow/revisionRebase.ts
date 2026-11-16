import type { WorkflowProject } from './types';
import { objectsChangedSince } from './draftAuthority';

/**
 * 按节点的乐观锁：草稿版本是全局计数，界面里挪一下别的节点也会 +1。
 * 只改 / 只跑「指定节点」的命令，在这些节点自 expectedRevision 以来没被动过时可以直接在最新版本上执行（rebase），
 * 不该因为无关改动被拒。其余命令仍按整体版本检查。Node 侧 agent/session.js 有同一份命令清单。
 */
export const NODE_REBASE_COMMANDS: ReadonlySet<string> = new Set(['workflow.node.update', 'workflow.node.run', 'workflow.apply']);

function idList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

/** 命令要写 / 要跑的节点；workflow.apply 只认 update_node（其它操作不能 rebase，返回 null）。 */
export function commandTargetNodeIds(command: string, args: Record<string, unknown>): string[] | null {
  if (!NODE_REBASE_COMMANDS.has(command)) return null;
  if (command === 'workflow.apply') {
    const ops = (Array.isArray(args.operations) ? args.operations : Array.isArray(args.ops) ? args.ops : []) as Array<{ type?: string; id?: unknown }>;
    if (!ops.length || ops.some(op => op?.type !== 'update_node')) return null;
    return ops.map(op => String(op.id || '')).filter(Boolean);
  }
  const ids = [...idList(args.nodeIds), ...idList(args.nodeId ?? args.id)];
  return ids.length ? ids : null;
}

export interface RevisionCheck {
  ok: boolean;
  expectedRevision: number;
  actualRevision: number;
  /** 自 expectedRevision 以来改动过的对象。 */
  changedObjectIds: string[];
  /** 本命令的目标里被改动过的节点（冲突的真正原因）。 */
  conflictingIds: string[];
}

export function checkRevision(project: WorkflowProject, command: string, args: Record<string, unknown>, expectedRevision: number): RevisionCheck {
  const actualRevision = project.draftVersion || 1;
  const base = { expectedRevision, actualRevision, changedObjectIds: [] as string[], conflictingIds: [] as string[] };
  if (expectedRevision === actualRevision) return { ...base, ok: true };
  if (expectedRevision > actualRevision) return { ...base, ok: false };
  const changed = objectsChangedSince(project, expectedRevision);
  const targets = commandTargetNodeIds(command, args);
  const changedObjectIds = [...changed];
  if (!targets) return { ...base, ok: false, changedObjectIds };
  const conflictingIds = targets.filter(id => changed.has(id));
  return { ...base, ok: conflictingIds.length === 0, changedObjectIds, conflictingIds };
}

export function revisionConflictMessage(check: RevisionCheck): string {
  return `Workflow 草稿版本已变化：期望 ${check.expectedRevision}，当前 ${check.actualRevision}。`
    + (check.conflictingIds.length ? `要改的节点 ${check.conflictingIds.join('、')} 期间已被改动，请重新读取后再写。` : '请重新读取（workflow.inspect）后用最新版本重试。');
}
