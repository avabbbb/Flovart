import { describe, expect, it, vi } from 'vitest';
import { COMMAND_ALIASES, COMMAND_REGISTRY, executeFlovartCommand, normalizeCommandName } from '../tools/flovart/core.js';
import { createRuntimeFacade } from '../tools/flovart/runtime-client.js';
import { createShadowRuntimeFacade } from '../tools/flovart/shadow-runtime.js';

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
    expect(COMMAND_REGISTRY['workflow.node.create']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.run']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.stop']).toBeTruthy();
    expect(COMMAND_REGISTRY['workflow.node.create-connected']).toBeTruthy();
    expect(COMMAND_ALIASES.flovart_workflow_node_create).toBe('workflow.node.create');
    expect(normalizeCommandName('flovart_workflow_node_create')).toBe('workflow.node.create');
    expect(normalizeCommandName('flovart_workflow_node_stop')).toBe('workflow.node.stop');
  });

  it('routes aliases through the canonical browser dispatcher', async () => {
    const dispatch = vi.fn().mockResolvedValue({ ok: true, commandId: 'cli', result: { nodeId: 'node-1' } });
    await executeFlovartCommand('flovart_workflow_node_create', { type: 'config' }, { workflow: { dispatch } });
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ command: 'workflow.node.create', source: 'cli', args: expect.objectContaining({ type: 'config' }) }));
  });
});
