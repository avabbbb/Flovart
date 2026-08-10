// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createFlovartAgentTools, getFlovartMcpTools } from '../agent/mcp.js';

describe('Managed Agent MCP Workspace surface', () => {
  it('exposes visible Workflow commands plus the bounded Production Runtime loop', () => {
    const commands = getFlovartMcpTools().map(tool => tool.command);

    expect(commands).toContain('workflow.inspect');
    expect(commands).toContain('workflow.node.create');
    expect(commands).toContain('workflow.node.update');
    expect(commands).toContain('production.dry-run');
    expect(commands).toContain('production.status');
    expect(commands).toContain('production.approve');
    expect(commands).toContain('production.run');
    expect(commands).toContain('workflow.projection.get');
    expect(commands).not.toContain('generate.video');
    expect(commands).not.toContain('workflow.node.run');
    expect(commands.some(command => /^(?:canvas|element)\./.test(command))).toBe(false);
  });

  it('gives the built-in Flovart Agent the same bounded visible-Workflow surface', () => {
    const tools = createFlovartAgentTools(async () => ({ ok: true }));
    const names = tools.map(tool => tool.name);
    const create = tools.find(tool => tool.name === 'flovart_workflow_node_create');
    const dryRun = tools.find(tool => tool.name === 'flovart_production_dry_run');
    const status = tools.find(tool => tool.name === 'flovart_production_status');

    expect(names).toContain('flovart_workflow_inspect');
    expect(names).toContain('flovart_production_run');
    expect(names).not.toContain('flovart_generate_video');
    expect(create?.parameters.required).toContain('idempotencyKey');
    expect(dryRun?.parameters.required).toContain('idempotencyKey');
    expect(status?.parameters.required || []).not.toContain('idempotencyKey');
  });

  it('moves idempotencyKey to the command envelope instead of leaking it into Runtime args', async () => {
    let call: any;
    const tools = createFlovartAgentTools(async (...args) => {
      call = args;
      return { ok: true };
    });
    const run = tools.find(tool => tool.name === 'flovart_production_run');

    await run?.execute('tool-call', { runId: 'run-1', idempotencyKey: 'run-once', changeSetId: 'turn-change-set' }, undefined);

    expect(call[0]).toBe('production.run');
    expect(call[1]).toEqual({ runId: 'run-1' });
    expect(call[3]).toBe('run-once');
  });
});
