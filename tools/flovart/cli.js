#!/usr/bin/env node
import { executeFlovartCommand, formatValue, normalizeCommandName, parseCliArgs, SETUP_TEXT } from './core.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';
import { enqueueAndWait, enqueueCommand } from './flovart-bridge.js';
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
  if (!rawCommand) return { command: rawCommand, args: parsedArgs };

  if (rawCommand === 'inspect') return { command: 'canvas.inspect', args: parsedArgs };

  if (rawCommand === 'create') {
    const [type, name, x, y, width, height] = parsedArgs._;
    return {
      command: 'element.create',
      args: { ...parsedArgs, type: parsedArgs.type || type, name: parsedArgs.name || name, x: parsedArgs.x ?? x, y: parsedArgs.y ?? y, width: parsedArgs.width ?? width, height: parsedArgs.height ?? height },
    };
  }

  if (rawCommand === 'update-prompt') {
    const [elementId, ...textTokens] = parsedArgs._;
    return { command: 'element.update-prompt', args: { ...parsedArgs, 'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId, 'text-prompt': parsedArgs['text-prompt'] || parsedArgs.textPrompt || textTokens.join(' ') } };
  }

  if (rawCommand === 'assign-slot') {
    const [elementId, targetElementId, slotRole] = parsedArgs._;
    return { command: 'element.assign-slot', args: { ...parsedArgs, 'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId, 'target-element-id': parsedArgs['target-element-id'] || parsedArgs.targetElementId || targetElementId, 'slot-role': parsedArgs['slot-role'] || parsedArgs.slotRole || slotRole } };
  }

  if (rawCommand === 'ignite') {
    const [elementId] = parsedArgs._;
    return { command: 'element.ignite', args: { ...parsedArgs, 'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId } };
  }

  if (rawCommand === 'watch') {
    const [elementId] = parsedArgs._;
    return { command: 'element.watch', args: { ...parsedArgs, 'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId } };
  }

  if (rawCommand === 'remove') {
    const [id] = parsedArgs._;
    return { command: 'canvas.remove-element', args: { ...parsedArgs, id: parsedArgs.id || id } };
  }

  if (rawCommand === 'select') {
    return { command: 'canvas.select', args: { ...parsedArgs, ids: parsedArgs.ids || parsedArgs._.join(',') } };
  }

  return { command: rawCommand, args: parsedArgs };
}

const LOCAL_COMMANDS = new Set([
  'help', 'setup', 'init', 'doctor',
  'command.list', 'command.schema',
  'inspiration.search', 'inspiration.get',
  'prompt.enhance', 'batch.plan', 'workflow.plan-video',
  'preferences.manage', 'models.list',
]);

const FILE_STATE_COMMANDS = new Set([
  'status', 'provider.status', 'provider.select-model', 'provider.test',
  'canvas.inspect', 'canvas.list-media', 'canvas.add-image', 'canvas.add-video', 'canvas.upload-image', 'canvas.upload-video',
  'canvas.update-element', 'canvas.remove-element', 'canvas.select', 'canvas.clear-media',
  'element.create', 'element.update-prompt', 'element.assign-slot', 'element.watch',
  'workflow.inspect', 'workflow.load', 'workflow.update-node',
  'asset.list', 'export.project', 'video.status',
]);

const BROWSER_COMMANDS = new Set([
  'provider.begin-setup',
  'element.ignite',
  'workflow.run',
  'generate.image', 'generate.images-batch', 'generate.video',
]);

function normalizeCommandForRouting(command) {
  return command.replace(/\./g, '.');
}

const rawCommand = argv[0];
const parsedArgs = parseCliArgs(argv.slice(1));
const normalizedAtomic = normalizeAtomicAlias(rawCommand, parsedArgs);
const command = normalizeCommandName(normalizedAtomic.command);
const args = normalizedAtomic.args;

if (args.file) {
  try {
    const payload = JSON.parse(await readFile(args.file, 'utf8'));
    if (command === 'workflow.load') args.workflow = payload.workflow || payload;
    else args.items = payload.items || payload;
  } catch (error) {
    printCliResponse(false, command || 'unknown', null, { code: 'FILE_READ_ERROR', message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

async function main() {
  if (!command) {
    printCliResponse(true, 'help', { usage: 'npx flovart-cli <command> --json', setup: SETUP_TEXT });
    return;
  }

  const routingCommand = normalizeCommandForRouting(command);

  if (LOCAL_COMMANDS.has(routingCommand)) {
    const result = await executeFlovartCommand(command, args, {});
    if (args.json) printCliResponse(true, command, result);
    else console.log(formatValue(result.text || result));
    return;
  }

  if (FILE_STATE_COMMANDS.has(routingCommand)) {
    const runtime = createShadowRuntimeFacade();
    const result = await executeFlovartCommand(command, args, runtime);
    printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null, { runtime: 'file-state' });
    return;
  }

  if (BROWSER_COMMANDS.has(routingCommand)) {
    const shouldWait = args.wait === true || args.wait === 'true';
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
