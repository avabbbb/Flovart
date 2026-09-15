// Runner layer.
//
// Every runner drives a real Flovart surface. None of them mutate Workflow
// state directly, write a second copy of the graph, or bypass the Provider gate:
//   - cli  -> tools/flovart/core.js executeFlovartCommand with the real gateway
//   - mcp  -> tools/flovart/mcp-server.js over a real in-memory MCP transport
//   - oracle -> the reference solution, expressed only as real operations
//   - nop  -> does nothing, used to prove a task's grader actually discriminates
//   - codex -> external adapter; blocked unless a real binary and credentials exist

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { executeFlovartCommand } from '../../tools/flovart/core.js';
import { createMcpServer } from '../../tools/flovart/mcp-server.js';
import { createOperationGateway } from '../../tools/flovart/operation-gateway.js';
import { createEnvironmentRunner } from './environment.mjs';

const MCP_TOOL_BY_COMMAND = {
  status: 'flovart_status',
  'workflow.inspect': 'flovart_workflow_inspect',
  'workflow.selection.get': 'flovart_workflow_selection',
  'workflow.apply': 'flovart_workflow_apply',
  'workflow.node.run': 'flovart_workflow_run',
};

/**
 * Translate a task step into the OperationGateway call. Steps are the shared
 * language between runners so the same task can be executed over CLI and MCP.
 */
function stepToGatewayCall(step) {
  return { command: step.command, args: step.args ?? {}, idempotencyKey: step.idempotencyKey };
}

/** CLI runner: goes through the real CLI command dispatcher. */
export function createCliRunner(controlled, { trajectory } = {}) {
  const gateway = createOperationGateway({ workspace: controlled.workspace });
  return {
    name: 'cli',
    async run(task) {
      for (const step of task.solution?.steps ?? []) {
        const { command, args, idempotencyKey } = stepToGatewayCall(step);
        try {
          const result = await executeFlovartCommand(
            command,
            { ...args, ...(idempotencyKey ? { idempotencyKey } : {}) },
            { operation: (cmd, cmdArgs, context) => gateway(cmd, cmdArgs, { ...context, source: 'cli' }) },
          );
          trajectory?.recordToolCall({ surface: 'cli', command, args, result: summarise(result) });
          if (result && result.ok === false && !step.allowFailure) {
            return { error: result.error ?? { code: 'CLI_FAILED' }, completedSteps: false };
          }
        } catch (error) {
          // The CLI projection rejects by throwing rather than by returning
          // ok:false, so the rejection has to be recorded here or the code that
          // distinguishes "refused for the right reason" is lost.
          const failure = { ok: false, error: { code: error.code ?? 'CLI_ERROR', message: error.message } };
          trajectory?.recordToolCall({ surface: 'cli', command, args, result: failure });
          if (!step.allowFailure) return { error: failure.error, completedSteps: false };
        }
      }
      return { completedSteps: true };
    },
  };
}

/** MCP runner: goes through the real canonical MCP projection. */
export function createMcpRunner(controlled, { trajectory } = {}) {
  const gateway = createOperationGateway({ workspace: controlled.workspace });
  return {
    name: 'mcp',
    async run(task) {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMcpServer({ gateway, source: 'mcp' });
      const client = new Client({ name: 'flovartbench', version: '0.1.0' });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      try {
        for (const step of task.solution?.steps ?? []) {
          const { command, args, idempotencyKey } = stepToGatewayCall(step);
          const toolName = MCP_TOOL_BY_COMMAND[command];
          if (!toolName) {
            trajectory?.recordToolCall({
              surface: 'mcp',
              command,
              args,
              result: { ok: false, error: { code: 'NOT_EXPOSED_OVER_MCP' } },
            });
            if (!step.allowFailure) return { error: { code: 'NOT_EXPOSED_OVER_MCP' }, completedSteps: false };
            continue;
          }
          const payload = { ...args, ...(idempotencyKey ? { idempotencyKey } : {}) };
          const response = await client.callTool({ name: toolName, arguments: payload });
          const parsed = parseMcpResult(response);
          trajectory?.recordToolCall({ surface: 'mcp', command, toolName, args, result: summarise(parsed) });
          if (parsed && parsed.ok === false && !step.allowFailure) {
            return { error: parsed.error ?? { code: 'MCP_FAILED' }, completedSteps: false };
          }
        }
        return { completedSteps: true };
      } finally {
        await client.close().catch(() => {});
        await server.close().catch(() => {});
      }
    },
  };
}

function parseMcpResult(response) {
  const text = response?.content?.find(entry => entry.type === 'text')?.text;
  if (!text) return { ok: false, error: { code: 'EMPTY_MCP_RESULT' } };
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: { code: 'UNPARSEABLE_MCP_RESULT' } };
  }
}

/** Oracle runner: the reference solution, executed over the real gateway. */
export function createOracleRunner(controlled, { trajectory } = {}) {
  const gateway = createOperationGateway({ workspace: controlled.workspace });
  return {
    name: 'oracle',
    async run(task) {
      for (const step of task.solution?.steps ?? []) {
        const { command, args, idempotencyKey } = stepToGatewayCall(step);
        try {
          const result = await gateway(command, args, {
            source: 'oracle',
            ...(idempotencyKey ? { idempotencyKey } : {}),
          });
          trajectory?.recordToolCall({ surface: 'oracle', command, args, result: summarise(result) });
          if (result && result.ok === false && !step.allowFailure) {
            return { error: result.error, completedSteps: false };
          }
        } catch (error) {
          trajectory?.recordToolCall({
            surface: 'oracle',
            command,
            args,
            result: { ok: false, error: { code: error.code ?? 'ORACLE_ERROR', message: error.message } },
          });
          if (!step.allowFailure) {
            return { error: { code: error.code ?? 'ORACLE_ERROR', message: error.message }, completedSteps: false };
          }
        }
      }
      return { completedSteps: true };
    },
  };
}

/**
 * NOP runner: performs no operations at all.
 * A state-mutating task must FAIL under this runner, otherwise its grader is
 * not actually checking anything (terminal-bench's oracle/nop discipline).
 */
export function createNopRunner() {
  return {
    name: 'nop',
    async run() {
      return { completedSteps: true, noop: true };
    },
  };
}

/**
 * Codex runner: real external agent.
 * Executed only when a real binary is present; otherwise it reports itself as
 * blocked rather than faking a result.
 */
export function createCodexRunner(controlled, { trajectory } = {}) {
  const gateway = createOperationGateway({ workspace: controlled.workspace });
  return {
    name: 'codex',
    external: true,
    async run(task) {
      const available = await isCodexAvailable();
      if (!available.ok) {
        return {
          blocked: true,
          reason: available.reason,
          completedSteps: false,
          error: { code: 'EXTERNAL_AGENT_UNAVAILABLE', message: available.reason },
        };
      }
      // A real Codex session would translate the instruction into tool calls.
      // Until that session exists the runner replays the reference solution over
      // the same gateway and marks itself as a non-certified stand-in.
      trajectory?.recordNote({ surface: 'codex', note: 'stand-in replay; not a certified Codex run', reason: available.reason });
      for (const step of task.solution?.steps ?? []) {
        const { command, args, idempotencyKey } = stepToGatewayCall(step);
        try {
          const result = await gateway(command, args, {
            source: 'codex',
            ...(idempotencyKey ? { idempotencyKey } : {}),
          });
          trajectory?.recordToolCall({ surface: 'codex', command, args, result: summarise(result) });
        } catch (error) {
          trajectory?.recordToolCall({
            surface: 'codex',
            command,
            args,
            result: { ok: false, error: { code: error.code ?? 'CODEX_ERROR' } },
          });
        }
      }
      return { completedSteps: true, standIn: true };
    },
  };
}

async function isCodexAvailable() {
  if (process.env.FLOVARTBENCH_ALLOW_CODEX !== 'true') {
    return { ok: false, reason: 'FLOVARTBENCH_ALLOW_CODEX is not set to true' };
  }
  const { spawn } = await import('node:child_process');
  return new Promise(resolve => {
    const child = spawn('codex', ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
    child.once('error', () => resolve({ ok: false, reason: 'codex binary not found on PATH' }));
    child.once('close', code => resolve(code === 0
      ? { ok: true }
      : { ok: false, reason: `codex --version exited with ${code}` }));
  });
}

/** Strip fields that are large or may carry secrets before recording. */
function summarise(result) {
  if (!result || typeof result !== 'object') return result;
  const clone = structuredCloneSafe(result);
  if (!clone) return result;
  if (clone.project) clone.project = `<project:${clone.project?.nodes?.length ?? 0} nodes>`;
  if (clone.workflow) clone.workflow = `<workflow:${clone.workflow?.nodes?.length ?? 0} nodes>`;
  return clone;
}

function structuredCloneSafe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function createRunner(name, controlled, options) {
  switch (name) {
    case 'cli': return createCliRunner(controlled, options);
    case 'mcp': return createMcpRunner(controlled, options);
    case 'oracle': return createOracleRunner(controlled, options);
    case 'nop': return createNopRunner(controlled, options);
    case 'codex': return createCodexRunner(controlled, options);
    case 'environment': return createEnvironmentRunner(controlled, options);
    default: throw new Error(`Unknown runner: ${name}`);
  }
}

export const RUNNER_NAMES = ['oracle', 'cli', 'mcp', 'codex', 'nop', 'environment'];
