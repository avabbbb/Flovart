#!/usr/bin/env node
import { executeFlovartCommand, formatValue, parseCliArgs, SETUP_TEXT } from './core.js';
import { FlovartRuntimeClient, createRuntimeFacade } from './runtime-client.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';
import { readFile } from 'node:fs/promises';

const argv = process.argv.slice(2);

function isResultOk(result) {
  if (result && typeof result === 'object' && result.ok === false) return false;
  return true;
}

function printCliResponse(ok, commandName, data = null, error = null, extra = {}) {
  console.log(JSON.stringify({ ok, command: commandName, data, error, ...extra }, null, 2));
  if (!ok) process.exitCode = 1;
}

function normalizeAtomicAlias(rawCommand, parsedArgs) {
  if (!rawCommand) return { command: rawCommand, args: parsedArgs };

  if (rawCommand === 'inspect') {
    return { command: 'canvas.inspect', args: parsedArgs };
  }

  if (rawCommand === 'create') {
    const [type, name, x, y, width, height] = parsedArgs._;
    return {
      command: 'element.create',
      args: {
        ...parsedArgs,
        type: parsedArgs.type || type,
        name: parsedArgs.name || name,
        x: parsedArgs.x ?? x,
        y: parsedArgs.y ?? y,
        width: parsedArgs.width ?? width,
        height: parsedArgs.height ?? height,
      },
    };
  }

  if (rawCommand === 'update-prompt') {
    const [elementId, ...textTokens] = parsedArgs._;
    return {
      command: 'element.update-prompt',
      args: {
        ...parsedArgs,
        'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId,
        'text-prompt': parsedArgs['text-prompt'] || parsedArgs.textPrompt || textTokens.join(' '),
      },
    };
  }

  if (rawCommand === 'assign-slot') {
    const [elementId, targetElementId, slotRole] = parsedArgs._;
    return {
      command: 'element.assign-slot',
      args: {
        ...parsedArgs,
        'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId,
        'target-element-id': parsedArgs['target-element-id'] || parsedArgs.targetElementId || targetElementId,
        'slot-role': parsedArgs['slot-role'] || parsedArgs.slotRole || slotRole,
      },
    };
  }

  if (rawCommand === 'ignite') {
    const [elementId] = parsedArgs._;
    return {
      command: 'element.ignite',
      args: {
        ...parsedArgs,
        'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId,
      },
    };
  }

  if (rawCommand === 'watch') {
    const [elementId] = parsedArgs._;
    return {
      command: 'element.watch',
      args: {
        ...parsedArgs,
        'element-id': parsedArgs['element-id'] || parsedArgs.elementId || elementId,
      },
    };
  }

  if (rawCommand === 'remove') {
    const [id] = parsedArgs._;
    return {
      command: 'canvas.remove-element',
      args: {
        ...parsedArgs,
        id: parsedArgs.id || id,
      },
    };
  }

  if (rawCommand === 'select') {
    const ids = parsedArgs.ids || parsedArgs._.join(',');
    return {
      command: 'canvas.select',
      args: {
        ...parsedArgs,
        ids,
      },
    };
  }

  return { command: rawCommand, args: parsedArgs };
}

const rawCommand = argv[0];
const parsedArgs = parseCliArgs(argv.slice(1));
const { command, args } = normalizeAtomicAlias(rawCommand, parsedArgs);

if (args.file) {
  try {
    const payload = JSON.parse(await readFile(args.file, 'utf8'));
    if (command === 'workflow.load' || command === 'workflow.load') {
      args.workflow = payload.workflow || payload;
    } else {
      args.items = payload.items || payload;
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exit(1);
  }
}

async function main() {
  if (!command) {
    printCliResponse(true, 'help', { usage: 'npm run flovart:cli -- <command> --json', setup: SETUP_TEXT });
    return;
  }

  const localOnlyCommands = new Set([
    'help',
    'setup',
    'init',
    'doctor',
    'command.list',
    'command.schema',
    'inspiration.search',
    'inspiration.get',
    'prompt.enhance',
    'batch.plan',
    'workflow.plan-video',
    'preferences.manage',
    'models.list',
  ]);

  if (localOnlyCommands.has(command)) {
    const result = await executeFlovartCommand(command, args, {});
    if (args.json) printCliResponse(true, command, result);
    else console.log(formatValue(result.text || result));
    return;
  }

  const client = new FlovartRuntimeClient();
  try {
    await client.connect();
    const runtime = createRuntimeFacade(client);
    const result = await executeFlovartCommand(command, args, runtime);
    printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/No Flovart tab found|Cannot query CDP targets|__flovartAPI not available|fetch failed|ECONNREFUSED/i.test(message)) {
      const result = await executeFlovartCommand(command, args, createShadowRuntimeFacade());
      printCliResponse(isResultOk(result), command, result, isResultOk(result) ? null : result.error || null, { fallback: 'shadow-runtime' });
    } else {
      printCliResponse(false, command, null, { code: 'CLI_RUNTIME_ERROR', message }, { setup: SETUP_TEXT });
    }
  } finally {
    await client.disconnect();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, command, data: null, error: { code: 'CLI_FATAL', message: error instanceof Error ? error.message : String(error) } }, null, 2));
  process.exit(1);
});
