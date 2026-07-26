// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { getFlovartMcpTools } from '../agent/mcp.js';

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
});
