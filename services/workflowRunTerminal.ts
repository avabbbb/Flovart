/**
 * Agent 工具 v2 · P0-3：运行终态统一映射（纯函数）。
 *
 * 所有运行入口（workflow.node.run 单跑/批量、workflow.generate run=true）对外只有四种终态：
 * - succeeded：有产物
 * - failed：明确失败（含被停止/被新运行取代），可以改参数后重跑
 * - timeout：等待回执超时；运行可能仍在进行，先 inspect，不要盲目重跑
 * - unknown_after_submit：已提交到上游、结果未知（可能已计费），禁止自动重试或换线路
 *
 * run 会阻塞到终态，调用方不要自己轮询 inspect。
 */
import type { WorkflowRunOutputs, WorkflowRunResult } from './workflowExecutor';

export type WorkflowRunTerminalStatus = 'succeeded' | 'failed' | 'timeout' | 'unknown_after_submit';

export interface WorkflowRunFailedReason {
  code: string;
  message: string;
}

export interface WorkflowRunTerminal {
  status: WorkflowRunTerminalStatus;
  runId?: string;
  outputs?: WorkflowRunOutputs;
  failedReason?: WorkflowRunFailedReason;
  /** 能否原样重跑：只有 failed 可以；timeout 先 inspect，unknown_after_submit 永不自动重试。 */
  retryable: boolean;
  /** 给 Agent 的下一步提示。 */
  next?: string;
}

const UNKNOWN_CODES = new Set(['SEEDANCE_SUBMISSION_UNKNOWN', 'SUBMISSION_UNKNOWN', 'UNKNOWN_AFTER_SUBMIT']);
const TIMEOUT_CODES = new Set(['WORKSPACE_TIMEOUT', 'COMMAND_TIMEOUT', 'CLI_TIMEOUT', 'RUN_TIMEOUT', 'TIMEOUT']);

/** 错误码 → 终态。未知码一律按 failed。 */
export function terminalStatusForCode(code: string | undefined): WorkflowRunTerminalStatus {
  if (!code) return 'failed';
  if (UNKNOWN_CODES.has(code)) return 'unknown_after_submit';
  if (TIMEOUT_CODES.has(code) || /TIMEOUT$/.test(code)) return 'timeout';
  return 'failed';
}

const NEXT: Record<WorkflowRunTerminalStatus, string | undefined> = {
  succeeded: undefined,
  failed: '按 failedReason 修正后可以重跑同一节点。',
  timeout: '运行可能仍在进行：先 iris_workflow_inspect 看节点状态，确认没有结果再用同一个 idempotencyKey 重试。',
  unknown_after_submit: '上游可能已经创建并计费：不要重试、不要换线路，如实告诉用户并等待结果回填。',
};

/** 失败（错误码 + 文案）→ 统一终态。 */
export function terminalFromFailure(code: string | undefined, message: string, runId?: string): WorkflowRunTerminal {
  const status = terminalStatusForCode(code);
  return {
    status,
    ...(runId ? { runId } : {}),
    failedReason: { code: code || 'RUN_FAILED', message },
    retryable: status === 'failed',
    ...(NEXT[status] ? { next: NEXT[status] } : {}),
  };
}

/** 执行器结果 → 统一终态。 */
export function terminalFromRunResult(run: Pick<WorkflowRunResult, 'runId' | 'status' | 'error' | 'outputs'>): WorkflowRunTerminal {
  if (run.status === 'completed') {
    return { status: 'succeeded', ...(run.runId ? { runId: run.runId } : {}), ...(run.outputs ? { outputs: run.outputs } : {}), retryable: false };
  }
  if (run.status === 'cancelled') return terminalFromFailure('RUN_CANCELLED', '生成已停止或被新的运行取代，未产生结果。', run.runId);
  return terminalFromFailure(run.error?.code || 'RUN_FAILED', run.error?.message || 'Workflow 生成失败，请重试。', run.runId);
}
