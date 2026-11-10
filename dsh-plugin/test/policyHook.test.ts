import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerFlovartTools, STABLE_TOOL_COMMANDS } from '../src/tools.ts'

function fakeCtx() {
  const listeners: Array<{ event: string, listener: (exec: { name: string, arguments?: unknown }, next: () => Promise<{ kind: string }>) => Promise<unknown> }> = []
  return {
    listeners,
    ctx: {
      tools: { register() { return () => {} } },
      on(event: string, listener: (typeof listeners)[number]['listener']) {
        const entry = { event, listener }
        listeners.push(entry)
        return () => {
          const index = listeners.indexOf(entry)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
    },
  }
}

function fakeService(approval: 'never' | 'on-request' | 'untrusted') {
  const commands: Record<string, { summary: string, args: Record<string, string> }> = {}
  for (const command of STABLE_TOOL_COMMANDS) commands[command] = { summary: 's', args: { projectId: 'string?' } }
  return { state: { commands }, probe() {}, config: { cli: 'flovart', sandbox: 'workspace-write', approval } }
}

const allow = async () => ({ kind: 'allow' })
const applyWrite = { operations: [{ type: 'update_node', id: 'n', patch: { title: 'x' } }] }

test('registers one pre-execute gate and disposes it', async () => {
  const { ctx, listeners } = fakeCtx()
  const dispose = await registerFlovartTools(ctx as never, fakeService('untrusted') as never)
  assert.equal(listeners.filter(item => item.event === 'tools/pre-execute').length, 1)
  dispose()
  assert.equal(listeners.length, 0)
})

test('gate ignores other tools, allows reads, and asks for writes under untrusted', async () => {
  const { ctx, listeners } = fakeCtx()
  await registerFlovartTools(ctx as never, fakeService('untrusted') as never)
  const gate = listeners[0].listener

  assert.deepEqual(await gate({ name: 'some_other_tool' }, allow), { kind: 'allow' })
  assert.deepEqual(await gate({ name: 'flovart_inspect', arguments: {} }, allow), { kind: 'allow' })
  assert.equal((await gate({ name: 'flovart_apply', arguments: applyWrite }, allow) as { kind: string }).kind, 'ask')
})

test('gate denies writes when the plugin config is read-only', async () => {
  const { ctx, listeners } = fakeCtx()
  const service = { ...fakeService('never'), config: { cli: 'flovart', sandbox: 'read-only', approval: 'never' } }
  await registerFlovartTools(ctx as never, service as never)
  const decision = await listeners[0].listener({ name: 'flovart_apply', arguments: applyWrite }, allow) as { kind: string }
  assert.equal(decision.kind, 'deny')
})
