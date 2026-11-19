/**
 * @flovart/dsh-plugin — Node/Cordis half.
 *
 * A DeepSeek Harness RC8 bundle row (see cordis.patch.yml). Provides the
 * `iris` service and derives progressive model tools from the Iris CLI
 * registry. The browser half ships via exports["./client"] and registers the
 * conversation.view / shell.overlay entries.
 */

// Type-only: pulls the Context.tools / Context.skills augmentations and re-exports.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Context } from '@deepseek-ai/cordis'
import { IrisService } from './service.ts'
import { registerIrisTools } from './tools.ts'
import { createIrisSkillProvider } from './skillProvider.ts'
import { registerWorkspaceProxy } from './workspaceProxy.ts'
import { registerWebui } from './webui.ts'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IrisPluginConfig } from './config.ts'

export const name = 'iris'

// lib/index.js ships next to the packaged webui/ directory.
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WEBUI_ROOT = resolve(PACKAGE_ROOT, 'webui')
const SKILL_ROOT = resolve(PACKAGE_ROOT, 'skill')

/** Wait for the tool registry and web carrier before exposing either half. */
export const inject = ['tools', 'webServer'] as const

/** Host plugin body. */
export function apply(ctx: Context, config: Partial<IrisPluginConfig> | undefined): void {
  const service = new IrisService(ctx, config)
  service.probe()
  ctx.effect(() => service.startHealthMonitor(), 'iris: CLI health monitor')
  registerWorkspaceProxy(ctx, service.config)
  registerWebui(ctx, service.config, WEBUI_ROOT)
  ctx.inject(['iris'], toolCtx => registerIrisTools(toolCtx, service))
  // Optional: older compatibility sets have no skill registry; the plugin still boots.
  ctx.inject(['skills'], skillCtx => skillCtx.effect(
    () => skillCtx.skills.registerProvider(() => createIrisSkillProvider(SKILL_ROOT)),
    'iris: bundled skill provider',
  ))
}
