import { nanoid } from 'nanoid';
import { dispatchWorkflowCommand } from '../workflowDispatcher';
import { createWorkflowNode } from '../../components/workflow/constants';
import { useWorkflowStore } from '../../components/workflow/store';
import type { WorkflowConnection, WorkflowDocumentOperation, WorkflowNode, WorkflowProject } from '../../components/workflow/types';
import { REVERSE_SUBGRAPH_TYPE, reverseToSubgraph, syncSubgraph } from './canvas';
import type { ReverseVideoProject } from './types';

export interface ReverseBridgeResult {
  ok: boolean;
  nodeIds: string[];
  message: string;
}

export interface ReverseSubgraphResult extends ReverseBridgeResult {
  /** 子画布框节点 id；失败时为 null。 */
  frameId: string | null;
  /** create = 新建子画布；sync = 增量同步；noop = 已是最新。 */
  mode: 'create' | 'sync' | 'noop';
}

const ROW_GAP = 220;

function findProject(projectId: string): WorkflowProject | undefined {
  return useWorkflowStore.getState().projects.find((p) => p.id === projectId);
}

function nextColumnX(project: WorkflowProject): number {
  return project.nodes.length ? Math.max(...project.nodes.map((n) => n.position.x + n.width)) + 80 : 0;
}

// 所有写入都走同一 workflow.apply 边界（projectId / expectedRevision / mutationId），不直接改 store。
async function applyOperations(project: WorkflowProject, operations: WorkflowDocumentOperation[], intent: string): Promise<{ ok: boolean; message: string }> {
  const mutationId = 'reverse-' + nanoid(8);
  const result = await dispatchWorkflowCommand({
    id: 'reverse:' + nanoid(),
    command: 'workflow.apply',
    source: 'ui',
    idempotencyKey: mutationId,
    args: {
      projectId: project.id,
      expectedRevision: project.draftVersion || 1,
      mutationId,
      idempotencyKey: mutationId,
      operations,
      intent,
    },
  });
  if (!result.ok) return { ok: false, message: result.error?.message || 'workflow.apply failed' };
  return { ok: true, message: intent };
}

/** 按 metadata.reverseProjectId 查找该逆向工程已生成的子画布框。 */
export function findReverseSubgraphFrame(project: WorkflowProject | undefined, reverseProjectId: string): WorkflowNode | undefined {
  return project?.nodes.find((n) => n.type === REVERSE_SUBGRAPH_TYPE && n.metadata.reverseProjectId === reverseProjectId);
}

// 只补尚不存在的连线（按端点去重），且两端都必须在本次变更后仍存在。
function connectionOps(connections: WorkflowConnection[], existing: WorkflowConnection[], liveIds: Set<string>): WorkflowDocumentOperation[] {
  return connections
    .filter((c) => liveIds.has(c.fromNodeId) && liveIds.has(c.toNodeId))
    .filter((c) => !existing.some((e) => e.fromNodeId === c.fromNodeId && e.toNodeId === c.toNodeId))
    .map((c) => ({ type: 'connect_nodes' as const, id: c.id, fromNodeId: c.fromNodeId, toNodeId: c.toNodeId, kind: c.kind, role: c.role, order: c.order }));
}

// 逆向工程 → Canvas 子画布：已有框则按 reverseKey 增量同步（不覆盖用户已选版本），否则在最右列新建；一次 apply 打包。
export async function sendReverseAsSubgraph(projectId: string, reverseProject: ReverseVideoProject): Promise<ReverseSubgraphResult> {
  const project = findProject(projectId);
  if (!project) return { ok: false, nodeIds: [], message: 'no-workflow-project', frameId: null, mode: 'noop' };
  const frame = findReverseSubgraphFrame(project, reverseProject.id);

  if (!frame) {
    const plan = reverseToSubgraph(reverseProject, { x: nextColumnX(project), y: 80 }, () => 'reverse-' + nanoid(10));
    const nodes = [plan.frame, ...plan.children];
    const liveIds = new Set([...project.nodes.map((n) => n.id), ...nodes.map((n) => n.id)]);
    const operations: WorkflowDocumentOperation[] = [
      ...nodes.map((node) => ({ type: 'add_node' as const, node })),
      ...connectionOps(plan.connections, project.connections, liveIds),
    ];
    const res = await applyOperations(project, operations, 'Reverse → Canvas: ' + reverseProject.title);
    return { ...res, nodeIds: res.ok ? nodes.map((n) => n.id) : [], frameId: res.ok ? plan.frame.id : null, mode: 'create' };
  }

  const children = project.nodes.filter((n) => n.parentId === frame.id);
  const plan = syncSubgraph(reverseProject, { frame, children });
  const removed = new Set(plan.remove);
  const liveIds = new Set([...project.nodes.filter((n) => !removed.has(n.id)).map((n) => n.id), ...plan.add.map((n) => n.id)]);
  const surviving = project.connections.filter((c) => !removed.has(c.fromNodeId) && !removed.has(c.toNodeId));
  const operations: WorkflowDocumentOperation[] = [
    ...(plan.remove.length ? [{ type: 'delete_nodes' as const, ids: plan.remove }] : []),
    ...plan.update.map((node) => ({
      type: 'update_node' as const,
      id: node.id,
      patch: { title: node.title, position: node.position, width: node.width, height: node.height, parentId: node.parentId },
      metadata: node.metadata,
    })),
    ...plan.add.map((node) => ({ type: 'add_node' as const, node })),
    ...connectionOps(plan.connections, surviving, liveIds),
  ];
  if (!operations.length) return { ok: true, nodeIds: [], message: 'up-to-date', frameId: frame.id, mode: 'noop' };
  const res = await applyOperations(project, operations, 'Reverse → Canvas sync: ' + reverseProject.title);
  return { ...res, nodeIds: res.ok ? [frame.id, ...plan.add.map((n) => n.id)] : [], frameId: frame.id, mode: 'sync' };
}
