// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { executeFlovartCommand } from '../tools/flovart/core.js';
import { createMcpServer } from '../tools/flovart/mcp-server.js';
import { createOperationGateway } from '../tools/flovart/operation-gateway.js';

type Call = {
  command: string;
  args: Record<string, unknown>;
  source: string;
  options: Record<string, unknown>;
};

type WorkflowState = {
  projectId: string;
  revision: number;
  nodes: Array<{ id: string; type: string }>;
};

const MCP_NAMES: Record<string, string> = {
  'workflow.inspect': 'flovart_workflow_inspect',
  'workflow.selection.get': 'flovart_workflow_selection',
  'workflow.apply': 'flovart_workflow_apply',
  'workflow.node.run': 'flovart_workflow_run',
};

function stateHash(state: WorkflowState) {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

function createStatefulWorkspace(initial: WorkflowState, calls: Call[]) {
  const state = structuredClone(initial);
  return {
    state,
    workspace: {
      execute: async (
        command: string,
        args: Record<string, unknown>,
        source: string,
        options: Record<string, unknown>,
      ) => {
        calls.push({ command, args, source, options });
        if (args.projectId && args.projectId !== state.projectId) {
          throw new Error('wrong project');
        }
        if (command === 'workflow.apply') {
          const operations = Array.isArray(args.operations) ? args.operations : [];
          for (const operation of operations) {
            const value = operation && typeof operation === 'object' && 'value' in operation
              ? operation.value
              : null;
            if (operation && typeof operation === 'object' && operation.op === 'add' && value && typeof value === 'object') {
              state.nodes.push({
                id: String(value.id),
                type: String(value.type || 'image'),
              });
            }
          }
          state.revision += 1;
        }
        return {
          ok: true,
          workflow: structuredClone(state),
          revision: state.revision,
          command,
        };
      },
    },
  };
}

function createGateway(calls: Call[], initial: WorkflowState) {
  const fixture = createStatefulWorkspace(initial, calls);
  return {
    fixture,
    gateway: createOperationGateway({
      workspace: fixture.workspace,
      status: async () => ({ ready: true, authority: 'browser-workspace' }),
    }),
  };
}

async function callMcp(gateway: ReturnType<typeof createOperationGateway>, name: string, args: Record<string, unknown>) {
  const server = createMcpServer({ gateway, includeResources: false });
  const client = new Client({ name: 'flovart-projection-parity', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client.callTool({ name, arguments: args });
}

describe('Flovart CLI/MCP projection parity', () => {
  it('forwards the same canonical Workflow arguments and Browser authority', async () => {
    const cases = [
      {
        command: 'workflow.inspect',
        args: { projectId: 'project-1', agentIdentity: 'codex', hostSessionId: 'session-1' },
        mcpArgs: { projectId: 'project-1', agentIdentity: 'codex', hostSessionId: 'session-1' },
      },
      {
        command: 'workflow.selection.get',
        args: { projectId: 'project-1', agentIdentity: 'teleagent', hostSessionId: 'session-2' },
        mcpArgs: { projectId: 'project-1', agentIdentity: 'teleagent', hostSessionId: 'session-2' },
      },
      {
        command: 'workflow.apply',
        args: {
          projectId: 'project-1',
          expectedRevision: 0,
          mutationId: 'mutation-1',
          operations: [{ op: 'add', path: '/nodes/-', value: { id: 'node-1', type: 'image' } }],
          idempotencyKey: 'idem-1',
          agentIdentity: 'codex',
          hostSessionId: 'session-1',
        },
        mcpArgs: {
          projectId: 'project-1',
          expectedRevision: 0,
          mutationId: 'mutation-1',
          operations: [{ op: 'add', path: '/nodes/-', value: { id: 'node-1', type: 'image' } }],
          idempotencyKey: 'idem-1',
          agentIdentity: 'codex',
          hostSessionId: 'session-1',
        },
      },
      {
        command: 'workflow.node.run',
        args: { projectId: 'project-1', nodeId: 'node-1', expectedRevision: 1, idempotencyKey: 'run-idempotency', agentIdentity: 'codex' },
        mcpArgs: { projectId: 'project-1', nodeId: 'node-1', expectedRevision: 1, idempotencyKey: 'run-idempotency', agentIdentity: 'codex' },
      },
    ];

    for (const testCase of cases) {
      const initial = { projectId: 'project-1', revision: 0, nodes: [] };
      const cliCalls: Call[] = [];
      const mcpCalls: Call[] = [];
      const { gateway: cliGateway } = createGateway(cliCalls, initial);
      const { gateway: mcpGateway } = createGateway(mcpCalls, initial);

      const cliResult = await executeFlovartCommand(testCase.command, testCase.args, {
        operation: cliGateway,
        source: 'cli',
        workflow: { dispatch: async () => ({ ok: false, error: { code: 'TEST_UNEXPECTED_DISPATCH' } }) },
      });
      const mcpResult = await callMcp(mcpGateway, MCP_NAMES[testCase.command], testCase.mcpArgs);

      expect(mcpResult.isError).not.toBe(true);
      expect(mcpResult.structuredContent).toEqual(cliResult);
      expect(mcpCalls).toHaveLength(1);
      expect(cliCalls).toHaveLength(1);
      expect(mcpCalls[0].command).toBe(cliCalls[0].command);
      expect(mcpCalls[0].args).toEqual(cliCalls[0].args);
      expect(mcpCalls[0].args.workspaceMode).toBe('browser');
      expect(mcpCalls[0].args).not.toHaveProperty('idempotencyKey');
      expect(mcpCalls[0].args).not.toHaveProperty('agentIdentity');
      expect(mcpCalls[0].options).toEqual(cliCalls[0].options);
      expect(mcpCalls[0].source).toBe('mcp');
      expect(cliCalls[0].source).toBe('cli');
    }
  });

  it('produces the same final Workflow state hash for CLI and MCP mutation projections', async () => {
    const initial = { projectId: 'project-1', revision: 0, nodes: [] };
    const mutation = {
      projectId: 'project-1',
      expectedRevision: 0,
      mutationId: 'mutation-parity',
      operations: [{ op: 'add', path: '/nodes/-', value: { id: 'parity-node', type: 'video' } }],
      idempotencyKey: 'parity-idempotency',
      agentIdentity: 'codex',
      hostSessionId: 'parity-session',
    };
    const cliCalls: Call[] = [];
    const mcpCalls: Call[] = [];
    const cliFixture = createGateway(cliCalls, initial).fixture;
    const mcpFixture = createGateway(mcpCalls, initial).fixture;
    const cliGateway = createOperationGateway({ workspace: cliFixture.workspace });
    const mcpGateway = createOperationGateway({ workspace: mcpFixture.workspace });

    await executeFlovartCommand('workflow.apply', mutation, {
      operation: cliGateway,
      source: 'cli',
      workflow: { dispatch: async () => ({ ok: false, error: { code: 'TEST_UNEXPECTED_DISPATCH' } }) },
    });
    const mcpResult = await callMcp(mcpGateway, MCP_NAMES['workflow.apply'], mutation);

    expect(mcpResult.isError).not.toBe(true);
    expect(stateHash(cliFixture.state)).toBe(stateHash(mcpFixture.state));
    expect(stateHash(cliFixture.state)).toBe(stateHash({
      projectId: 'project-1',
      revision: 1,
      nodes: [{ id: 'parity-node', type: 'video' }],
    }));
  });
});
