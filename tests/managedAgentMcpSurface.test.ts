// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createFlovartAgentTools, getFlovartAgentTools } from '../agent/tools.js';

describe('Flovart Agent tool surface', () => {
  it('exposes only the stable inspect/apply/run Workflow contract', () => {
    const commands = getFlovartAgentTools().map(tool => tool.command);

    expect(commands).toEqual([
      'status',
      'agent.turn',
      'workflow.inspect',
      'workflow.selection.get',
      'workflow.apply',
      'workflow.node.run',
    ]);
    expect(commands).not.toContain('command.list');
    expect(commands).not.toContain('command.schema');
    expect(commands).not.toContain('workflow.node.create');
    expect(commands).not.toContain('workflow.node.update');
    expect(commands).not.toContain('production.run');
    expect(commands.some(command => /^(?:canvas|element)\./.test(command))).toBe(false);
  });

  it('gives the built-in Flovart Agent typed tools for that same small surface', () => {
    const tools = createFlovartAgentTools(async () => ({ ok: true }));
    const names = tools.map(tool => tool.name);
    const apply = tools.find(tool => tool.name === 'flovart_workflow_apply');
    const status = tools.find(tool => tool.name === 'flovart_status');

    expect(names).toContain('flovart_status');
    expect(names).toContain('flovart_workflow_inspect');
    expect(names).toContain('flovart_workflow_selection_get');
    expect(names).toContain('flovart_workflow_node_run');
    expect(names).toContain('flovart_workflow_apply');
    expect(names).not.toContain('flovart_workflow_node_create');
    expect(names).not.toContain('flovart_production_run');
    expect(apply?.parameters.required).toContain('idempotencyKey');
    expect(tools.find(tool => tool.name === 'flovart_workflow_node_run')?.parameters.required).toContain('idempotencyKey');
    expect(status?.parameters.required || []).not.toContain('idempotencyKey');
  });

  it('moves idempotencyKey to the command envelope instead of leaking it into Runtime args', async () => {
    let call: unknown[] = [];
    const tools = createFlovartAgentTools(async (...args) => {
      call = args;
      return { ok: true };
    });
    const run = tools.find(tool => tool.name === 'flovart_workflow_apply');

    await run?.execute('tool-call', {
      projectId: 'project-1',
      expectedRevision: 1,
      mutationId: 'mutation-1',
      operations: [{ type: 'add_node', node: { id: 'node-1', type: 'text', title: '提纲' } }],
      idempotencyKey: 'apply-once',
      changeSetId: 'turn-change-set',
    }, undefined);

    expect(call[0]).toBe('workflow.apply');
    expect(call[1]).toMatchObject({ projectId: 'project-1', mutationId: 'mutation-1' });
    expect(call[1]).not.toHaveProperty('idempotencyKey');
    expect(call[3]).toBe('apply-once');
  });

  it('pins Agent Workflow commands to the Browser workspace', async () => {
    let call: unknown[] = [];
    const tools = createFlovartAgentTools(async (...args) => {
      call = args;
      return { ok: true };
    });
    const inspect = tools.find(tool => tool.name === 'flovart_workflow_inspect');

    await inspect?.execute('tool-call', {}, undefined);

    expect(call[0]).toBe('workflow.inspect');
    expect(call[1]).toMatchObject({ workspaceMode: 'browser' });
    expect(call[2]).toBe('agent');
  });
});
