/**
 * Flovart service (Node/Cordis half). Owns the CLI facade and the last known
 * runtime/registry state; is provided on `ctx.flovart` for later profile
 * layers and the doctor script. The browser half never reads this service or
 * its token; the host exposes a narrow same-origin Workspace proxy instead.
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { normalizeConfig, type FlovartPluginConfig } from './config.ts'
import { runCli, runCliSync, type CliOutcome } from './cli.ts'

const DEFAULT_HEALTH_CHECK_MS = 10_000

export interface CommandMeta {
  summary: string
  args: Record<string, string>
  availability: string
}

export interface FlovartServiceState {
  /** Whether the CLI launcher resolved and spoke the registry at last probe. */
  cliReady: boolean
  cliError: string | null
  /** Canonical command registry snapshot (command.list data). */
  commands: Record<string, CommandMeta> | null
  /** Registry content hash, when the CLI reports one. */
  registryHash: string | null
}

export class FlovartServiceError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly details: unknown

  constructor(code: string, message: string, retryable = false, details: unknown = null) {
    super(message)
    this.name = 'FlovartServiceError'
    this.code = code
    this.retryable = retryable
    this.details = details
  }

  toJSON() {
    return { code: this.code, message: this.message, retryable: this.retryable, details: this.details }
  }
}

export type FlovartServiceArgs = Record<string, unknown>

export interface FlovartArtifactView {
  taskId: string
  kind?: string
  mimeType?: string
  storeRelpath?: string
  sha256?: string
  byteSize?: number
  durationSec?: number
  [key: string]: unknown
}

export function artifactFromTask(task: unknown, taskId: string): FlovartArtifactView | null {
  if (!task || typeof task !== 'object') return null
  const result = (task as Record<string, unknown>).result
  if (!result || typeof result !== 'object') return null
  const artifact = (result as Record<string, unknown>).artifact
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null
  return { taskId, ...(artifact as Record<string, unknown>) }
}

export class FlovartService extends Service {
  readonly config: FlovartPluginConfig
  state: FlovartServiceState = { cliReady: false, cliError: null, commands: null, registryHash: null }
  private healthTimer: ReturnType<typeof setInterval> | undefined
  private probing = false
  readonly workspace = {
    inspect: (args: FlovartServiceArgs = {}, signal?: AbortSignal) => this.invoke('workflow.inspect', args, signal),
    selection: (args: FlovartServiceArgs = {}, signal?: AbortSignal) => this.invoke('workflow.selection.get', args, signal),
  }
  readonly workflow = {
    apply: (args: FlovartServiceArgs, signal?: AbortSignal) => this.invoke('workflow.apply', args, signal),
    run: (args: FlovartServiceArgs, signal?: AbortSignal) => this.invoke('workflow.node.run', args, signal),
  }
  readonly artifacts = {
    get: (args: FlovartServiceArgs = {}, signal?: AbortSignal) => this.getArtifact(args, signal),
  }

  constructor(ctx: Context, config: Partial<FlovartPluginConfig> | undefined) {
    super(ctx, 'flovart')
    this.config = normalizeConfig(config)
  }

  /** Cordis dependents only run while the CLI-backed service is available. */
  [Service.check](): boolean {
    return this.state.cliReady
  }

  /** Public lifecycle entry used by the plugin and recovery checks. */
  refresh(): CliOutcome {
    return this.probe()
  }

  /**
   * Keep Cordis dependents aligned with the CLI lifecycle. The timer belongs
   * to the owning plugin fiber via the disposer returned here; it is not a
   * second Runtime or a per-tool PATH scan.
   */
  startHealthMonitor(intervalMs = DEFAULT_HEALTH_CHECK_MS): () => void {
    if (this.healthTimer) return () => {}
    const timer = setInterval(() => {
      if (this.probing) return
      this.probing = true
      try {
        this.probe()
      } finally {
        this.probing = false
      }
    }, Math.max(250, intervalMs))
    timer.unref?.()
    this.healthTimer = timer
    return () => {
      if (this.healthTimer !== timer) return
      clearInterval(timer)
      this.healthTimer = undefined
    }
  }

  /** Probe the CLI and refresh the registry snapshot. Returns the outcome. */
  probe(): CliOutcome {
    const outcome = runCliSync(this.config, 'command.list', {})
    const wasReady = this.state.cliReady
    if (outcome.ok) {
      const data = outcome.data as { commands?: Record<string, CommandMeta>; registryHash?: string | null } | null
      this.state.commands = data?.commands ?? null
      this.state.registryHash = data?.registryHash ?? null
      this.state.cliReady = this.state.commands !== null
      this.state.cliError = null
    } else {
      this.state.cliReady = false
      this.state.cliError = outcome.error?.message ?? '未知 CLI 错误'
      this.state.commands = null
      this.state.registryHash = null
    }
    if (wasReady !== this.state.cliReady) this.ctx.reflect.notify(['flovart'])
    return outcome
  }

  async status(signal?: AbortSignal): Promise<unknown> {
    return this.invoke('status', {}, signal)
  }

  async ensure(signal?: AbortSignal): Promise<unknown> {
    return this.invoke('ensure', {}, signal)
  }

  private async invoke(command: string, args: FlovartServiceArgs, signal?: AbortSignal): Promise<unknown> {
    const outcome = await runCli(this.config, command, args, signal)
    if (!outcome.ok) {
      const error = outcome.error
      throw new FlovartServiceError(
        error?.code ?? 'CLI_ERROR',
        error?.message ?? `${command} 执行失败`,
        error?.retryable ?? false,
      )
    }
    return outcome.data
  }

  private async getArtifact(args: FlovartServiceArgs, signal?: AbortSignal): Promise<unknown> {
    const taskId = typeof args.taskId === 'string' ? args.taskId : undefined
    if (!taskId) {
      throw new FlovartServiceError('INVALID_ARGUMENT', 'artifacts.get requires taskId')
    }
    const task = await this.invoke('task.get', { taskId }, signal)
    const artifact = artifactFromTask(task, taskId)
    if (!artifact) {
      throw new FlovartServiceError('ARTIFACT_NOT_FOUND', `Runtime task ${taskId} 没有可用 Artifact`)
    }
    return artifact
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    flovart: FlovartService
  }
}
