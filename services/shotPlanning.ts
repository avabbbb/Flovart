import type { WorkflowNode } from '../components/workflow/types';

type ShotCarrier = Pick<WorkflowNode, 'id' | 'shot'>;

function shotIndex(node: ShotCarrier): number | undefined {
  const value = node.shot?.index;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * 按 shot.index 稳定排序：有镜号的在前、按镜号升序；镜号相同或无镜号时保持原顺序。
 * 不修改入参。
 */
export function orderNodesByShot<T extends ShotCarrier>(nodes: readonly T[]): T[] {
  return nodes
    .map((node, position) => ({ node, position, index: shotIndex(node) }))
    .sort((a, b) => {
      if (a.index !== undefined && b.index !== undefined) return a.index - b.index || a.position - b.position;
      if (a.index !== undefined) return -1;
      if (b.index !== undefined) return 1;
      return a.position - b.position;
    })
    .map(entry => entry.node);
}

export interface ShotListIssue {
  nodeId: string;
  code: 'invalid-index' | 'duplicate-index' | 'invalid-duration';
  message: string;
}

/** 镜头表校验：镜号须为正整数且不重复，时长须为正数。只报告，不自动修正。 */
export function validateShotList(nodes: readonly ShotCarrier[]): ShotListIssue[] {
  const issues: ShotListIssue[] = [];
  const seen = new Map<number, string>();
  for (const node of nodes) {
    if (!node.shot) continue;
    const { index, durationSec } = node.shot;
    if (!Number.isInteger(index) || index < 1) {
      issues.push({ nodeId: node.id, code: 'invalid-index', message: `镜号必须是正整数：${String(index)}` });
    } else if (seen.has(index)) {
      issues.push({ nodeId: node.id, code: 'duplicate-index', message: `镜号 ${index} 与节点 ${seen.get(index)} 重复` });
    } else {
      seen.set(index, node.id);
    }
    if (durationSec !== undefined && !(Number.isFinite(durationSec) && durationSec > 0)) {
      issues.push({ nodeId: node.id, code: 'invalid-duration', message: `镜头时长必须为正数：${String(durationSec)}` });
    }
  }
  return issues;
}

/** 镜头表总时长（仅累加已声明时长的镜头）。 */
export function totalShotDuration(nodes: readonly ShotCarrier[]): number {
  return nodes.reduce((sum, node) => {
    const value = node.shot?.durationSec;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
}
