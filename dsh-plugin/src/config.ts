/**
 * Plugin config shape. Mirrors the `config` block of the `flovart` row in
 * `cordis.patch.yml`; defaults keep the plugin bootable when a profile layer
 * omits keys.
 */

export interface FlovartPluginConfig {
  /** Loopback Workspace Operator origin prepared by the launcher. */
  workspaceUrl: string
  /** Host-only Workspace Operator credential; never serialized to the browser. */
  workspaceToken: string
  /** Flovart CLI launcher: a bare binary name or a full command line (quoted tokens allowed). */
  cli: string
  /** Per-CLI-call timeout in milliseconds. */
  toolTimeoutMs: number
  /** DSH always joins the visible Browser Workflow authority. */
  workspaceMode: 'browser'
}

export const DEFAULT_CONFIG: FlovartPluginConfig = {
  workspaceUrl: 'http://127.0.0.1:17372',
  workspaceToken: '',
  cli: 'flovart',
  toolTimeoutMs: 30000,
  workspaceMode: 'browser',
}

export function normalizeConfig(config: Partial<FlovartPluginConfig> | undefined): FlovartPluginConfig {
  return { ...DEFAULT_CONFIG, ...config, workspaceMode: 'browser' }
}
