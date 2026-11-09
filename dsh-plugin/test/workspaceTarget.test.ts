import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { resolveWorkspaceTarget, type WorkspaceTargetOptions } from '../src/workspaceTarget.ts'
import { createWorkspaceProxyHandler } from '../src/workspaceProxy.ts'

const LOOPBACK = 'http:' + '//' + '127.0.0.1'
const DEFAULT_URL = LOOPBACK + ':17372'
const FILE_TOKEN = 'file-token-7f3a9c'
const ENV_TOKEN = 'env-token-2b81d4'
const unprepared = { workspaceUrl: DEFAULT_URL, workspaceToken: '' }

function agentFile(contents: unknown): string {
  const file = join(mkdtempSync(join(tmpdir(), 'flovart-target-')), 'agent.json')
  writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents))
  return file
}

function listen(server: Server): Promise<number> {
  return new Promise(done => server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)))
}

// fetch keeps sockets alive; drop them so close() resolves.
function close(server: Server): Promise<void> {
  server.closeAllConnections()
  return new Promise(done => server.close(() => done()))
}

function get(port: number, path: string): Promise<{ status: number; text: string }> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => done({ status: res.statusCode ?? 0, text }))
    })
    req.on('error', fail)
    req.end()
  })
}

async function failureFor(options: WorkspaceTargetOptions) {
  const result = await resolveWorkspaceTarget(unprepared, options)
  assert.ok(!result.ok)
  assert.ok(!JSON.stringify(result.failure).includes(FILE_TOKEN), 'token leaked into the failure')
  return result.failure
}

test('explicit env url and token win over agent.json', async () => {
  const file = agentFile({ url: LOOPBACK + ':17999', token: FILE_TOKEN })
  const result = await resolveWorkspaceTarget({ workspaceUrl: LOOPBACK + ':40001', workspaceToken: ENV_TOKEN }, { env: { FLOVART_AGENT_CONFIG: file } })
  assert.ok(result.ok)
  assert.equal(result.target.source, 'env')
  assert.equal(result.target.origin.port, '40001')
  assert.equal(result.target.token, ENV_TOKEN)
})

test('default url or empty token falls back to agent.json, re-read on every call', async () => {
  const file = agentFile({ url: LOOPBACK + ':17999', token: FILE_TOKEN })
  const env = { FLOVART_AGENT_CONFIG: file }
  const first = await resolveWorkspaceTarget(unprepared, { env })
  assert.ok(first.ok)
  assert.equal(first.target.source, 'agent.json')
  assert.equal(first.target.origin.origin, LOOPBACK + ':17999')
  assert.equal(first.target.token, FILE_TOKEN)
  writeFileSync(file, JSON.stringify({ url: LOOPBACK + ':18000', token: 'rotated-token' }))
  const second = await resolveWorkspaceTarget({ workspaceUrl: DEFAULT_URL, workspaceToken: ENV_TOKEN }, { env })
  assert.ok(second.ok)
  assert.equal(second.target.source, 'agent.json')
  assert.equal(second.target.origin.port, '18000')
  assert.equal(second.target.token, 'rotated-token')
})

test('localhost and [::1] count as loopback', async () => {
  for (const host of ['localhost', '[::1]']) {
    const file = agentFile({ url: 'http:' + '//' + host + ':17999', token: FILE_TOKEN })
    const result = await resolveWorkspaceTarget(unprepared, { env: { FLOVART_AGENT_CONFIG: file } })
    assert.ok(result.ok, host)
  }
})

test('unusable agent.json fails with a code naming the file or url, never the token', async () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'flovart-target-')), 'absent.json')
  const absent = await failureFor({ env: { FLOVART_AGENT_CONFIG: missing } })
  assert.equal(absent.code, 'AGENT_CONFIG_MISSING')
  assert.ok(absent.message.includes(missing))

  const corruptFile = agentFile('{"url": "' + LOOPBACK + ':17999", "token": "' + FILE_TOKEN + '"')
  const corrupt = await failureFor({ env: { FLOVART_AGENT_CONFIG: corruptFile } })
  assert.equal(corrupt.code, 'AGENT_CONFIG_INVALID')
  assert.ok(corrupt.message.includes(corruptFile))

  const partialFile = agentFile({ url: LOOPBACK + ':17999' })
  const partial = await failureFor({ env: { FLOVART_AGENT_CONFIG: partialFile } })
  assert.equal(partial.code, 'AGENT_CONFIG_INCOMPLETE')

  const remoteFile = agentFile({ url: 'http:' + '//' + '10.0.0.5:17373', token: FILE_TOKEN })
  const remote = await failureFor({ env: { FLOVART_AGENT_CONFIG: remoteFile } })
  assert.equal(remote.code, 'WORKSPACE_URL_INVALID')
  assert.ok(remote.message.includes('10.0.0.5:17373'))

  const lockedPath = join(tmpdir(), 'flovart-locked', 'agent.json')
  const readFile = async (): Promise<string> => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }) }
  const locked = await failureFor({ env: { FLOVART_AGENT_CONFIG: lockedPath }, readFile })
  assert.equal(locked.code, 'AGENT_CONFIG_UNREADABLE')
  assert.ok(locked.message.includes(lockedPath))
  assert.ok(locked.message.includes('EPERM'))
})

test('proxy follows agent.json per request and never leaks the token', async () => {
  const seen: unknown[] = []
  const operator = createServer((req, res) => {
    seen.push(req.headers['x-flovart-agent-token'])
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"ok":true}')
  })
  const operatorPort = await listen(operator)
  const operatorUrl = LOOPBACK + ':' + operatorPort
  const file = agentFile({ url: operatorUrl, token: FILE_TOKEN })
  const handler = createWorkspaceProxyHandler(unprepared, globalThis.fetch, { env: { FLOVART_AGENT_CONFIG: file } })
  const host = createServer((req, res) => { void handler(req, res) })
  const port = await listen(host)
  const warn = mock.method(console, 'warn', () => {})
  try {
    const ok = await get(port, '/flovart-workspace/health')
    assert.equal(ok.status, 200)
    assert.deepEqual(seen, [FILE_TOKEN])

    await close(operator)
    const refused = await get(port, '/flovart-workspace/health')
    assert.equal(refused.status, 503)
    assert.ok(refused.text.includes(operatorUrl), 'message names the url tried')
    assert.ok(!refused.text.includes(FILE_TOKEN))

    writeFileSync(file, '{not json')
    const corrupt = await get(port, '/flovart-workspace/health')
    assert.equal(corrupt.status, 503)
    assert.match(corrupt.text, /AGENT_CONFIG_INVALID/)
    assert.ok(!corrupt.text.includes(FILE_TOKEN))

    assert.ok(warn.mock.callCount() >= 2)
    const logged = JSON.stringify(warn.mock.calls.map(call => call.arguments))
    assert.ok(!logged.includes(FILE_TOKEN), 'token leaked into console output')
  } finally {
    warn.mock.restore()
    if (operator.listening) await close(operator)
    await close(host)
  }
})
