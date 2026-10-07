import type { WorkflowConnection, WorkflowNode, WorkflowOperationTake, WorkflowProject } from './types';

/**
 * 节点运行状态（派生，不落盘）。
 *
 * - `stale`：已有结果，但它不再对应当前配方或上游结果——需要重跑才能反映最新输入。
 * - stale 只针对 Workflow Operation 及其输出节点判定；没有配方的普通节点不会被猜成 stale。
 * - 判定规则见 docs/design/10-canvas-workflow.md §8.2。
 */
export type WorkflowNodeRunState = 'idle' | 'running' | 'done' | 'stale' | 'error';

export type WorkflowStaleReason = 'recipe-edited' | 'upstream-stale' | 'upstream-newer';

export interface WorkflowNodeRunInfo {
  state: WorkflowNodeRunState;
  /** 只在 state === 'stale' 时出现。 */
  reason?: WorkflowStaleReason;
}

type GraphInput = Pick<WorkflowProject, 'nodes' | 'connections'>;

function selectedSuccessfulTake(node: WorkflowNode): WorkflowOperationTake | undefined {
  const operation = node.metadata.operation;
  if (!operation) return undefined;
  const selected = operation.selectedTakeId ? operation.takes.find(take => take.id === operation.selectedTakeId) : undefined;
  if (selected?.status === 'success') return selected;
  return [...operation.takes].reverse().find(take => take.status === 'success');
}

function timeOf(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function baseState(node: WorkflowNode): WorkflowNodeRunState {
  const status = node.metadata.status || 'idle';
  if (status === 'loading') return 'running';
  if (status === 'error') return 'error';
  if (status === 'success') return 'done';
  return node.metadata.operation && selectedSuccessfulTake(node) ? 'done' : 'idle';
}

/** 节点“结果所属”的 Operation：Operation 自身，或输出节点通过 sourceOperationNodeId 指回的 Operation。 */
function owningOperation(node: WorkflowNode, byId: Map<string, WorkflowNode>): WorkflowNode | undefined {
  if (node.metadata.operation) return node;
  const sourceId = node.metadata.sourceOperationNodeId;
  const source = sourceId ? byId.get(sourceId) : undefined;
  return source?.metadata.operation ? source : undefined;
}

/**
 * 计算整张图的派生运行状态。纯函数：同样的 nodes / connections 永远得到同样结果。
 *
 * 规则：
 * 1. Operation 的配方在最近一次成功运行后被编辑（recipeHash 被置空或与选中 Take 不同）→ `recipe-edited`。
 * 2. 任一上游（沿连线）是 stale → `upstream-stale`。
 * 3. 任一上游 Operation 的选中结果完成时间晚于本节点选中 Take 的开始时间 → `upstream-newer`。
 * 4. 输出节点继承其 Operation 的状态。
 * 只有已有结果（done）的节点才可能变成 stale；运行中 / 失败 / 未运行保持原状态。
 */
export function deriveWorkflowRunStates(project: GraphInput): Map<string, WorkflowNodeRunInfo> {
  const byId = new Map(project.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, WorkflowConnection[]>();
  for (const connection of project.connections) {
    if (!byId.has(connection.fromNodeId) || !byId.has(connection.toNodeId)) continue;
    const list = incoming.get(connection.toNodeId) || [];
    list.push(connection);
    incoming.set(connection.toNodeId, list);
  }

  const result = new Map<string, WorkflowNodeRunInfo>();
  const visiting = new Set<string>();

  const resolve = (node: WorkflowNode): WorkflowNodeRunInfo => {
    const cached = result.get(node.id);
    if (cached) return cached;
    if (visiting.has(node.id)) return { state: baseState(node) }; // 环：不传播，避免死循环
    visiting.add(node.id);

    const state = baseState(node);
    let info: WorkflowNodeRunInfo = { state };
    const operationNode = owningOperation(node, byId);

    if (operationNode && operationNode !== node) {
      // 输出节点：跟随 Operation 的 stale 判定（但保留自己的 running / error）。
      const owner = resolve(operationNode);
      if (state === 'done' && owner.state === 'stale') info = { state: 'stale', reason: owner.reason };
    } else if (operationNode && state === 'done') {
      const operation = operationNode.metadata.operation!;
      const take = selectedSuccessfulTake(operationNode);
      if (take && (operation.recipe.recipeHash === null || operation.recipe.recipeHash !== take.recipeHash)) {
        info = { state: 'stale', reason: 'recipe-edited' };
      } else {
        const takeStarted = timeOf(take?.createdAt);
        for (const connection of incoming.get(node.id) || []) {
          const upstream = byId.get(connection.fromNodeId)!;
          const upstreamInfo = resolve(upstream);
          if (upstreamInfo.state === 'stale') { info = { state: 'stale', reason: 'upstream-stale' }; break; }
          const upstreamOperation = owningOperation(upstream, byId);
          const upstreamTake = upstreamOperation ? selectedSuccessfulTake(upstreamOperation) : undefined;
          const upstreamDone = timeOf(upstreamTake?.completedAt);
          if (takeStarted !== undefined && upstreamDone !== undefined && upstreamDone > takeStarted) {
            info = { state: 'stale', reason: 'upstream-newer' };
            break;
          }
        }
      }
    }

    visiting.delete(node.id);
    result.set(node.id, info);
    return info;
  };

  for (const node of project.nodes) resolve(node);
  return result;
}
