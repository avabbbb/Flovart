// Single source of truth for the Workspace Operator the host talks to.
// Explicit launcher env (a non-default URL and a non-empty token) wins.
// Otherwise the Operator's own agent.json is read on every call, matching the
// supervisor's borrow semantics: a restarted Operator on a new port or with a
// rotated token is followed without restarting DSH.
// The token stays in host memory: callers send it only to the loopback
// Operator. Failures name the URL or file tried, never the token.
import { readFile as fsReadFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG, type FlovartPluginConfig } from './config.ts'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export interface WorkspaceTarget {
  origin: URL
  token: string
  source: 'env' | 'agent.json'
}

export type WorkspaceTargetCode =
  | 'AGENT_CONFIG_MISSING'
  | 'AGENT_CONFIG_UNREADABLE'
  | 'AGENT_CONFIG_INVALID'
  | 'AGENT_CONFIG_INCOMPLETE'
  | 'WORKSPACE_URL_INVALID'

export interface WorkspaceTargetFailure {
  code: WorkspaceTargetCode
  message: string
  /** The URL or file path tried; never a credential. */
  tried: string
}

export type WorkspaceTargetResult =
  | { ok: true; target: WorkspaceTarget }
  | { ok: false; failure: WorkspaceTargetFailure }

export interface WorkspaceTargetOptions {
  env?: Readonly<Record<string, string | undefined>>
  readFile?: (path: string) => Promise<string>
}

export function agentConfigPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.FLOVART_AGENT_CONFIG || join(homedir(), '.dsh', 'workspace', 'agent.json')
}

/** A loopback http origin with an explicit port, or null for anything else. */
export function loopbackOrigin(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname) || !url.port) return null
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null
  return new URL(url.origin)
}

// Userinfo is dropped so a malformed URL carrying credentials is never echoed.
function describeUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol + '//' + url.host + url.pathname
  } catch {
    return '（无法解析的地址）'
  }
}

function fail(code: WorkspaceTargetCode, tried: string, message: string): WorkspaceTargetResult {
  return { ok: false, failure: { code, tried, message } }
}

function invalidUrl(value: string, from: string): WorkspaceTargetResult {
  const tried = describeUrl(value)
  return fail('WORKSPACE_URL_INVALID', tried, 'Workspace Operator 地址 ' + tried + '（来自 ' + from + '）不是带显式端口的本机回环 http 地址。')
}

function readErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code
  return 'UNKNOWN'
}

export async function resolveWorkspaceTarget(
  config: Pick<FlovartPluginConfig, 'workspaceUrl' | 'workspaceToken'>,
  options: WorkspaceTargetOptions = {},
): Promise<WorkspaceTargetResult> {
  if (config.workspaceToken && config.workspaceUrl && config.workspaceUrl !== DEFAULT_CONFIG.workspaceUrl) {
    const origin = loopbackOrigin(config.workspaceUrl)
    if (!origin) return invalidUrl(config.workspaceUrl, 'FLOVART_WORKSPACE_URL')
    return { ok: true, target: { origin, token: config.workspaceToken, source: 'env' } }
  }
  const file = agentConfigPath(options.env ?? process.env)
  const read = options.readFile ?? (path => fsReadFile(path, 'utf8'))
  let text: string
  try {
    text = await read(file)
  } catch (error) {
    const code = readErrorCode(error)
    if (code === 'ENOENT') return fail('AGENT_CONFIG_MISSING', file, '找不到 Workspace Operator 配置文件：' + file + '。请先启动 Workspace Operator。')
    return fail('AGENT_CONFIG_UNREADABLE', file, '无法读取 Workspace Operator 配置文件：' + file + '（' + code + '）。')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail('AGENT_CONFIG_INVALID', file, 'Workspace Operator 配置文件不是有效 JSON：' + file + '。')
  }
  const fields = typeof parsed === 'object' && parsed !== null ? parsed : {}
  const url = 'url' in fields && typeof fields.url === 'string' ? fields.url : ''
  const token = 'token' in fields && typeof fields.token === 'string' ? fields.token : ''
  if (!url || !token) return fail('AGENT_CONFIG_INCOMPLETE', file, 'Workspace Operator 配置文件缺少 url 或 token：' + file + '。')
  const origin = loopbackOrigin(url)
  if (!origin) return invalidUrl(url, file)
  return { ok: true, target: { origin, token, source: 'agent.json' } }
}

/** Logs only the failure code and the URL or file tried. */
export function logWorkspaceTargetFailure(failure: WorkspaceTargetFailure): void {
  console.warn('[flovart] Workspace Operator 不可用: ' + failure.code + ' ' + failure.tried)
}

function errorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if ('code' in value && typeof value.code === 'string') return value.code
  if ('errors' in value && Array.isArray(value.errors)) return errorCode(value.errors[0])
  return undefined
}

// Node fetch wraps socket failures: the errno code sits on error.cause.
export function connectionErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('cause' in error)) return undefined
  return errorCode(error.cause)
}
