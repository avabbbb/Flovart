#!/usr/bin/env node
// Flovart MCP Server — wraps all Flovart CLI commands as MCP tools.
// External agents (Claude Code, Codex, OpenClaw) call via standard MCP stdio protocol.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { COMMAND_REGISTRY } from './core.js';
import { defaultRuntimeActor, FlovartRuntimeClient, RuntimeClientError } from './runtime-client.js';
import {
  availableCommandEntries,
  RUNTIME_COMMANDS,
  RUNTIME_WRITE_COMMANDS,
} from './runtime-command-surface.js';

function argTypeToZod(typeStr) {
  const optional = typeStr.endsWith('?');
  const base = optional ? typeStr.slice(0, -1) : typeStr;
  let zod;
  if (base.includes('|')) {
    zod = z.enum(base.split('|'));
  } else {
    switch (base) {
      case 'string': zod = z.string(); break;
      case 'number': zod = z.number(); break;
      case 'boolean': zod = z.boolean(); break;
      case 'object': zod = z.record(z.string(), z.unknown()); break;
      case 'array': zod = z.array(z.unknown()); break;
      case 'string[]': zod = z.array(z.string()); break;
      case 'key=value[]': zod = z.array(z.string()); break;
      case 'json': zod = z.string(); break;
      default: zod = z.string();
    }
  }
  return optional ? zod.optional() : zod;
}

function buildSchema(argDefs) {
  const shape = {};
  for (const [name, type] of Object.entries(argDefs)) {
    shape[name] = argTypeToZod(type);
  }
  return shape;
}

async function routeAndExecute(command, rawArgs) {
  const { idempotencyKey, ...rest } = rawArgs;
  if (!RUNTIME_COMMANDS.has(command)) {
    return { ok: false, error: { code: 'UNKNOWN_COMMAND', message: `Command is not available through Production Runtime: ${command}`, retryable: false } };
  }
  const runtime = new FlovartRuntimeClient();
  try {
    const commandArgs = {};
    for (const name of Object.keys(COMMAND_REGISTRY[command]?.args || {})) {
      if (rest[name] !== undefined) commandArgs[name] = rest[name];
    }
    if (command === 'runtime.status') return await runtime.status();
    if (command === 'task.get') return await runtime.getTask(commandArgs.taskId);
    if (command === 'task.list') return await runtime.listTasks(commandArgs);
    if (command === 'event.stream') return await runtime.streamEvents(commandArgs);
    return await runtime.execute(
      command,
      commandArgs,
      defaultRuntimeActor('mcp'),
      { ...(idempotencyKey ? { idempotencyKey } : {}) },
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof RuntimeClientError
        ? error.toJSON()
        : { code: 'RUNTIME_UNAVAILABLE', message: error instanceof Error ? error.message : String(error), retryable: true },
    };
  }
}

const server = new McpServer({
  name: 'flovart',
  version: '0.3.0',
  instructions: [
    'Flovart MCP Server — deterministic Production Runtime tools.',
    'Only commands marked available in the canonical registry are exposed.',
    'Provider jobs return durable task IDs; observe them with task.get and event.stream.',
    'Workflow commands remain unavailable until the visible workspace is projected from Production Runtime.',
    'Never read, print, or store API keys. Provider keys stay in the local Flovart Runtime/WebUI only.',
  ].join(' '),
});

for (const [commandName, def] of availableCommandEntries(COMMAND_REGISTRY)) {
  const toolName = commandName.replace(/[-.]/g, '_');
  const schema = buildSchema(def.args);
  if (RUNTIME_WRITE_COMMANDS.has(commandName)) {
    schema.idempotencyKey = z.string().min(1);
  }
  server.tool(
    toolName,
    def.summary,
    Object.keys(schema).length > 0 ? schema : undefined,
    async (args) => {
      try {
        const result = await routeAndExecute(commandName, args || {});
        const ok = !(result && typeof result === 'object' && result.ok === false);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !ok,
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    }
  );
}

process.on('uncaughtException', (error) => {
  console.error('[flovart-mcp] Uncaught:', error);
  process.exit(1);
});

const transport = new StdioServerTransport();
await server.connect(transport);
