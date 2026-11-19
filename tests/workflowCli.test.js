import { describe, expect, it, vi } from 'vitest';
import { COMMAND_ALIASES, COMMAND_REGISTRY, executeIrisCommand, normalizeCommandName } from '../tools/iris/core.js';
import { createRuntimeFacade } from '../tools/iris/runtime-client.js';
import { createShadowRuntimeFacade } from '../tools/iris/shadow-runtime.js';

describe('workflow CLI metadata', () => {
  it('exposes Workflow without legacy Canvas or element contracts', () => {
    const commands = Object.keys(COMMAND_REGISTRY);
    const aliasTargets = Object.values(COMMAND_ALIASES);
    const client = { execute: vi.fn() };

    expect(commands.some(command => /^(?:canvas|element)\./.test(command))).toBe(false);
    expect(aliasTargets.some(command => /^(?:canvas|element)\./.test(command))).toBe(false);
    expect(createRuntimeFacade(client)).not.toHaveProperty('canvas');
    expect(createRuntimeFacade(client)).not.toHaveProperty('element');
    expect(createShadowRuntimeFacade()).not.toHaveProperty('canvas');
    expect(createShadowRuntimeFacade()).not.toHaveProperty('element');
  });

  it('publishes canonical workflow commands and MCP-safe aliases', () => {
    expect(COMMAND_REGISTRY['workflow.apply']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.selection.get']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.create']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.run']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.stop']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.create-connected']).toBeTruthy();
    expect(COMMAND_ALIASES.iris_workflow_node_create).toBe('workflow.node.create');
    expect(COMMAND_ALIASES.iris_workflow_apply).toBe('workflow.apply');
    expect(COMMAND_ALIASES.iris_workflow_selection_get).toBe('workflow.selection.get');
    expect(normalizeCommandName('iris_workflow_node_create')).toBe('workflow.node.create');
    expect(normalizeCommandName('iris_workflow_node_stop')).toBe('workflow.node.stop');
  });

  it('routes aliases through the canonical browser dispatcher', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, commandId: 'cli', result: { nodeId: 'node-1' } });
    await executeIrisCommand('iris_workflow_node_create', { type: 'config' }, { workflow: { dispatch } });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ command: 'workflow.node.create', source: 'cli', args: expect.objectContaining({ type: 'config' }) }));
  });

  it('parses comma-separated --node-ids the same way for node.run and focus.nodes', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true });
    await executeIrisCommand('workflow.focus.nodes', { 'project-id': 'p1', 'node-ids': 'a, b,a' }, { workflow: { dispatch } });
    await executeIrisCommand('workflow.node.run', { 'project-id': 'p1', 'node-ids': 'a,b' }, { workflow: { dispatch } });
    await executeIrisCommand('workflow.focus.nodes', { 'project-id': 'p1', 'node-ids': '["a","b"]' }, { workflow: { dispatch } });
    expect(dispatch.mock.calls[0][0].args.nodeIds).toEqual(['a', 'b', 'a']);
    expect(dispatch.mock.calls[1][0].args.nodeIds).toEqual(['a', 'b']);
    expect(dispatch.mock.calls[2][0].args.nodeIds).toEqual(['a', 'b']);
  });

  it('normalizes typed arguments for the granular workflow node tool adapter', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true });
    await executeIrisCommand('workflow.node.tool', {
      'project-id': 'project-1',
      'node-id': 'image-1',
      tool: 'crop',
      x: '0.1',
      y: '0.2',
      width: '0.5',
      height: '0.4',
      'idempotency-key': 'crop-image-1',
    }, { workflow: { dispatch } });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      command: 'workflow.node.tool',
      args: expect.objectContaining({
        projectId: 'project-1',
        nodeId: 'image-1',
        x: 0.1,
        y: 0.2,
        width: 0.5,
        height: 0.4,
      }),
    }));
  });
});
