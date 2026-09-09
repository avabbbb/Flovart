import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { FlovartPluginConfig } from './config.ts'

export const WORKSPACE_PROXY_PATH = '/flovart-workspace'

const ROUTES = new Map<string, ReadonlySet<string>>([
  ['/health', new Set(['GET'])],
  ['/api/tools', new Set(['POST'])],
])
const MAX_BODY_BYTES = 36 * 1024 * 1024

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(body, (key, value) => key === 'stack' || key === 'cause' ? undefined : value))
}

function workspaceOrigin(value: string): URL {
  const configured = new URL(value)
  if (
    configured.protocol !== 'http:' ||
    configured.hostname !== '127.0.0.1' ||
    !configured.port ||
    configured.pathname !== '/' ||
    configured.search ||
    configured.hash ||
    configured.username ||
    configured.password
  ) throw new Error('Workspace Operator 必须使用带显式端口的 127.0.0.1 http 地址。')
  const port = Number(configured.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Workspace Operator 端口无效。')
  }
  const target = new URL('http://127.0.0.1:1')
  target.port = String(port)
  return target
}

export function resolveWorkspaceProxyTarget(workspaceUrl: string, requestUrl: string, method = 'GET'): URL | null {
  const incoming = new URL(requestUrl, 'http://dsh.local')
  if (incoming.pathname !== WORKSPACE_PROXY_PATH && !incoming.pathname.startsWith(`${WORKSPACE_PROXY_PATH}/`)) return null
  const path = incoming.pathname.slice(WORKSPACE_PROXY_PATH.length) || '/'
  if (!ROUTES.get(path)?.has(method.toUpperCase())) return null
  const target = workspaceOrigin(workspaceUrl)
  target.search = ''
  switch (path) {
    case '/health':
      target.pathname = '/health'
      break
    case '/api/tools':
      target.pathname = '/api/tools'
      break
    default:
      return null
  }
  return target
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(value)
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

export function createWorkspaceProxyHandler(
  config: Pick<FlovartPluginConfig, 'workspaceUrl' | 'workspaceToken'>,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    if (!config.workspaceToken) {
      json(response, 503, { ok: false, error: { message: 'Workspace Operator 尚未由 Flovart Harness 启动器准备。' } })
      return
    }
    let target: URL | null
    try {
      target = resolveWorkspaceProxyTarget(config.workspaceUrl, request.url || '/', request.method || 'GET')
    } catch {
      json(response, 503, { ok: false, error: { message: 'Workspace Operator 地址不可用。' } })
      return
    }
    if (!target) {
      json(response, 404, { ok: false, error: { message: 'Workspace 路由不存在。' } })
      return
    }
    try {
      const body = await readBody(request)
      const init: RequestInit = {
        method: request.method || 'GET',
        headers: {
          accept: 'application/json',
          'x-flovart-agent-token': config.workspaceToken,
          ...(request.headers['content-type'] ? { 'content-type': request.headers['content-type'] } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      }
      if (body) init.body = body.toString('utf8')
      const upstream = await fetchImpl(target, init)
      const payload = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      response.end(payload)
    } catch {
      json(response, 502, { ok: false, error: { message: '无法连接本机 Workspace Operator。' } })
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
