#!/usr/bin/env node
import { executeFlovartCommand, formatValue, normalizeCommandName, parseCliArgs, SETUP_TEXT } from './core.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';
import { enqueueAndWait, enqueueCommand } from './flovart-bridge.js';
import { BROWSER_COMMANDS, shouldWaitForBrowserCommand } from './browser-commands.js';
import { readFile } from 'node:fs/promises';

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
  'runtime.status', 'command.list', 'command.schema',
  'inspiration.search', 'inspiration.get',
  'prompt.enhance', 'batch.plan',
  'preferences.manage', 'models.list',
]);

const FILE_STATE_COMMANDS = new Set([
  'status',
  'asset.list', 'export.project', 'video.status',
  'workflow.project.list', 'workflow.project.create', 'workflow.project.use', 'workflow.project.delete',
  'workflow.inspect', 'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update', 'workflow.node.delete',
  'workflow.node.move', 'workflow.node.resize', 'workflow.connect', 'workflow.disconnect',
  'workflow.select', 'workflow.viewport.set',
]);

function normalizeCommandForRouting(command) {
  return command.replace(/\./g, '.');
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

  const routingCommand = normalizeCommandForRouting(command);

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
