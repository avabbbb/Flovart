/**
 * @flovart/dsh-plugin — Node/Cordis half.
 *
 * A DeepSeek Harness RC8 bundle row (see cordis.patch.yml). Provides the
 * `flovart` service and derives progressive model tools from the Flovart CLI
 * registry. The browser half ships via exports["./client"] and registers the
 * conversation.view / shell.overlay entries.
 */

// Type-only: pulls the Context.tools augmentation and re-exports.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { FlovartService } from './service.ts'
import { registerFlovartTools } from './tools.ts'
import { registerWorkspaceProxy } from './workspaceProxy.ts'
import { registerWebui } from './webui.ts'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FlovartPluginConfig } from './config.ts'

export const name = 'flovart'

// lib/index.js ships next to the packaged webui/ directory.
const WEBUI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'webui')

/** Wait for the tool registry and web carrier before exposing either half. */
export const inject = ['tools', 'webServer'] as const

/** Host plugin body. */
export function apply(ctx: Context, config: Partial<FlovartPluginConfig> | undefined): void {
  const service = new FlovartService(ctx, config)
  service.probe()
  ctx.effect(() => service.startHealthMonitor(), 'flovart: CLI health monitor')
  registerWorkspaceProxy(ctx, service.config)
  registerWebui(ctx, service.config, WEBUI_ROOT)
  ctx.inject(['flovart'], toolCtx => registerFlovartTools(toolCtx, service))
}
