// Agent 工具策略：把 Codex 的 sandboxPolicy / askForApproval 语义落到画布工具边界。
// Codex 的沙箱是 OS 级进程隔离（Seatbelt/Landlock/Windows token），浏览器里没有子进程可隔离；
// 这里保留它可迁移的部分：三档访问范围 + 三档审批，按工具声明的风险在调用前判定 allow / ask / deny。
import type { WorkflowDocumentOperation } from '../components/workflow/types';

export type SandboxPolicy = 'read-only' | 'workspace-write' | 'danger-full-access';
/** Codex 还有 on-failure；它依赖一次失败后的重试升级，这里没有等价的安全重试，显式不支持。 */
export type ApprovalPolicy = 'never' | 'on-request' | 'untrusted';
export type ToolRisk = 'read' | 'write' | 'delete' | 'run' | 'network' | 'filesystem-read';

export type ToolPolicyDecision =
  | { decision: 'allow' }
  | { decision: 'ask'; summary: string }
  | { decision: 'deny'; reason: string };

const RISK_LABEL: Record<ToolRisk, string> = {
  read: '读取画布',
  write: '修改画布',
  delete: '删除内容',
  run: '运行生成（可能产生费用）',
  network: '联网搜索',
  'filesystem-read': '读取本地文件',
};

const MUTATING: Record<ToolRisk, boolean> = {
  read: false,
  write: true,
  delete: true,
  run: true,
  network: false,
  'filesystem-read': false,
};

/** 手动模式 = 每次写都问；自动模式 = 可逆写直接执行，付费/删除仍问（与现有模式按钮语义一致）。 */
export function policyForMode(mode: 'manual' | 'auto'): { sandbox: SandboxPolicy; approval: ApprovalPolicy } {
  return mode === 'manual'
    ? { sandbox: 'workspace-write', approval: 'untrusted' }
    : { sandbox: 'workspace-write', approval: 'on-request' };
}

/**
 * 判定一次工具调用：
 * - sandbox 决定范围：read-only 只允许读；workspace-write / danger-full-access 允许写。
 * - approval 决定要不要问：never 不问；on-request 只问 delete/run；untrusted 连 write 也问。
 * deny 优先于 ask，ask 优先于 allow。
 */
export function decideToolCall(input: {
  sandbox: SandboxPolicy;
  approval: ApprovalPolicy;
  risk: ToolRisk;
  summary?: string;
}): ToolPolicyDecision {
  const { sandbox, approval, risk } = input;
  if (MUTATING[risk]) {
    if (sandbox === 'read-only') {
      return { decision: 'deny', reason: `当前是只读沙箱，不能${RISK_LABEL[risk]}。切换到「自动」或让用户确认后再试。` };
    }
    // 删除与付费执行永远要用户点头，danger-full-access 也不放开这一条。
    if (risk === 'delete' || risk === 'run') {
      return approval === 'never' && sandbox === 'danger-full-access'
        ? { decision: 'allow' }
        : { decision: 'ask', summary: input.summary || `Agent 想${RISK_LABEL[risk]}，是否允许？` };
    }
    if (approval === 'untrusted') return { decision: 'ask', summary: input.summary || `Agent 想${RISK_LABEL[risk]}，是否允许？` };
    return { decision: 'allow' };
  }
  // 只读范围：Codex 的 readOnly 同时关闭网络；本地文件夹读取属于用户已授权的只读能力。
  if (risk === 'network' && sandbox === 'read-only') {
    return { decision: 'deny', reason: '当前是只读沙箱，联网搜索被关闭。' };
  }
  return { decision: 'allow' };
}

const APPLY_DELETE_TYPES = 'delete_nodes';

/** 命令 → 风险。未知命令按可写处理，宁可多问一次。 */
export function toolRiskFor(command: string, args: Record<string, unknown> = {}): ToolRisk {
  if (command === 'flovart_web_search') return 'network';
  if (command === 'flovart_grep') return 'filesystem-read';
  if (command === 'workflow.inspect' || command === 'workflow.selection.get' || command === 'status'
    || command === 'workflow.project.list' || command === 'workflow.projection.get') return 'read';
  if (command === 'flovart_workflow_media_view') return 'read';
  if (command === 'workflow.node.run') return 'run';
  // 停止/选中/视口不是文档变更，也不该在手动模式里被拦。
  if (command === 'workflow.node.stop' || command === 'workflow.select' || command === 'workflow.viewport.set') return 'read';
  if (command === 'workflow.node.delete' || command === 'workflow.project.delete') return 'delete';
  if (command === 'workflow.apply') {
    const raw = args.operations || args.ops;
    if (Array.isArray(raw) && raw.some(item => (
      Boolean(item) && typeof item === 'object'
      && ((item as WorkflowDocumentOperation).type === APPLY_DELETE_TYPES || (item as WorkflowDocumentOperation).type === 'delete_connections')
    ))) return 'delete';
    return 'write';
  }
  if (command.startsWith('workflow.node.') || command.startsWith('workflow.connect')
    || command.startsWith('workflow.disconnect') || command === 'workflow.project.create') return 'write';
  return 'write';
}
