#!/usr/bin/env node
import { COMMAND_REGISTRY, executeFlovartCommand, formatValue, normalizeCommandName, parseCliArgs, SETUP_TEXT } from './core.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';
import { enqueueAndWait, enqueueCommand } from './flovart-bridge.js';
import { BROWSER_COMMANDS, shouldWaitForBrowserCommand } from './browser-commands.js';
import { readFile } from 'node:fs/promises';
import { defaultRuntimeActor, FlovartRuntimeClient, RuntimeClientError } from './runtime-client.js';
import { RUNTIME_COMMANDS, RUNTIME_WRITE_COMMANDS } from './runtime-command-surface.js';
import { WORKSPACE_COMMANDS, WORKSPACE_WRITE_COMMANDS } from './workspace-command-surface.js';
import { RESEARCH_COMMANDS, RESEARCH_WRITE_COMMANDS } from './research-command-surface.js';
import { collectTopicResearch } from './topic-research.js';
import {
  createWorkspaceFacade,
  FlovartWorkspaceClient,
  WorkspaceClientError,
} from './workspace-client.js';

const argv = process.argv.slice(2);

function isResultOk(result) {
  return !(result && typeof result === 'object' && result.ok === false);
}

function printCliResponse(ok, commandName, data = null, error = null, extra = {}) {
  console.log(JSON.stringify({ ok, command: commandName, data, error, ...extra }, null, 2));
  if (!ok) process.exitCode = 1;
}

function normalizeAtomicAlias(rawCommand, parsedArgs) {
  return { command: rawCommand, args: parsedArgs };
}

const LOCAL_COMMANDS = new Set([
  'help', 'setup', 'init', 'doctor',
  'inspiration.search', 'inspiration.get',
  'prompt.enhance', 'batch.plan',
  'preferences.manage', 'models.list',
]);
const CLIENT_REGISTRY_COMMANDS = new Set(['command.list', 'command.schema']);

const FILE_STATE_COMMANDS = new Set([
  'status',
  'asset.list', 'export.project', 'video.status',
]);

function runtimeInvocation(command, parsed) {
  const definition = COMMAND_REGISTRY[command];
  const commandArgs = {};
  for (const [name, type] of Object.entries(definition?.args || {})) {
    const kebab = name.replace(/([A-Z])/g, '-$1').toLowerCase();
    const raw = parsed[name] ?? parsed[kebab];
    if (raw === undefined) continue;
    const base = type.replace(/\?$/, '');
    if (base === 'number') commandArgs[name] = Number(raw);
    else if (base === 'boolean') commandArgs[name] = raw === true || String(raw).toLowerCase() === 'true';
    else if (['object', 'array', 'string[]'].includes(base) && typeof raw === 'string') {
      try {
        commandArgs[name] = JSON.parse(raw);
      } catch (error) {
        throw new RuntimeClientError(
          'INVALID_ARGUMENT',
          `--${kebab} must be valid JSON (${base}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else commandArgs[name] = raw;
  }
  const idempotencyKey = parsed.idempotencyKey || parsed['idempotency-key'];
  if (RUNTIME_WRITE_COMMANDS.has(command) && !idempotencyKey) {
    throw new RuntimeClientError(
      'INVALID_ARGUMENT',
      `${command} requires --idempotency-key so retries cannot duplicate work.`,
    );
  }
  return { commandArgs, options: { ...(idempotencyKey ? { idempotencyKey } : {}) } };
}

const rawCommand = argv[0];

if (rawCommand === 'tui' || rawCommand === 'ui' || rawCommand === 'interactive' || (!rawCommand && process.stdin.isTTY)) {
  const mod = await import('./tui.js');
  await mod.runTui(rawCommand ? argv.slice(1) : []);
  process.exit(0);
}

if (['install', 'start', 'update'].includes(rawCommand)) {
  const mod = await import('./dev-commands.js');
  await mod[rawCommand](argv.slice(1));
  process.exit(0);
}

if (rawCommand === 'agent') {
  await import('./managed-agent/index.js').catch(() => import('../../agent/index.js'));
  process.exit(0);
}

const parsedArgs = parseCliArgs(argv.slice(1));
const normalizedAtomic = normalizeAtomicAlias(rawCommand, parsedArgs);
const command = normalizeCommandName(normalizedAtomic.command);
const args = normalizedAtomic.args;

if (args.file) {
  try {
    const payload = JSON.parse(await readFile(args.file, 'utf8'));
    if (command === 'generate.images-batch' || command === 'generate.video') args.items = payload.items || payload;
    if (command === 'production.dry-run') args.spec = payload;
  } catch (error) {
    printCliResponse(false, command || 'unknown', null, { code: 'FILE_READ_ERROR', message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

async function main() {
  if (!command) {
    printCliResponse(true, 'help', { usage: 'flovart  # opens TUI; or flovart <command> --json', setup: SETUP_TEXT, commands: { tui: 'Open slash-command TUI', install: 'Download and verify the versioned Agent Toolkit', start: 'Launch local Runtime/WebUI and the managed coding agent', update: 'Install and switch to the latest compatible Toolkit', source: 'Add --source for Vite/Go/Docker contributor services' } });
    return;
  }

  const routingCommand = command;

  if (CLIENT_REGISTRY_COMMANDS.has(routingCommand)) {
    const result = await executeFlovartCommand(command, args, {});
    const ok = isResultOk(result);
    if (args.json) printCliResponse(ok, command, ok ? result : null, ok ? null : result.error || null, { runtime: 'client-registry' });
    else {
      console.log(formatValue(result));
      if (!ok) process.exitCode = 1;
    }
    return;
  }

  if (RUNTIME_COMMANDS.has(routingCommand)) {
    const runtime = new FlovartRuntimeClient();
    try {
      const invocation = runtimeInvocation(routingCommand, args);
      let result;
      if (routingCommand === 'runtime.status') result = await runtime.status();
      else if (routingCommand === 'task.get') result = await runtime.getTask(invocation.commandArgs.taskId);
      else if (routingCommand === 'task.list') result = await runtime.listTasks(invocation.commandArgs);
      else if (routingCommand === 'event.stream') result = await runtime.streamEvents(invocation.commandArgs);
      else {
        result = await runtime.execute(
          routingCommand,
          invocation.commandArgs,
          defaultRuntimeActor('cli'),
          invocation.options,
        );
      }
      if (args.json) printCliResponse(true, command, result, null, { runtime: 'production-runtime' });
      else console.log(formatValue(result));
    } catch (error) {
      const runtimeError = error instanceof RuntimeClientError
        ? error.toJSON()
        : { code: 'RUNTIME_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true };
      printCliResponse(false, command, null, runtimeError, { runtime: 'production-runtime' });
    }
    return;
  }

  if (WORKSPACE_COMMANDS.has(routingCommand)) {
    const idempotencyKey = args.idempotencyKey || args['idempotency-key'];
    if (WORKSPACE_WRITE_COMMANDS.has(routingCommand) && !idempotencyKey) {
      printCliResponse(false, command, null, {
        code: 'INVALID_ARGUMENT',
        message: `${routingCommand} requires --idempotency-key so retries cannot duplicate visible Workflow changes.`,
        retryable: false,
      }, { runtime: 'workspace-adapter' });
      return;
    }
    try {
      const workspace = new FlovartWorkspaceClient();
      const result = routingCommand === 'workspace.status'
        ? await workspace.status()
        : await executeFlovartCommand(command, args, createWorkspaceFacade(workspace));
      const ok = isResultOk(result);
      printCliResponse(ok, command, result, ok ? null : result.error || null, { runtime: 'workspace-adapter' });
    } catch (error) {
      const workspaceError = error instanceof WorkspaceClientError
        ? error.toJSON()
        : { code: 'WORKSPACE_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true };
      printCliResponse(false, command, null, workspaceError, { runtime: 'workspace-adapter' });
    }
    return;
  }

  if (RESEARCH_COMMANDS.has(routingCommand)) {
    const idempotencyKey = args.idempotencyKey || args['idempotency-key'];
    if (RESEARCH_WRITE_COMMANDS.has(routingCommand) && !idempotencyKey) {
      printCliResponse(false, command, null, {
        code: 'INVALID_ARGUMENT',
        message: `${routingCommand} requires --idempotency-key so retries replay the same research artifact.`,
        retryable: false,
      }, { runtime: 'research-adapter' });
      return;
    }
    try {
      const result = await collectTopicResearch(args, { idempotencyKey });
      const ok = result.state !== 'failed';
      printCliResponse(ok, command, ok ? result : null, ok ? null : {
        code: 'SOURCE_UNAVAILABLE',
        message: 'No usable topic evidence was collected from the requested sources.',
        retryable: true,
        details: result,
      }, { runtime: 'research-adapter' });
    } catch (error) {
      printCliResponse(false, command, null, {
        code: error?.code || 'RESEARCH_FAILED',
        message: error instanceof Error ? error.message : String(error),
        retryable: error?.code !== 'INVALID_ARGUMENT',
      }, { runtime: 'research-adapter' });
    }
    return;
  }

  if (LOCAL_COMMANDS.has(routingCommand)) {
    const result = await executeFlovartCommand(command, args, {});
    const ok = isResultOk(result);
    if (args.json) printCliResponse(ok, command, result, ok ? null : result.error || null);
    else {
      console.log(formatValue(result.text || result));
      if (!ok) process.exitCode = 1;
    }
    return;
  }

  if (FILE_STATE_COMMANDS.has(routingCommand)) {
    const runtime = createShadowRuntimeFacade();
    const result = await executeFlovartCommand(command, args, runtime);
    printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null, { runtime: 'file-state' });
    return;
  }

  if (BROWSER_COMMANDS.has(routingCommand)) {
    const shouldWait = shouldWaitForBrowserCommand(routingCommand, args.wait);
    const timeoutMs = args.timeout ? Number(args.timeout) : args['timeout-ms'] ? Number(args['timeout-ms']) : 30000;
    const result = shouldWait ? await enqueueAndWait(command, args, timeoutMs) : enqueueCommand(command, args);
    printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result?.error || null, { runtime: 'file-bridge' });
    return;
  }

  const result = await executeFlovartCommand(command, args, createShadowRuntimeFacade());
  printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null, { runtime: 'file-state' });
}

main().catch(error => {
  printCliResponse(false, command || 'unknown', null, { code: 'CLI_FATAL', message: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
