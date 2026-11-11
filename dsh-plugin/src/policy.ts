/**
 * Flovart-side tool policy for the DSH projection.
 *
 * DSH owns OS-level sandboxing for its own tools; these Flovart tools write the
 * user's visible Workflow through the CLI, so the plugin applies the same
 * Codex-shaped policy before dispatch: sandbox decides what may run, approval
 * decides what must be asked. `ask` is resolved by the Harness approval seam
 * and degrades to a denial when no ApprovalService is composed.
 */

export type FlovartSandbox = 'read-only' | 'workspace-write'
export type FlovartApproval = 'never' | 'on-request' | 'untrusted'

export type FlovartToolRisk = 'read' | 'write' | 'delete' | 'run'

export type FlovartToolDecision =
  | { kind: 'allow' }
  | { kind: 'ask'; reason: string; displayReason: { en: string; zho: string } }
  | { kind: 'deny'; reason: string }

export interface FlovartToolPolicy {
  sandbox: FlovartSandbox
  approval: FlovartApproval
}

const WRITE_TOOLS = new Set(['flovart_apply'])
const RUN_TOOLS = new Set(['flovart_run'])

/** Classify a Flovart tool call; unknown Flovart tools are treated as writes. */
export function flovartToolRisk(name: string, args: Record<string, unknown>): FlovartToolRisk | null {
  if (RUN_TOOLS.has(name)) return 'run'
  if (WRITE_TOOLS.has(name)) {
    const raw = args.operations ?? args.ops
    if (Array.isArray(raw) && raw.some(item => {
      const type = (item as { type?: unknown } | null)?.type
      return type === 'delete_nodes' || type === 'delete_connections'
    })) return 'delete'
    return 'write'
  }
  if (name === 'flovart_agent_turn') {
    // 委派回合默认只读；显式 workspace-write 才是可写委派，按 write 走审批。
    return args.policy === 'workspace-write' ? 'write' : 'read'
  }
  if (name === 'flovart_inspect' || name === 'flovart_selection' || name === 'flovart_status') return 'read'
  return name.startsWith('flovart_') ? 'write' : null
}

const REASON: Record<FlovartToolRisk, { en: string; zho: string }> = {
  read: { en: 'Read the Workflow', zho: '读取画布' },
  write: { en: 'Modify the Workflow', zho: '修改画布' },
  delete: { en: 'Delete Workflow content', zho: '删除画布内容' },
  run: { en: 'Run generation (may cost money)', zho: '运行生成（可能产生费用）' },
}

/** Decide allow / ask / deny. Deny beats ask beats allow. */
export function decideFlovartToolCall(input: {
  name: string
  args: Record<string, unknown>
  policy: FlovartToolPolicy
}): FlovartToolDecision {
  const risk = flovartToolRisk(input.name, input.args)
  if (!risk) return { kind: 'allow' }
  if (risk === 'read') return { kind: 'allow' }
  // config may be partial in tests or older profile rows: fall back to the safe defaults.
  const sandbox: FlovartSandbox = input.policy.sandbox === 'read-only' ? 'read-only' : 'workspace-write'
  const approval: FlovartApproval = input.policy.approval === 'never' || input.policy.approval === 'untrusted'
    ? input.policy.approval
    : 'on-request'
  if (sandbox === 'read-only') {
    return {
      kind: 'deny',
      reason: `Flovart is in a read-only sandbox: ${REASON[risk].en} is blocked. Switch the plugin sandbox to workspace-write to allow it.`,
    }
  }
  if (approval === 'never') return { kind: 'allow' }
  // 删除与付费执行由 Flovart 命令面确认（带费用计划和勾选），这里不再重复弹窗。
  if (risk === 'delete' || risk === 'run') return { kind: 'allow' }
  if (approval === 'on-request') return { kind: 'allow' }
  return {
    kind: 'ask',
    reason: `Flovart tool ${input.name} will ${REASON[risk].en.toLowerCase()}`,
    displayReason: {
      en: `Allow the Flovart tool to ${REASON[risk].en.toLowerCase()}?`,
      zho: `允许 Flovart 工具${REASON[risk].zho}吗？`,
    },
  }
}
