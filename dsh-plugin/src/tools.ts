/**
 * Model-tool derivation from the canonical Iris CLI registry.
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
 * (Operation Skill + Iris CLI) instead of failing the whole profile boot.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AgentToolSpec, CommandMeta, IrisService } from './service.ts'
import { runCli } from './cli.ts'
import { decideIrisToolCall } from './policy.ts'
// Type-only: erased at build; runtime access is dynamic (see ensureToolsApi).
import type { defineTool as DefineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterPropertySpec, ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/**
 * Fallback surface for older CLIs whose `command.list` has no `agentTools`.
 * Current CLIs report the unified Agent tool specs, and DSH registers those
 * (same names and schemas as the built-in Agent, the local Agent and MCP).
 */
export const STABLE_TOOL_COMMANDS = [
  'status',
  'agent.turn',
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
      `[iris] 未找到兼容的 @deepseek-ai/dsh-tools（${error instanceof Error ? error.message : String(error)}）。`
      + '模型工具注册跳过，Host 退回 Operation Skill + Iris CLI 路径；请按兼容集安装 DeepSeek Harness 0.1.0-rc.8。',
    )
    return undefined
  }
}

function toolNameOf(command: string): string {
  return ({
    status: 'iris_status',
    'workflow.inspect': 'iris_inspect',
    'workflow.selection.get': 'iris_selection',
    'workflow.apply': 'iris_apply',
    'workflow.node.run': 'iris_run',
  } as Record<string, string>)[command] ?? `iris_${command.replaceAll('.', '_')}`
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

/** 统一 Agent 工具定义的 JSON Schema 属性 → DSH 参数描述（枚举写进说明，复杂结构按 JSON 传）。 */
export function specParameter(schema: Record<string, unknown>, required: boolean): ParameterPropertySpec {
  const type = schema.type
  const base = typeof schema.description === 'string' ? schema.description : ''
  const enumText = Array.isArray(schema.enum) ? `可选值：${schema.enum.join(' / ')}` : ''
  const description = [base, enumText].filter(Boolean).join('；')
  let spec: ParameterPropertySpec
  if (type === 'number' || type === 'integer' || type === 'boolean' || type === 'string') {
    spec = { type, description }
  } else if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined
    spec = { type: 'array', items: { type: items?.type === 'string' ? 'string' : 'json' }, description }
  } else if (type === 'object') {
    spec = { type: 'object', additionalProperties: true, description }
  } else {
    spec = { type: 'string', description }
  }
  if (required) spec.required = true
  return spec
}

/** Register one tool from the unified Agent tool spec (same name and schema as every other host). */
function registerSpecTool(
  ctx: Context,
  service: IrisService,
  defineTool: DefineToolFn,
  spec: AgentToolSpec,
): () => void {
  const parameters: ParameterSchemaSpec = {}
  for (const [argName, schema] of Object.entries(spec.inputSchema.properties)) {
    parameters[argName] = specParameter(schema, spec.inputSchema.required.includes(argName))
  }
  if (spec.write) parameters.idempotencyKey = { type: 'string', required: true, description: '重试时保持不变的幂等键' }
  return ctx.tools.register(defineTool({
    name: spec.name,
    description: spec.description + '（执行真实 `iris ' + spec.command + ' --json`；删除与付费运行由 Iris 确认）',
    parameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => {
      const outcome = await runCli(service.config, spec.command, normalizedArgs(args as Record<string, unknown>), exec.signal)
      if (!outcome.ok) {
        throw new Error(`${spec.command} 失败：${outcome.error?.code} ${outcome.error?.message ?? ''}`)
      }
      return outcome.data as JsonValue
    },
    isConcurrencySafe: () => !spec.write,
  }))
}

/** Register one derived tool for a canonical CLI command. */
function registerDerivedTool(
  ctx: Context,
  service: IrisService,
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
      `Iris CLI 命令 ${command} 的模型工具封装：${meta.summary}。`
      + '执行真实 `iris ... --json`，返回结构化 JSON；失败时返回可复制的错误码。'
      + '不绕过 Iris 权限边界，付费与审批命令不在本工具面。',
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
export async function registerIrisTools(ctx: Context, service: IrisService): Promise<() => void> {
  const defineTool = await ensureToolsApi()
  if (service.state.commands === null) service.probe()
  if (defineTool === undefined) return () => {}
  const commands = service.state.commands ?? {}
  const disposers: Array<() => void> = []
  // Iris tools bypass DSH's own sandbox because they write the Browser Workflow
  // through the CLI; gate them here with the same sandbox/approval policy.
  if (typeof ctx.on === 'function') {
    disposers.push(ctx.on('tools/pre-execute', async (exec, next) => {
      const name = String(exec.name || '')
      if (!name.startsWith('iris_') && !name.startsWith('flovart_')) return next()
      const decision = decideIrisToolCall({
        name,
        args: (exec.arguments && typeof exec.arguments === 'object' ? exec.arguments : {}) as Record<string, unknown>,
        policy: { sandbox: service.config.sandbox, approval: service.config.approval },
      })
      return decision.kind === 'allow' ? next() : decision
    }))
  }
  let derived = 0
  const specs = service.state.agentTools?.filter(spec => commands[spec.command]) ?? []
  if (specs.length) {
    // 新 CLI：工具名、说明、参数 Schema 与内置 / 本机 Agent、MCP 同一份（tools/iris/agent-tools.js）。
    for (const spec of specs) {
      disposers.push(registerSpecTool(ctx, service, defineTool, spec))
      derived += 1
    }
    console.log(`[iris] 模型工具已注册：unified ${derived}（CLI ${service.config.cli}）`)
  } else {
    for (const command of STABLE_TOOL_COMMANDS) {
      const meta = commands[command]
      if (meta) {
        disposers.push(registerDerivedTool(ctx, service, defineTool, command, meta))
        derived += 1
      }
    }
    console.log(`[iris] 模型工具已注册：stable ${derived}/${STABLE_TOOL_COMMANDS.length}（CLI ${service.config.cli}）`)
  }
  return () => {
    for (const dispose of disposers.splice(0).reverse()) dispose()
  }
}
