import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideFlovartToolCall, flovartToolRisk } from '../src/policy.ts'
import { normalizeConfig } from '../src/config.ts'

test('classifies Flovart tools and escalates apply-with-delete to delete', () => {
  assert.equal(flovartToolRisk('flovart_inspect', {}), 'read')
  assert.equal(flovartToolRisk('flovart_run', {}), 'run')
  assert.equal(flovartToolRisk('flovart_apply', { operations: [{ type: 'update_node', id: 'n', patch: { title: 'x' } }] }), 'write')
  assert.equal(flovartToolRisk('flovart_apply', { operations: [{ type: 'delete_nodes', ids: ['n'] }] }), 'delete')
  assert.equal(flovartToolRisk('other_tool', {}), null)
})

test('read-only sandbox denies writes and runs but keeps reads', () => {
  const readOnly = { sandbox: 'read-only', approval: 'never' } as const
  assert.equal(decideFlovartToolCall({ name: 'flovart_inspect', args: {}, policy: readOnly }).kind, 'allow')
  assert.equal(decideFlovartToolCall({ name: 'flovart_apply', args: {}, policy: readOnly }).kind, 'deny')
  assert.equal(decideFlovartToolCall({ name: 'flovart_run', args: {}, policy: readOnly }).kind, 'deny')
})

test('approval decides writes, paid runs, and deletes', () => {
  const write = { operations: [{ type: 'update_node', id: 'n', patch: { title: 'x' } }] }
  assert.equal(decideFlovartToolCall({ name: 'flovart_apply', args: write, policy: { sandbox: 'workspace-write', approval: 'on-request' } }).kind, 'allow')
  assert.equal(decideFlovartToolCall({ name: 'flovart_apply', args: write, policy: { sandbox: 'workspace-write', approval: 'untrusted' } }).kind, 'ask')
  // delete/run are confirmed by the Flovart command surface, not here (no double prompt).
  assert.equal(decideFlovartToolCall({ name: 'flovart_run', args: {}, policy: { sandbox: 'workspace-write', approval: 'on-request' } }).kind, 'allow')
  assert.equal(decideFlovartToolCall({ name: 'flovart_apply', args: { operations: [{ type: 'delete_nodes', ids: ['n'] }] }, policy: { sandbox: 'workspace-write', approval: 'on-request' } }).kind, 'allow')
  assert.equal(decideFlovartToolCall({ name: 'flovart_run', args: {}, policy: { sandbox: 'workspace-write', approval: 'untrusted' } }).kind, 'allow')
  assert.equal(decideFlovartToolCall({ name: 'flovart_run', args: {}, policy: { sandbox: 'workspace-write', approval: 'never' } }).kind, 'allow')
})

test('partial or invalid config falls back to workspace-write + on-request', () => {
  assert.deepEqual(normalizeConfig({ sandbox: 'read-only', approval: 'untrusted' }), expectConfig('read-only', 'untrusted'))
  assert.deepEqual(normalizeConfig({ sandbox: 'bogus' as never, approval: 'on-failure' as never }), expectConfig('workspace-write', 'on-request'))
  assert.equal(decideFlovartToolCall({ name: 'flovart_apply', args: {}, policy: {} as never }).kind, 'allow')
})

function expectConfig(sandbox: string, approval: string) {
  return {
    workspaceUrl: 'http://127.0.0.1:17372',
    workspaceToken: '',
    cli: 'flovart',
    toolTimeoutMs: 30000,
    workspaceMode: 'browser',
    sandbox,
    approval,
  }
}
