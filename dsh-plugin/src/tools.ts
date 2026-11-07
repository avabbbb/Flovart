/**
 * Model-tool derivation from the canonical Flovart CLI registry.
 *
 * The model tool face exposes inspection plus bounded graph mutations. Paid
 * generation, Production approval/run, media tools, and Crew submission stay
 * behind their existing explicit Runtime gates. `command.list` is a machine
 * registry probe for this projection; `command.schema` is a diagnostic surface,
 * not a model tool. A command listed here but absent from the live registry is
 * simply not registered (no guessed schema).
 *
 * The dsh-tools API is loaded dynamically: an incompatible Harness install
 * without a compatible `@deepseek-ai/dsh-tools` must degrade to CLI-only
 * (Operation Skill + Flovart CLI) instead of failing the whole profile boot.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandMeta, FlovartService } from './service.ts'
import { runCli } from './cli.ts'
// Type-only: erased at build; runtime access is dynamic (see ensureToolsApi).
import type { defineTool as DefineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ParameterPropertySpec, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'

/**
 * The DSH projection exposes the same five model-facing commands as every
 * other Coding Agent. Granular Workflow commands remain CLI compatibility
 * adapters and are intentionally not derived into a second public surface.
 */
export const STABLE_TOOL_COMMANDS = [
  'status',
  'workflow.inspect',
  'workflow.selection.get',
  'workflow.apply',
  'workflow.node.run',
] as const

const STABLE_WRITE_COMMANDS = new Set<ToolCommand>(['workflow.apply', 'workflow.node.run'])

export type ToolCommand = (typeof STABLE_TOOL_COMMANDS)[number]

type DefineToolFn = typeof DefineTool

let toolsApi: DefineToolFn | undefined
let toolsApiFailed = false
const DSH_TOOLS_PACKAGE = '@deepseek-ai/dsh-tools'

/** Load the dsh-tools API once; failures degrade to CLI-only instead of throwing. */
async function ensureToolsApi(): Promise<DefineToolFn | undefined> {
  if (toolsApi !== undefined) return toolsApi
  if (toolsApiFailed) return undefined
  try {
    toolsApi = (await import(/* @vite-ignore */ DSH_TOOLS_PACKAGE)).defineTool
    return toolsApi
  } catch (error) {
    toolsApiFailed = true
    console.warn(
      `[flovart] 未找到兼容的 @deepseek-ai/dsh-tools（${error instanceof Error ? error.message : String(error)}）。`
      + '模型工具注册跳过，Host 退回 Operation Skill + Flovart CLI 路径；请按兼容集安装 DeepSeek Harness 0.1.0-rc.8。',
    )
    return undefined
  }
}

function toolNameOf(command: string): string {
  return ({
    status: 'flovart_status',
    'workflow.inspect': 'flovart_inspect',
    'workflow.selection.get': 'flovart_selection',
    'workflow.apply': 'flovart_apply',
    'workflow.node.run': 'flovart_run',
  } as Record<string, string>)[command] ?? `flovart_${command.replaceAll('.', '_')}`
}

/** Map a registry arg type tag (`string?`/`number`/...) to a tool parameter spec. */
function parameterSpec(argType: string, description: string): ParameterPropertySpec {
  const optional = argType.endsWith('?')
  const rawType = optional ? argType.slice(0, -1) : argType
  let spec: ParameterPropertySpec
  if (rawType === 'number' || rawType === 'integer' || rawType === 'boolean') {
    spec = { type: rawType, description }
  } else if (rawType === 'array') {
    spec = { type: 'array', items: { type: 'json' }, description }
  } else if (rawType === 'string[]') {
    spec = { type: 'array', items: { type: 'string' }, description }
  } else if (rawType === 'object') {
    spec = { type: 'object', additionalProperties: true, description }
  } else {
    spec = { type: 'string', description }
  }
  if (!optional) spec.required = true
  return spec
}

function normalizedArgs(args: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue
    output[key] = value
  }
  return output
}

/** Register one derived tool for a canonical CLI command. */
function registerDerivedTool(
  ctx: Context,
  service: FlovartService,
  defineTool: DefineToolFn,
  command: ToolCommand,
  meta: CommandMeta,
): () => void {
  const write = STABLE_WRITE_COMMANDS.has(command)
  const parameters: ParameterSchemaSpec = {}
  for (const [argName, argType] of Object.entries(meta.args)) {
    parameters[argName] = parameterSpec(argType, `${command} 的 ${argName} 参数（来自 command.schema）`)
  }
  if (write) parameters.idempotencyKey = { type: 'string', required: true, description: '重试时保持不变的幂等键' }
  return ctx.tools.register(defineTool({
    name: toolNameOf(command),
    description:
      `Flovart CLI 命令 ${command} 的模型工具封装：${meta.summary}。`
      + '执行真实 `flovart ... --json`，返回结构化 JSON；失败时返回可复制的错误码。'
      + '不绕过 Flovart 权限边界，付费与审批命令不在本工具面。',
    parameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const outcome = await runCli(service.config, command, normalizedArgs(args as Record<string, unknown>), exec.signal)
      if (!outcome.ok) {
        throw new Error(`${command} 失败：${outcome.error?.code} ${outcome.error?.message ?? ''}`)
      }
      return outcome.data as JsonValue
    },
    isConcurrencySafe: () => !write,
  }))
}

/**
 * Async derivation driven from the sync apply: probe the registry once
 * (local CLI), then register every allowlisted command the live registry
 * actually carries. `command.list` / `command.schema` remain host diagnostics
 * and are not model tools. Skipping registration on dsh-tools absence is the
 * documented degradation path — the profile must keep booting.
 */
export async function registerFlovartTools(ctx: Context, service: FlovartService): Promise<() => void> {
  const defineTool = await ensureToolsApi()
  if (service.state.commands === null) service.probe()
  if (defineTool === undefined) return () => {}
  const commands = service.state.commands ?? {}
  const disposers: Array<() => void> = []
  let derived = 0
  for (const command of STABLE_TOOL_COMMANDS) {
    const meta = commands[command]
    if (meta) {
      disposers.push(registerDerivedTool(ctx, service, defineTool, command, meta))
      derived += 1
    }
  }
  console.log(`[flovart] 模型工具已注册：stable ${derived}/5（CLI ${service.config.cli}）`)
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}
