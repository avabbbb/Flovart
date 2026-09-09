/**
 * Flovart CLI facade execution. Every model tool and every service probe
 * reaches Flovart through this single public boundary — the host never
 * touches loopback private routes, WebUI state, Discovery Tokens or MCP.
 */

import { spawn, spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process'
import type { FlovartPluginConfig } from './config.ts'

export interface CliFailure {
  code: string
  message: string
  retryable: boolean
}

export interface CliOutcome {
  ok: boolean
  command: string
  data: unknown
  error: CliFailure | null
}

/** Split a launcher string into argv, honoring double quotes; never empty. */
export function cliArgv(cli: string): [string, ...string[]] {
  const tokens: string[] = []
  const pattern = /"([^"]*)"|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(cli)) !== null) {
    tokens.push(match[1] ?? match[2]!)
  }
  return tokens.length > 0 ? (tokens as [string, ...string[]]) : ['flovart']
}

export function buildCliCommand(cli: string, command: string, args: Record<string, unknown>): [string, ...string[]] {
  const base = cliArgv(cli)
  const flags: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value)
    flags.push(`--${key}=${serialized}`)
  }
  return [base[0], ...base.slice(1), command, ...flags, '--json']
}

export function parseCliOutcome(command: string, stdout: string, stderr: string): CliOutcome {
  try {
    const parsed = JSON.parse(stdout) as { ok?: boolean; data?: unknown; error?: CliFailure | null } | null
    if (parsed && typeof parsed === 'object' && parsed.ok !== false) {
      return { ok: true, command, data: parsed.data ?? null, error: null }
    }
    const failure: CliFailure = parsed?.error ?? {
      code: 'CLI_ERROR',
      message: (stderr.trim() || JSON.stringify(parsed)).slice(0, 2000),
      retryable: false,
    }
    return { ok: false, command, data: null, error: failure }
  } catch {
    return {
      ok: false,
      command,
      data: null,
      error: { code: 'CLI_INVALID_JSON', message: (stdout || stderr).slice(0, 2000), retryable: false },
    }
  }
}

function errnoCode(error: Error): string | undefined {
  return 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string'
    ? (error as NodeJS.ErrnoException).code
    : undefined
}

export function runCliSync(
  config: FlovartPluginConfig,
  command: string,
  args: Record<string, unknown> = {},
  timeoutMs = 10000,
): CliOutcome {
  const argv = buildCliCommand(config.cli, command, args)
  const options: SpawnSyncOptionsWithStringEncoding = { windowsHide: true, encoding: 'utf8', timeout: timeoutMs }
  let result
  try {
    result = spawnSync(argv[0], argv.slice(1), options)
  } catch {
    return {
      ok: false,
      command,
      data: null,
      error: {
        code: 'CLI_SPAWN_FAILED',
        message: `无法启动 Flovart CLI：${argv[0]}。请安装 Agent Toolkit 或设置 FLOVART_CLI。`,
        retryable: false,
      },
    }
  }
  if (result.error) {
    const code = errnoCode(result.error)
    if (code === 'ETIMEDOUT') {
      return {
        ok: false,
        command,
        data: null,
        error: { code: 'CLI_TIMEOUT', message: `命令 ${command} 执行超时`, retryable: true },
      }
    }
    return {
      ok: false,
      command,
      data: null,
      error: {
        code: code === 'ENOENT' ? 'CLI_NOT_FOUND' : 'CLI_SPAWN_FAILED',
        message: `无法启动 Flovart CLI：${argv[0]}（${result.error.message}）。请安装 Agent Toolkit 或设置 FLOVART_CLI。`,
        retryable: false,
      },
    }
  }
  if (result.status !== 0 && (result.stdout ?? '') === '') {
    return {
      ok: false,
      command,
      data: null,
      error: { code: 'CLI_ERROR', message: (result.stderr ?? '').slice(0, 2000), retryable: false },
    }
  }
  return parseCliOutcome(command, result.stdout ?? '', result.stderr ?? '')
}

export async function runCli(
  config: FlovartPluginConfig,
  command: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<CliOutcome> {
  const commandArgs = command.startsWith('workflow.')
    ? { ...args, workspaceMode: 'browser', agentIdentity: args.agentIdentity || 'deepseek-harness' }
    : args
  const argv = buildCliCommand(config.cli, command, commandArgs)
  return new Promise<CliOutcome>(resolve => {
    const child = spawn(argv[0], argv.slice(1), { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdin?.end()
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const finish = (outcome: CliOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({
        ok: false, command, data: null,
        error: { code: 'CLI_TIMEOUT', message: `命令 ${command} 执行超过 ${config.toolTimeoutMs}ms 已终止`, retryable: true },
      })
    }, config.toolTimeoutMs)
    const onAbort = () => { child.kill('SIGTERM') }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', error => {
      const code = errnoCode(error)
      finish({
        ok: false, command, data: null,
        error: {
          code: code === 'ENOENT' ? 'CLI_NOT_FOUND' : 'CLI_SPAWN_FAILED',
          message: `无法启动 Flovart CLI：${argv[0]}（${error.message}）。请安装 Agent Toolkit 或设置 FLOVART_CLI。`,
          retryable: false,
        },
      })
    })
    child.on('close', () => {
      if (settled) return
      finish(parseCliOutcome(command, stdout, stderr))
    })
  })
}
