/**
 * Iris-side tool policy for the DSH projection.
 *
 * DSH owns OS-level sandboxing for its own tools; these Iris tools write the
 * user's visible Workflow through the CLI, so the plugin applies the same
 * Codex-shaped policy before dispatch: sandbox decides what may run, approval
 * decides what must be asked. `ask` is resolved by the Harness approval seam
 * and degrades to a denial when no ApprovalService is composed.
 */

export type IrisSandbox = 'read-only' | 'workspace-write'
export type IrisApproval = 'never' | 'on-request' | 'untrusted'

export type IrisToolRisk = 'read' | 'write' | 'delete' | 'run'

export type IrisToolDecision =
  | { kind: 'allow' }
  | { kind: 'ask'; reason: string; displayReason: { en: string; zho: string } }
  | { kind: 'deny'; reason: string }

export interface IrisToolPolicy {
  sandbox: IrisSandbox
  approval: IrisApproval
}

const WRITE_TOOLS = new Set(['iris_apply', 'iris_workflow_apply'])
const RUN_TOOLS = new Set(['iris_run', 'iris_workflow_node_run', 'iris_group_run'])
const READ_TOOLS = new Set([
  'iris_inspect', 'iris_selection', 'iris_status',
  'iris_workflow_inspect', 'iris_workflow_selection_get', 'iris_workflow_focus_nodes',
  'iris_models_list', 'iris_workflow_search_nodes', 'iris_shortcut_list',
  'iris_export', 'iris_task_get',
])

/** iris_task_start 包装的命令 → 对应工具名，风险按被包装的命令判定。 */
const TASK_COMMAND_TOOLS: Record<string, string> = {
  'agent.turn': 'iris_agent_turn',
  'workflow.node.run': 'iris_workflow_node_run',
  'workflow.generate': 'iris_generate',
  'workflow.node.tool': 'iris_workflow_node_tool',
  'workflow.image.tool': 'iris_image_tool',
  'workflow.video.tool': 'iris_video_tool',
  'workflow.audio.tool': 'iris_audio_tool',
  'workflow.media.import': 'iris_media_import',
  'workflow.export': 'iris_export',
}

/** Classify a Iris tool call; unknown Iris tools are treated as writes. */
export function irisToolRisk(name: string, args: Record<string, unknown>): IrisToolRisk | null {
  if (name === 'iris_task_start') {
    const inner = TASK_COMMAND_TOOLS[String(args.command ?? '')]
    const innerArgs = args.args && typeof args.args === 'object' ? args.args as Record<string, unknown> : {}
    return inner ? irisToolRisk(inner, innerArgs) : 'write'
  }
  if (RUN_TOOLS.has(name)) return 'run'
  if (WRITE_TOOLS.has(name)) {
    const raw = args.operations ?? args.ops
    if (Array.isArray(raw) && raw.some(item => {
      const type = (item as { type?: unknown } | null)?.type
      return type === 'delete_nodes' || type === 'delete_connections'
    })) return 'delete'
    return 'write'
  }
  if (name === 'iris_agent_turn') {
    // 委派回合默认只读；显式 workspace-write 才是可写委派，按 write 走审批。
    return args.policy === 'workspace-write' ? 'write' : 'read'
  }
  // generate 只写 Prompt Bar 时是普通写入；run=true 才是付费运行。
  if (name === 'iris_generate' || name === 'iris_shortcut_apply') return args.run === true || args.run === 'true' ? 'run' : 'write'
  if (READ_TOOLS.has(name)) return 'read'
  return name.startsWith('iris_') ? 'write' : null
}

const REASON: Record<IrisToolRisk, { en: string; zho: string }> = {
  read: { en: 'Read the Workflow', zho: '读取画布' },
  write: { en: 'Modify the Workflow', zho: '修改画布' },
  delete: { en: 'Delete Workflow content', zho: '删除画布内容' },
  run: { en: 'Run generation (may cost money)', zho: '运行生成（可能产生费用）' },
}

/** Decide allow / ask / deny. Deny beats ask beats allow. */
export function decideIrisToolCall(input: {
  name: string
  args: Record<string, unknown>
  policy: IrisToolPolicy
}): IrisToolDecision {
  // 更名前的 flovart_* 工具名按对应的 iris_* 判定风险（2026-11-20 Flovart → Iris）。
  const name = input.name.startsWith('flovart_') ? 'iris_' + input.name.slice('flovart_'.length) : input.name
  const risk = irisToolRisk(name, input.args)
  if (!risk) return { kind: 'allow' }
  if (risk === 'read') return { kind: 'allow' }
  // config may be partial in tests or older profile rows: fall back to the safe defaults.
  const sandbox: IrisSandbox = input.policy.sandbox === 'read-only' ? 'read-only' : 'workspace-write'
  const approval: IrisApproval = input.policy.approval === 'never' || input.policy.approval === 'untrusted'
    ? input.policy.approval
    : 'on-request'
  if (sandbox === 'read-only') {
    return {
      kind: 'deny',
      reason: `Iris is in a read-only sandbox: ${REASON[risk].en} is blocked. Switch the plugin sandbox to workspace-write to allow it.`,
    }
  }
  if (approval === 'never') return { kind: 'allow' }
  // 删除与付费执行由 Iris 命令面确认（带费用计划和勾选），这里不再重复弹窗。
  if (risk === 'delete' || risk === 'run') return { kind: 'allow' }
  if (approval === 'on-request') return { kind: 'allow' }
  return {
    kind: 'ask',
    reason: `Iris tool ${input.name} will ${REASON[risk].en.toLowerCase()}`,
    displayReason: {
      en: `Allow the Iris tool to ${REASON[risk].en.toLowerCase()}?`,
      zho: `允许 Iris 工具${REASON[risk].zho}吗？`,
    },
  }
}
