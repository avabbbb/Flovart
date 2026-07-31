// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createFlovartAgentTools, getFlovartMcpTools } from '../agent/mcp.js';

describe('Managed Agent MCP Workspace surface', () => {
  it('exposes only available visible Workflow commands', () => {
    const commands = getFlovartMcpTools().map(tool => tool.command);

    expect(commands).toContain('workflow.inspect');
    expect(commands).toContain('workflow.node.create');
    expect(commands).toContain('workflow.node.update');
    expect(commands).not.toContain('generate.video');
    expect(commands).not.toContain('workflow.projection.get');
    expect(commands).not.toContain('workflow.node.run');
    expect(commands.some(command => /^(?:canvas|element)\./.test(command))).toBe(false);
  });

  it('gives the built-in Flovart Agent the same bounded visible-Workflow surface', () => {
    const tools = createFlovartAgentTools(async () => ({ ok: true }));
    const names = tools.map(tool => tool.name);
    const create = tools.find(tool => tool.name === 'flovart_workflow_node_create');

    expect(names).toContain('flovart_workflow_inspect');
    expect(names).not.toContain('flovart_generate_video');
    expect(create?.parameters.required).toContain('idempotencyKey');
  });
});
