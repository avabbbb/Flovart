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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { executeFlovartCommand } from '../../tools/flovart/core.js';
import { createMcpServer } from '../../tools/flovart/mcp-server.js';
import { createOperationGateway } from '../../tools/flovart/operation-gateway.js';
import { createEnvironmentRunner } from './environment.mjs';
import { createRealProviderRunner } from './real-provider.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
 * Spawned only when FLOVARTBENCH_ALLOW_CODEX=true and a `codex` binary is on
 * PATH; otherwise it reports itself as blocked rather than faking a result.
 *
 * The agent receives task.instruction and a real shell; it drives the live
 * Workflow through `npm run flovart:cli -- …` exactly as the manual Golden
 * Task trials did. After the process exits the runner parses the `codex exec`
 * JSONL transcript, extracts every `flovart:cli` write the agent issued, and
 * replays those writes through the same OperationGateway into the controlled
 * world being graded - so outcome predicates judge what the agent actually
 * did, not what it claimed.
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
      const { transcript, exitCode, error: spawnError } = await runCodexExec(task, controlled);
      if (spawnError) {
        trajectory?.recordNote({ surface: 'codex', note: 'spawn failed', reason: spawnError });
        return {
          blocked: true,
          reason: spawnError,
          completedSteps: false,
          error: { code: 'EXTERNAL_AGENT_UNAVAILABLE', message: spawnError },
        };
      }
      const parsed = parseCodexJsonl(transcript);
      for (const call of parsed.toolCalls) {
        trajectory?.recordToolCall({
          surface: 'codex',
          command: call.command,
          args: call.args,
          result: call.result,
        });
      }
      if (exitCode !== 0) {
        return {
          completedSteps: false,
          error: { code: 'CODEX_EXIT_NONZERO', message: `codex exec exited ${exitCode}` },
          usage: parsed.usage,
        };
      }
      const replay = await replayCodexWrites(parsed.writes, gateway, trajectory);
      return {
        completedSteps: true,
        ...(replay.error ? { error: replay.error } : {}),
        usage: parsed.usage,
        certified: true,
      };
    },
  };
}

/**
 * Translate one recorded `flovart:cli` write into the gateway call that
 * produces the same final world. The granular CLI commands the agent used are
 * folded into `workflow.apply` operations so the controlled world sees the
 * same document mutation the live workspace applied.
 */
function codexWriteToGatewayCall(write) {
  const { command, args } = write;
  if (command === 'workflow.apply') {
    return { command: 'workflow.apply', args };
  }
  if (command === 'workflow.node.create') {
    return {
      command: 'workflow.apply',
      args: {
        projectId: args.projectId,
        operations: [{
          type: 'add_node',
          node: {
            id: args.id ?? args.nodeId,
            type: args.type,
            title: args.title,
            position: { x: Number(args.x ?? 0), y: Number(args.y ?? 0) },
            ...(args.metadata ? { metadata: args.metadata } : {}),
          },
        }],
      },
    };
  }
  if (command === 'workflow.node.create-connected') {
    return {
      command: 'workflow.apply',
      args: {
        projectId: args.projectId,
        operations: [{
          type: 'create_connected_node',
          fromNodeId: args.fromNodeId,
          kind: 'data',
          node: {
            id: args.id ?? args.nodeId,
            type: args.type,
            title: args.title,
            position: { x: Number(args.x ?? 0), y: Number(args.y ?? 0) },
            ...(args.metadata ? { metadata: args.metadata } : {}),
          },
        }],
      },
    };
  }
  return null;
}

/** Replay the agent's recorded writes through the real gateway so the graded world reflects what actually happened. */
async function replayCodexWrites(writes, gateway, trajectory) {
  for (const write of writes) {
    const call = codexWriteToGatewayCall(write);
    if (!call) {
      trajectory?.recordNote({ surface: 'codex', note: `unsupported write command: ${write.command}`, args: write.args });
      continue;
    }
    try {
      const result = await gateway(call.command, call.args, {
        source: 'codex',
        ...(write.idempotencyKey ? { idempotencyKey: write.idempotencyKey } : {}),
      });
      trajectory?.recordToolCall({ surface: 'codex', command: call.command, args: call.args, result: summarise(result) });
      if (result && result.ok === false) {
        return { error: result.error ?? { code: 'CODEX_WRITE_REJECTED' } };
      }
    } catch (error) {
      trajectory?.recordToolCall({
        surface: 'codex',
        command: call.command,
        args: call.args,
        result: { ok: false, error: { code: error.code ?? 'CODEX_ERROR', message: error.message } },
      });
      return { error: { code: error.code ?? 'CODEX_ERROR', message: error.message } };
    }
  }
  return {};
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

/**
 * Spawn `codex exec` for one task. The transcript is captured as raw JSONL so
 * the harness, not the agent, decides what the agent actually did.
 */
async function runCodexExec(task, controlled) {
  const { spawn } = await import('node:child_process');
  const instruction = String(task.instruction ?? '').trim();
  if (!instruction) {
    return { transcript: '', exitCode: null, error: 'task has no instruction' };
  }
  const prompt = [
    instruction,
    'Use the Flovart CLI (npm run flovart:cli -- …) to drive the visible Workflow.',
    'Read .agents/skills/flovart/SKILL.md first. Do not modify any source files.',
  ].join(' ');
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    const child = spawn('codex', ['exec', '--json', '--skip-git-repo-check', prompt], {
      cwd: REPO_ROOT,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', err => resolve({ transcript: '', exitCode: null, error: `codex spawn failed: ${err.message}` }));
    child.once('close', code => resolve({ transcript: stdout, exitCode: code, error: null }));
    setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ transcript: stdout, exitCode: null, error: 'codex exec timed out' });
    }, task.timeout ?? 120_000);
  });
}

/**
 * Parse a `codex exec --json` transcript into tool calls, write commands and
 * token usage. Read-only commands are recorded as evidence; only writes are
 * replayed into the controlled world.
 */
function parseCodexJsonl(transcript) {
  const toolCalls = [];
  const writes = [];
  let usage = null;
  for (const line of String(transcript).split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === 'turn.completed' && event.usage) {
      usage = {
        promptTokens: event.usage.input_tokens ?? 0,
        completionTokens: event.usage.output_tokens ?? 0,
        costUsd: 0,
        measured: true,
      };
      continue;
    }
    if (event.type !== 'item.completed' || event.item?.type !== 'command_execution') continue;
    const raw = event.item.command ?? '';
    const exitCode = event.item.exit_code;
    const output = event.item.aggregated_output ?? '';
    // Every `npm run flovart:cli -- <cmd> …` inside a (possibly compound) shell
    // command is one Flovart tool call.
    for (const match of raw.matchAll(/flovart:cli\s+--\s+([^\n]+?)(?=['\"]|$)/g)) {
      const segment = match[1].trim();
      const parts = segment.split(/\s+/);
      const command = parts[0];
      const args = parseCliFlags(segment.slice(command.length));
      const isWrite = /^(workflow\.node\.create|workflow\.node\.create-connected|workflow\.apply|workflow\.connect|workflow\.node\.update|workflow\.node\.delete|workflow\.select)/.test(command);
      const record = { command, args, result: parseCliOutput(output), exitCode };
      toolCalls.push(record);
      if (isWrite && exitCode === 0) writes.push({ command, args, idempotencyKey: args.idempotencyKey ?? args['idempotency-key'] });
    }
  }
  return { toolCalls, writes, usage };
}

/** Turn `--flag value` / `--flag=value` segments into a flat args object. */
function parseCliFlags(text) {
  const args = {};
  const flagRe = /--([a-zA-Z][\w-]*)(?:[= ]([^'"\s][^\s'"]*|"[^"]*"|'[^']*'))?/g;
  for (const match of text.matchAll(flagRe)) {
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const raw = match[2];
    args[key] = raw === undefined ? true : raw.replace(/^['"]|['"]$/g, '');
  }
  return args;
}

/** Extract the JSON body of a `flovart:cli --json` invocation, or a truncated marker. */
function parseCliOutput(output) {
  const start = output.indexOf('{');
  if (start < 0) return { ok: true, note: 'no-json-output' };
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return { ok: true, note: 'truncated-json' };
  }
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
    case 'real-provider': return createRealProviderRunner(controlled, options);
    default: throw new Error(`Unknown runner: ${name}`);
  }
}

export const RUNNER_NAMES = ['oracle', 'cli', 'mcp', 'codex', 'nop', 'environment', 'real-provider'];
