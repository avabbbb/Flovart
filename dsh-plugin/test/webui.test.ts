import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createWebuiHandler } from '../src/webui.ts'

const LOOPBACK = 'http' + '://127.0.0.1'

// The persistent token under test: the real agent.json value when one exists
// (never printed), else a synthetic stand-in.
function persistentToken(): { value: string; source: string } {
  const file = process.env.FLOVART_AGENT_CONFIG || join(homedir(), '.dsh', 'workspace', 'agent.json')
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed === 'object' && parsed !== null && 'token' in parsed && typeof parsed.token === 'string' && parsed.token) {
      return { value: parsed.token, source: 'agent.json' }
    }
  } catch { /* fall through */ }
  return { value: 'synthetic-persistent-token-0123456789', source: 'synthetic' }
}

const PERSISTENT = persistentToken()
const ONE_TIME = 'one-time-bootstrap-abc'

function listen(server: Server): Promise<number> {
  return new Promise(done => server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)))
}

function close(server: Server): Promise<void> {
  return new Promise(done => server.close(() => done()))
}

interface Reply { status: number; headers: IncomingHttpHeaders; text: string }

function call(port: number, path: string, method = 'GET', headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => done({ status: res.statusCode || 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', fail)
    req.end()
  })
}

function fixture(): string {
  const base = mkdtempSync(join(tmpdir(), 'flovart-webui-'))
  writeFileSync(join(base, 'secret.txt'), 'TOP-SECRET-OUTSIDE-ROOT')
  const root = join(base, 'webui')
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>flovart</title>')
  writeFileSync(join(root, 'assets', 'app-abc.js'), 'console.log(1)')
  writeFileSync(join(root, 'robots.txt'), 'ok')
  return root
}

interface Operator { server: Server; port: number; seen: Array<{ token: unknown; origin: unknown; method: unknown }> }

async function fakeOperator(): Promise<Operator> {
  const seen: Operator['seen'] = []
  const server = createServer((req, res) => {
    seen.push({ token: req.headers['x-flovart-agent-token'], origin: req.headers.origin, method: req.method })
    const authorized = req.method === 'POST' && req.url === '/bootstrap/issue' && !req.headers.origin && req.headers['x-flovart-agent-token'] === PERSISTENT.value
    res.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' })
    res.end(JSON.stringify(authorized ? { ok: true, bootstrapToken: ONE_TIME, expiresAt: 123 } : { ok: false }))
  })
  return { server, port: await listen(server), seen }
}

async function host(options: Parameters<typeof createWebuiHandler>[0]): Promise<{ server: Server; port: number }> {
  const handler = createWebuiHandler(options)
  const server = createServer((req, res) => { void handler(req, res) })
  return { server, port: await listen(server) }
}

function sameOrigin(port: number): Record<string, string> {
  return { 'sec-fetch-site': 'same-origin', origin: LOOPBACK + ':' + port }
}

test('static serving, SPA fallback, MIME and cache headers', async () => {
  const root = fixture()
  const { server, port } = await host({ root, config: { workspaceUrl: LOOPBACK + ':1', workspaceToken: '' } })
  try {
    const index = await call(port, '/flovart-app/?embed=dsh')
    assert.equal(index.status, 200)
    assert.match(String(index.headers['content-type']), /^text\/html/)
    assert.equal(index.headers['cache-control'], 'no-store')
    assert.match(index.text, /flovart/)

    const deep = await call(port, '/flovart-app/workflow/abc')
    assert.equal(deep.status, 200)
    assert.equal(deep.headers['cache-control'], 'no-store')
    assert.match(deep.text, /<title>flovart/)

    const asset = await call(port, '/flovart-app/assets/app-abc.js')
    assert.equal(asset.status, 200)
    assert.match(String(asset.headers['content-type']), /^text\/javascript/)
    assert.match(String(asset.headers['cache-control']), /immutable/)

    const plain = await call(port, '/flovart-app/robots.txt')
    assert.equal(plain.status, 200)
    assert.equal(plain.headers['cache-control'], 'no-cache')

    assert.equal((await call(port, '/flovart-app/assets/missing.js')).status, 404)

    const head = await call(port, '/flovart-app/', 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.text, '')

    const redirect = await call(port, '/flovart-app?embed=dsh')
    assert.equal(redirect.status, 308)
    assert.equal(redirect.headers.location, '/flovart-app/?embed=dsh')

    assert.equal((await call(port, '/flovart-app/', 'POST')).status, 405)
    assert.equal((await call(port, '/flovart-appx/index.html')).status, 404)
    assert.match(String(index.headers['content-security-policy']), /frame-ancestors 'self'/)
  } finally {
    await close(server)
  }
})

test('path traversal is rejected', async () => {
  const root = fixture()
  const { server, port } = await host({ root, config: { workspaceUrl: LOOPBACK + ':1', workspaceToken: '' } })
  try {
    const attempts = [
      '/flovart-app/../secret.txt',
      '/flovart-app/assets/../../secret.txt',
      '/flovart-app/%2e%2e/secret.txt',
      '/flovart-app/%2E%2E/secret.txt',
      '/flovart-app/..%2fsecret.txt',
      '/flovart-app/%5c..%5csecret.txt',
      '/flovart-app/assets%5c..%5c..%5csecret.txt',
      '/flovart-app/%00index.html',
      '/flovart-app/C:%5cWindows%5cwin.ini',
    ]
    for (const path of attempts) {
      const reply = await call(port, path)
      assert.ok(reply.status === 403 || reply.status === 404, path + ' -> ' + reply.status)
      assert.ok(!reply.text.includes('TOP-SECRET'), path + ' leaked a file outside the root')
    }
    const doubled = await call(port, '/flovart-app//secret.txt')
    assert.ok(!doubled.text.includes('TOP-SECRET'))
  } finally {
    await close(server)
  }
})

test('bootstrap issues a one-time token server-side and never returns the persistent token', async () => {
  const operator = await fakeOperator()
  const root = fixture()
  const agentUrl = LOOPBACK + ':' + operator.port
  const { server, port } = await host({ root, config: { workspaceUrl: agentUrl, workspaceToken: PERSISTENT.value } })
  try {
    const ok = await call(port, '/flovart-app/api/bootstrap', 'GET', sameOrigin(port))
    assert.equal(ok.status, 200)
    assert.equal(ok.headers['cache-control'], 'no-store')
    const body: unknown = JSON.parse(ok.text)
    assert.deepEqual(body, { ok: true, agentUrl, bootstrapToken: ONE_TIME, expiresAt: 123 })
    assert.ok(!ok.text.includes(PERSISTENT.value), 'persistent token (' + PERSISTENT.source + ') leaked into the bootstrap body')
    assert.ok(!JSON.stringify(ok.headers).includes(PERSISTENT.value), 'persistent token leaked into headers')
    assert.equal(operator.seen.length, 1)
    assert.equal(operator.seen[0]?.origin, undefined)
    assert.equal(operator.seen[0]?.method, 'POST')

    // DSH Desktop's dsh-app:// proxy forwards requests without Origin or
    // Sec-Fetch-Site; it must be able to mint. Cross-site and spoofed Origin
    // are still rejected below.
    const desktopForwarded = await call(port, '/flovart-app/api/bootstrap')
    assert.equal(desktopForwarded.status, 200)
    const crossSite = await call(port, '/flovart-app/api/bootstrap', 'GET', { 'sec-fetch-site': 'cross-site', origin: 'http' + '://evil.example' })
    assert.equal(crossSite.status, 403)
    const spoofed = await call(port, '/flovart-app/api/bootstrap', 'GET', { 'sec-fetch-site': 'same-origin', origin: 'http' + '://evil.example' })
    assert.equal(spoofed.status, 403)
    assert.equal((await call(port, '/flovart-app/api/bootstrap', 'POST', sameOrigin(port))).status, 405)
    assert.equal(operator.seen.length, 2)
  } finally {
    await close(server)
    await close(operator.server)
  }
})

test('bootstrap reports a refused Operator as 503 naming the URL, without the token', async () => {
  const probe = createServer()
  const deadPort = await listen(probe)
  await close(probe)
  const root = fixture()
  const agentUrl = LOOPBACK + ':' + deadPort
  const { server, port } = await host({ root, config: { workspaceUrl: agentUrl, workspaceToken: PERSISTENT.value } })
  try {
    const reply = await call(port, '/flovart-app/api/bootstrap', 'GET', sameOrigin(port))
    assert.equal(reply.status, 503)
    assert.ok(reply.text.includes(agentUrl), 'message names the URL tried')
    assert.match(reply.text, /WORKSPACE_UNREACHABLE/)
    assert.ok(!reply.text.includes(PERSISTENT.value), 'persistent token leaked into the error body')
  } finally {
    await close(server)
  }
})

test('bootstrap without env or agent.json is 503 naming the file tried', async () => {
  const root = fixture()
  const missing = join(mkdtempSync(join(tmpdir(), 'flovart-agent-')), 'agent.json')
  const target = { env: { FLOVART_AGENT_CONFIG: missing } }
  const { server, port } = await host({ root, config: { workspaceUrl: LOOPBACK + ':17372', workspaceToken: '' }, target })
  try {
    const reply = await call(port, '/flovart-app/api/bootstrap', 'GET', sameOrigin(port))
    assert.equal(reply.status, 503)
    assert.match(reply.text, /WORKSPACE_NOT_PREPARED/)
    assert.match(reply.text, /AGENT_CONFIG_MISSING/)
    assert.ok(reply.text.includes(JSON.stringify(missing).slice(1, -1)), 'message names the agent.json path tried')
  } finally {
    await close(server)
  }
})

test('connection gate rejection is honored when the service exists', async () => {
  const root = fixture()
  const gate = () => ({ requestRejection: () => 401 as const })
  const { server, port } = await host({ root, config: { workspaceUrl: LOOPBACK + ':1', workspaceToken: '' }, gate })
  try {
    assert.equal((await call(port, '/flovart-app/')).status, 401)
    assert.equal((await call(port, '/flovart-app/api/bootstrap', 'GET', sameOrigin(port))).status, 401)
  } finally {
    await close(server)
  }
})

test('without a gate, cross-origin browser requests are refused', async () => {
  const root = fixture()
  const { server, port } = await host({ root, config: { workspaceUrl: LOOPBACK + ':1', workspaceToken: '' } })
  try {
    assert.equal((await call(port, '/flovart-app/', 'GET', { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await call(port, '/flovart-app/', 'GET', sameOrigin(port))).status, 200)
  } finally {
    await close(server)
  }
})
