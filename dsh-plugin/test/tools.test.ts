import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerFlovartTools, STABLE_TOOL_COMMANDS } from '../src/tools.ts'

type Registered = { name: string }

function fakeCtx() {
  const live: Registered[] = []
  let calls = 0
  const ctx = {
    tools: {
      register(definition: Registered) {
        calls += 1
        const entry = { name: definition.name }
        live.push(entry)
        return () => {
          const i = live.indexOf(entry)
          if (i >= 0) live.splice(i, 1)
        }
      },
    },
  }
  return { ctx, live, calls: () => calls }
}

function fakeService(commands: readonly string[]) {
  const meta: Record<string, { summary: string, args: Record<string, string> }> = {}
  for (const command of commands) meta[command] = { summary: command + ' summary', args: { projectId: 'string?' } }
  let probes = 0
  return {
    service: { state: { commands: meta }, probe() { probes += 1 }, config: { cli: 'flovart' } },
    probes: () => probes,
  }
}

test('registers each stable tool exactly once and reload does not double register', async () => {
  const { ctx, live, calls } = fakeCtx()
  const { service, probes } = fakeService(STABLE_TOOL_COMMANDS)
  const dispose = await registerFlovartTools(ctx as never, service as never)
  const names = live.map(entry => entry.name)
  assert.equal(names.length, 6)
  assert.equal(new Set(names).size, 6)
  assert.ok(names.every(name => name.startsWith('flovart_')), names.join(','))
  assert.equal(probes(), 0, 'commands already probed: no second probe')
  dispose()
  assert.equal(live.length, 0, 'dispose removes every registration')
  const disposeAgain = await registerFlovartTools(ctx as never, service as never)
  assert.equal(live.length, 6, 'plugin reload registers 6, not 12')
  assert.equal(calls(), 12)
  disposeAgain()
  disposeAgain()
  assert.equal(live.length, 0, 'double dispose is harmless')
})

test('a stable command missing from the live CLI registry is not registered', async () => {
  const { ctx, live } = fakeCtx()
  const { service } = fakeService(STABLE_TOOL_COMMANDS.filter(command => command !== 'workflow.node.run'))
  const dispose = await registerFlovartTools(ctx as never, service as never)
  assert.equal(live.length, 5)
  assert.ok(!live.some(entry => entry.name === 'flovart_node_run' || entry.name.includes('run')), live.map(e => e.name).join(','))
  dispose()
})
