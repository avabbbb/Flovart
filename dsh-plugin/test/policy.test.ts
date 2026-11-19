import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideIrisToolCall, irisToolRisk } from '../src/policy.ts'
import { normalizeConfig } from '../src/config.ts'

test('classifies Iris tools and escalates apply-with-delete to delete', () => {
  assert.equal(irisToolRisk('iris_inspect', {}), 'read')
  assert.equal(irisToolRisk('iris_run', {}), 'run')
  assert.equal(irisToolRisk('iris_agent_turn', {}), 'read')
  assert.equal(irisToolRisk('iris_agent_turn', { policy: 'workspace-write' }), 'write')
  assert.equal(irisToolRisk('iris_apply', { operations: [{ type: 'update_node', id: 'n', patch: { title: 'x' } }] }), 'write')
  assert.equal(irisToolRisk('iris_apply', { operations: [{ type: 'delete_nodes', ids: ['n'] }] }), 'delete')
  assert.equal(irisToolRisk('other_tool', {}), null)
})

test('read-only sandbox denies writes and runs but keeps reads', () => {
  const readOnly = { sandbox: 'read-only', approval: 'never' } as const
  assert.equal(decideIrisToolCall({ name: 'iris_inspect', args: {}, policy: readOnly }).kind, 'allow')
  assert.equal(decideIrisToolCall({ name: 'iris_apply', args: {}, policy: readOnly }).kind, 'deny')
  assert.equal(decideIrisToolCall({ name: 'iris_run', args: {}, policy: readOnly }).kind, 'deny')
  // stop / cancel change run state: never read-only.
  assert.equal(irisToolRisk('iris_workflow_node_stop', {}), 'write')
  assert.equal(irisToolRisk('iris_task_cancel', {}), 'write')
  assert.equal(decideIrisToolCall({ name: 'iris_workflow_node_stop', args: {}, policy: readOnly }).kind, 'deny')
  assert.equal(decideIrisToolCall({ name: 'iris_task_cancel', args: {}, policy: readOnly }).kind, 'deny')
  assert.equal(decideIrisToolCall({ name: 'iris_task_get', args: {}, policy: readOnly }).kind, 'allow')
})

test('approval decides writes, paid runs, and deletes', () => {
  const write = { operations: [{ type: 'update_node', id: 'n', patch: { title: 'x' } }] }
  assert.equal(decideIrisToolCall({ name: 'iris_apply', args: write, policy: { sandbox: 'workspace-write', approval: 'on-request' } }).kind, 'allow')
  assert.equal(decideIrisToolCall({ name: 'iris_apply', args: write, policy: { sandbox: 'workspace-write', approval: 'untrusted' } }).kind, 'ask')
  // delete/run are confirmed by the Iris command surface, not here (no double prompt).
  assert.equal(decideIrisToolCall({ name: 'iris_run', args: {}, policy: { sandbox: 'workspace-write', approval: 'on-request' } }).kind, 'allow')
  assert.equal(decideIrisToolCall({ name: 'iris_apply', args: { operations: [{ type: 'delete_nodes', ids: ['n'] }] }, policy: { sandbox: 'workspace-write', approval: 'on-request' } }).kind, 'allow')
  assert.equal(decideIrisToolCall({ name: 'iris_run', args: {}, policy: { sandbox: 'workspace-write', approval: 'untrusted' } }).kind, 'allow')
  assert.equal(decideIrisToolCall({ name: 'iris_run', args: {}, policy: { sandbox: 'workspace-write', approval: 'never' } }).kind, 'allow')
})

test('partial or invalid config falls back to workspace-write + on-request', () => {
  assert.deepEqual(normalizeConfig({ sandbox: 'read-only', approval: 'untrusted' }), expectConfig('read-only', 'untrusted'))
  assert.deepEqual(normalizeConfig({ sandbox: 'bogus' as never, approval: 'on-failure' as never }), expectConfig('workspace-write', 'on-request'))
  assert.equal(decideIrisToolCall({ name: 'iris_apply', args: {}, policy: {} as never }).kind, 'allow')
})

function expectConfig(sandbox: string, approval: string) {
  return {
    workspaceUrl: 'http://127.0.0.1:17372',
    workspaceToken: '',
    cli: 'iris',
    toolTimeoutMs: 30000,
    workspaceMode: 'browser',
    sandbox,
    approval,
  }
}
