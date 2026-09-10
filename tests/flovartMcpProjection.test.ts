// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { AGENT_PUBLIC_COMMANDS } from '../tools/flovart/agent-surface.js';
import { AGENT_OPERATION_DEFINITIONS } from '../tools/flovart/agent-surface.js';
import { createMcpServer } from '../tools/flovart/mcp-server.js';
import { createOperationGateway } from '../tools/flovart/operation-gateway.js';

async function connectProjection(gateway: (command: string, args: Record<string, unknown>, context: Record<string, unknown>) => Promise<unknown>) {
  const server = createMcpServer({ gateway, includeResources: true });
  const client = new Client({ name: 'flovart-projection-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

describe('Flovart MCP projection', () => {
  it('keeps operation metadata transport-neutral and complete for every stable command', () => {
    for (const command of AGENT_PUBLIC_COMMANDS) {
      expect(AGENT_OPERATION_DEFINITIONS[command]).toMatchObject({
        sideEffects: expect.any(String),
        risk: expect.any(String),
        permissions: expect.any(Array),
        idempotent: expect.any(Boolean),
        mutation: expect.any(Boolean),
        requiredCapabilities: expect.any(Array),
      });
    }
  });

  it('exposes exactly the stable Agent surface and no compatibility registry', async () => {
    const { client } = await connectProjection(async () => ({ ok: true }));
    const result = await client.listTools();

    expect(result.tools.map(tool => tool.name)).toEqual([
      'flovart_status',
      'flovart_workflow_inspect',
      'flovart_workflow_selection',
      'flovart_workflow_apply',
      'flovart_workflow_run',
    ]);
    expect(result.tools).toHaveLength(AGENT_PUBLIC_COMMANDS.length);
    expect(result.tools.map(tool => tool.name).join(' ')).not.toMatch(/command\.list|command\.schema|node\.create/);
  });

  it('projects typed workflow input without leaking transport context into operation args', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown>; context: Record<string, unknown> }> = [];
    const { client } = await connectProjection(async (command, args, context) => {
      calls.push({ command, args, context });
      return { ok: true, revision: 8, token: 'should-not-cross-the-boundary' };
    });

    const result = await client.callTool({
      name: 'flovart_workflow_apply',
      arguments: {
        projectId: 'project-1',
        expectedRevision: 7,
        mutationId: 'mutation-1',
        operations: [{ op: 'add', path: '/nodes/-', value: { id: 'node-1' } }],
        idempotencyKey: 'idem-1',
        agentIdentity: 'teleagent',
        hostSessionId: 'tele-session-1',
      },
    });

    expect(calls).toEqual([{
      command: 'workflow.apply',
      args: expect.objectContaining({
        projectId: 'project-1',
        expectedRevision: 7,
        mutationId: 'mutation-1',
        operations: [{ op: 'add', path: '/nodes/-', value: { id: 'node-1' } }],
      }),
      context: {
        source: 'mcp',
        idempotencyKey: 'idem-1',
        caller: { agentIdentity: 'teleagent', hostSessionId: 'tele-session-1' },
      },
    }]);
    expect(calls[0].args).not.toHaveProperty('idempotencyKey');
    expect(calls[0].args).not.toHaveProperty('agentIdentity');
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ ok: true, revision: 8, token: '[REDACTED]' });
    expect(result.content[0].text).not.toContain('should-not-cross-the-boundary');
  });

  it('keeps Browser Workflow authority at the canonical gateway boundary', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown>; source: string; options: Record<string, unknown> }> = [];
    const execute = createOperationGateway({
      workspace: {
        execute: async (command: string, args: Record<string, unknown>, source: string, options: Record<string, unknown>) => {
          calls.push({ command, args, source, options });
          return { ok: true };
        },
      },
      status: async () => ({ ready: true }),
    });

    await execute('workflow.inspect', { projectId: 'project-1' }, {
      source: 'mcp',
      caller: { agentIdentity: 'teleagent', hostSessionId: 'session-1' },
    });

    expect(calls).toEqual([{
      command: 'workflow.inspect',
      args: { projectId: 'project-1', workspaceMode: 'browser' },
      source: 'mcp',
      options: { caller: { agentIdentity: 'teleagent', hostSessionId: 'session-1' } },
    }]);
  });

  it('requires idempotency for writes and preserves structured error codes', async () => {
    const gateway = createOperationGateway({
      workspace: { execute: async () => ({ ok: true }) },
      status: async () => ({ ready: true }),
    });
    const { client } = await connectProjection(gateway);
    const result = await client.callTool({
      name: 'flovart_workflow_apply',
      arguments: {
        projectId: 'project-1',
        expectedRevision: 1,
        mutationId: 'mutation-1',
        operations: [],
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
    });
  });

  it('maps Workspace failures to MCP errors without exposing credentials', async () => {
    const { client } = await connectProjection(async () => {
      const error = new Error('Workspace unavailable') as Error & { code: string; toJSON: () => unknown };
      error.code = 'WORKSPACE_UNAVAILABLE';
      error.toJSON = () => ({ code: error.code, message: error.message, retryable: true, details: { token: 'private' } });
      throw error;
    });

    const result = await client.callTool({ name: 'flovart_workflow_inspect', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'WORKSPACE_UNAVAILABLE', details: { token: '[REDACTED]' } },
    });
    expect(result.content[0].text).not.toContain('private');
  });

  it('offers read-only current workspace and workflow resources', async () => {
    const calls: string[] = [];
    const { client } = await connectProjection(async command => {
      calls.push(command);
      return command === 'status'
        ? { ready: true, agentToken: 'private' }
        : { ok: true, workflow: { revision: 3 } };
    });

    const resources = await client.listResources();
    expect(resources.resources.map(resource => resource.uri)).toEqual([
      'flovart://workspace/current',
      'flovart://workflow/current',
    ]);
    const current = await client.readResource({ uri: 'flovart://workflow/current' });
    expect(calls).toContain('workflow.inspect');
    expect(JSON.stringify(current)).not.toContain('private');
  });
});
