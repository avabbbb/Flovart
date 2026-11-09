import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { FlovartPluginConfig } from './config.ts'
import { connectionErrorCode, logWorkspaceTargetFailure, resolveWorkspaceTarget, type WorkspaceTargetOptions } from './workspaceTarget.ts'

export const WORKSPACE_PROXY_PATH = '/flovart-workspace'

const ROUTES = new Map<string, ReadonlySet<string>>([
  ['/health', new Set(['GET'])],
  ['/api/tools', new Set(['POST'])],
])
const MAX_BODY_BYTES = 36 * 1024 * 1024

class RequestBodyTooLargeError extends Error {
  constructor() {
    super('request body too large')
    this.name = 'RequestBodyTooLargeError'
  }
}

/**
 * Same-origin gate for the harness proxy. Browser traffic must either carry
 * Sec-Fetch-Site: same-origin or an Origin matching the harness origin the
 * request actually reached (the Host it dialed); requests without fetch
 * metadata (local CLI/tooling) are not browser CSRF traffic and pass through.
 */
export function sameOriginRequest(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return true
  const host = request.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body, (key, value) => key === 'stack' || key === 'cause' ? undefined : value))
}

// The Operator path an allowed proxy request maps to, or null.
export function resolveWorkspaceProxyPath(requestUrl: string, method = 'GET'): string | null {
  const incoming = new URL(requestUrl, 'http:' + '//' + 'dsh.local')
  if (incoming.pathname !== WORKSPACE_PROXY_PATH && !incoming.pathname.startsWith(WORKSPACE_PROXY_PATH + '/')) return null
  const path = incoming.pathname.slice(WORKSPACE_PROXY_PATH.length) || '/'
  return ROUTES.get(path)?.has(method.toUpperCase()) ? path : null
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > MAX_BODY_BYTES) throw new RequestBodyTooLargeError()
    chunks.push(value)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

export function createWorkspaceProxyHandler(
  config: Pick<FlovartPluginConfig, 'workspaceUrl' | 'workspaceToken'>,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  targetOptions: WorkspaceTargetOptions = {},
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const path = resolveWorkspaceProxyPath(request.url || '/', request.method || 'GET')
    if (!path) {
      json(response, 404, { ok: false, error: { message: 'Workspace 路由不存在。' } })
      return
    }
    if (!sameOriginRequest(request)) {
      json(response, 403, { ok: false, error: { message: 'Workspace 代理仅接受同源请求。' } })
      return
    }
    // Resolved per request so a restarted Operator (new port or token) is followed.
    const resolved = await resolveWorkspaceTarget(config, targetOptions)
    if ('failure' in resolved) {
      logWorkspaceTargetFailure(resolved.failure)
      json(response, 503, { ok: false, error: { code: resolved.failure.code, message: resolved.failure.message } })
      return
    }
    const { origin, token } = resolved.target
    try {
      const body = await readBody(request)
      const init: RequestInit = {
        method: request.method || 'GET',
        headers: {
          accept: 'application/json',
          'x-flovart-agent-token': token,
          ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      }
      if (body) init.body = body.toString('utf8')
      const upstream = await fetchImpl(new URL(path, origin), init)
      const payload = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(payload)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        json(response, 413, { ok: false, error: { message: '请求体超过 36 MB 限制。' } })
        return
      }
      const code = connectionErrorCode(error)
      console.warn('[flovart] Workspace 代理失败: ' + (code ?? 'UNKNOWN') + ' ' + origin.origin)
      if (code === 'ECONNREFUSED') {
        json(response, 503, { ok: false, error: { code: 'WORKSPACE_UNREACHABLE', message: '无法连接 Workspace Operator：' + origin.origin + ' 拒绝连接。' } })
        return
      }
      json(response, 502, { ok: false, error: { code: 'WORKSPACE_UNREACHABLE', message: '无法连接本机 Workspace Operator：' + origin.origin + '。' } })
    }
  }
}

export function registerWorkspaceProxy(ctx: Context, config: FlovartPluginConfig): void {
  const handler = createWorkspaceProxyHandler(config)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: WORKSPACE_PROXY_PATH,
    handler,
  }), 'flovart: same-origin Workspace Operator proxy')
}
