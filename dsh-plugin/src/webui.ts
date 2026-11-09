// Same-origin host route for the embedded Flovart canvas.
// GET/HEAD only. Static files come from the packaged webui directory with
// traversal-safe resolution and an index.html SPA fallback; the single
// /api/bootstrap endpoint asks the Workspace Operator for a one-time browser
// bootstrap token server-side. The persistent workspace token never leaves
// this process: it is sent only to the loopback Operator, never logged or
// returned.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, isAbsolute, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { FlovartPluginConfig } from './config.ts'
import { sameOriginRequest } from './workspaceProxy.ts'
import { connectionErrorCode, logWorkspaceTargetFailure, resolveWorkspaceTarget, type WorkspaceTargetOptions } from './workspaceTarget.ts'

export const WEBUI_PATH = '/flovart-app'
const BOOTSTRAP_SEGMENT = 'api/bootstrap'
const REQUEST_BASE = 'http' + '://dsh.local'
const ISSUE_TIMEOUT_MS = 5000

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'content-security-policy': "frame-ancestors 'self'",
}

interface ConnectionGate {
  requestRejection?: (request: { readonly headers: IncomingMessage['headers'] }) => 401 | 403 | undefined
}

export type WebuiTarget =
  | { kind: 'redirect'; location: string }
  | { kind: 'bootstrap' }
  | { kind: 'index' }
  | { kind: 'file'; file: string; index: boolean; spaFallback: boolean }
  | { kind: 'reject'; status: 400 | 403 | 404 }

export interface BootstrapResult {
  status: number
  body: Record<string, unknown>
}

export interface WebuiHandlerOptions {
  root: string
  config: Pick<FlovartPluginConfig, 'workspaceUrl' | 'workspaceToken'>
  gate?: () => ConnectionGate | undefined
  fetchImpl?: typeof globalThis.fetch
  target?: WorkspaceTargetOptions
}

export function resolveWebuiTarget(root: string, requestUrl: string): WebuiTarget {
  // The raw text is checked as well: URL parsing already folds dot segments,
  // so an encoded or literal parent reference must never reach the resolver.
  const rawPath = requestUrl.split(/[?#]/, 1)[0] ?? ''
  if (rawPath.includes('..') || /%2e|%5c|%00/i.test(rawPath) || rawPath.includes('\\')) return { kind: 'reject', status: 403 }
  let incoming: URL
  try { incoming = new URL(requestUrl, REQUEST_BASE) }
  catch { return { kind: 'reject', status: 400 } }
  const { pathname } = incoming
  if (pathname === WEBUI_PATH) return { kind: 'redirect', location: WEBUI_PATH + '/' + incoming.search }
  if (!pathname.startsWith(WEBUI_PATH + '/')) return { kind: 'reject', status: 404 }
  let relative: string
  try { relative = decodeURIComponent(pathname.slice(WEBUI_PATH.length + 1)) }
  catch { return { kind: 'reject', status: 400 } }
  if (relative === BOOTSTRAP_SEGMENT) return { kind: 'bootstrap' }
  const segments = relative.split(/[\/\\]/)
  if (
    relative.includes('\0') ||
    isAbsolute(relative) ||
    /^[a-z]:/i.test(relative) ||
    segments.some(segment => segment === '..' || segment === '.')
  ) return { kind: 'reject', status: 403 }
  if (relative === '' || relative.endsWith('/')) return { kind: 'index' }
  const base = resolve(root)
  const file = resolve(base, ...segments.filter(Boolean))
  if (!file.startsWith(base + sep)) return { kind: 'reject', status: 403 }
  return {
    kind: 'file',
    file,
    index: file === resolve(base, 'index.html'),
    spaFallback: extname(file) === '',
  }
}

export async function issueBootstrap(
  config: Pick<FlovartPluginConfig, 'workspaceUrl' | 'workspaceToken'>,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  targetOptions: WorkspaceTargetOptions = {},
): Promise<BootstrapResult> {
  // Resolved per request: explicit launcher env, else agent.json read now.
  const resolved = await resolveWorkspaceTarget(config, targetOptions)
  if (!resolved.ok) {
    logWorkspaceTargetFailure(resolved.failure)
    const code = resolved.failure.code === 'WORKSPACE_URL_INVALID' ? 'WORKSPACE_URL_INVALID' : 'WORKSPACE_NOT_PREPARED'
    return { status: 503, body: { ok: false, error: { code, reason: resolved.failure.code, message: resolved.failure.message } } }
  }
  const { origin, token } = resolved.target
  const agentUrl = origin.origin
  try {
    const upstream = await fetchImpl(new URL('/bootstrap/issue', origin), {
      method: 'POST',
      headers: { accept: 'application/json', 'x-flovart-agent-token': token },
      signal: AbortSignal.timeout(ISSUE_TIMEOUT_MS),
    })
    const payload: unknown = await upstream.json().catch(() => null)
    const fields = typeof payload === 'object' && payload !== null ? payload : {}
    const bootstrapToken = 'bootstrapToken' in fields ? fields.bootstrapToken : undefined
    const expiresAt = 'expiresAt' in fields ? fields.expiresAt : undefined
    if (!upstream.ok || typeof bootstrapToken !== 'string' || !bootstrapToken) {
      return { status: 502, body: { ok: false, agentUrl, error: { code: 'BOOTSTRAP_ISSUE_FAILED', message: 'Workspace Operator ' + agentUrl + ' 未签发 bootstrap credential（HTTP ' + upstream.status + '）。' } } }
    }
    return {
      status: 200,
      body: { ok: true, agentUrl, bootstrapToken, ...(typeof expiresAt === 'number' ? { expiresAt } : {}) },
    }
  } catch (error) {
    const code = connectionErrorCode(error)
    console.warn('[flovart] bootstrap 签发失败: ' + (code ?? (error instanceof Error ? error.name : 'UNKNOWN')) + ' ' + agentUrl)
    if (code === 'ECONNREFUSED') {
      return { status: 503, body: { ok: false, agentUrl, error: { code: 'WORKSPACE_UNREACHABLE', message: '无法连接 Workspace Operator：' + agentUrl + ' 拒绝连接。' } } }
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { status: 504, body: { ok: false, agentUrl, error: { code: 'WORKSPACE_TIMEOUT', message: 'Workspace Operator ' + agentUrl + ' 响应超时。' } } }
    }
    return { status: 502, body: { ok: false, agentUrl, error: { code: 'WORKSPACE_UNREACHABLE', message: '无法连接 Workspace Operator：' + agentUrl + '。' } } }
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown, head = false): void {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
    ...SECURITY_HEADERS,
  })
  response.end(head ? undefined : text)
}

function cacheControl(file: string, index: boolean): string {
  if (index) return 'no-store'
  return file.includes(sep + 'assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache'
}

async function serveFile(request: IncomingMessage, response: ServerResponse, file: string, index: boolean): Promise<boolean> {
  const info = await stat(file).catch(() => null)
  if (!info?.isFile()) return false
  response.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(info.size),
    'cache-control': cacheControl(file, index),
    ...SECURITY_HEADERS,
  })
  if (request.method === 'HEAD') {
    response.end()
    return true
  }
  // tsconfig lib predates es2024 (no Promise.withResolvers), so executor form.
  await new Promise<void>(finish => {
    const stream = createReadStream(file)
    stream.on('error', () => { response.destroy(); finish() })
    response.on('close', () => finish())
    stream.pipe(response)
  })
  return true
}

function requestRejection(request: IncomingMessage, gate: WebuiHandlerOptions['gate']): number | undefined {
  const connection = gate?.()
  if (connection && typeof connection.requestRejection === 'function') {
    return connection.requestRejection({ headers: request.headers })
  }
  return sameOriginRequest(request) ? undefined : 403
}

export function createWebuiHandler(options: WebuiHandlerOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  return async (request, response) => {
    const method = (request.method || 'GET').toUpperCase()
    const head = method === 'HEAD'
    if (method !== 'GET' && !head) {
      response.setHeader('allow', 'GET, HEAD')
      sendJson(response, 405, { ok: false, error: { message: 'Flovart 页面只接受 GET/HEAD。' } })
      return
    }
    const rejected = requestRejection(request, options.gate)
    if (rejected) {
      sendJson(response, rejected, { ok: false, error: { message: 'Flovart 页面仅对已认证的同源 DSH 会话开放。' } }, head)
      return
    }
    const target = resolveWebuiTarget(options.root, request.url || '/')
    if (target.kind === 'reject') {
      sendJson(response, target.status, { ok: false, error: { message: target.status === 404 ? 'Flovart 页面路由不存在。' : 'Flovart 页面路径无效。' } }, head)
      return
    }
    if (target.kind === 'redirect') {
      response.writeHead(308, { location: target.location, 'cache-control': 'no-store', ...SECURITY_HEADERS })
      response.end()
      return
    }
    if (target.kind === 'bootstrap') {
      // Fetch metadata is mandatory here: only the same-origin page may mint.
      if (request.headers['sec-fetch-site'] !== 'same-origin' || !sameOriginRequest(request)) {
        sendJson(response, 403, { ok: false, error: { message: 'bootstrap 仅接受同源页面请求。' } }, head)
        return
      }
      if (head) {
        sendJson(response, 405, { ok: false }, true)
        return
      }
      const result = await issueBootstrap(options.config, fetchImpl, options.target)
      sendJson(response, result.status, result.body)
      return
    }
    const indexFile = resolve(options.root, 'index.html')
    if (target.kind === 'file' && await serveFile(request, response, target.file, target.index)) return
    if (target.kind === 'file' && !target.spaFallback) {
      sendJson(response, 404, { ok: false, error: { message: 'Flovart 静态资源不存在。' } }, head)
      return
    }
    if (await serveFile(request, response, indexFile, true)) return
    sendJson(response, 503, { ok: false, error: { message: 'Flovart 页面尚未构建（缺少 webui/index.html）。' } }, head)
  }
}

// ctx.connection is optional (dsh-client-connection may be absent): feature-detect it.
function connectionGate(ctx: Context): ConnectionGate | undefined {
  let value: unknown
  try { value = Reflect.get(ctx, 'connection') }
  catch { return undefined }
  if (typeof value !== 'object' || value === null || !('requestRejection' in value)) return undefined
  const reject = value.requestRejection
  if (typeof reject !== 'function') return undefined
  return { requestRejection: request => reject.call(value, request) }
}

export function registerWebui(ctx: Context, config: FlovartPluginConfig, root: string): void {
  const gate = () => connectionGate(ctx)
  const handler = createWebuiHandler({ root, config, gate })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: WEBUI_PATH,
    handler,
  }), 'flovart: embedded canvas route')
}
