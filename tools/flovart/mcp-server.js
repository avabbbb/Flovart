#!/usr/bin/env node
// Flovart MCP Server — wraps all Flovart CLI commands as MCP tools.
// External agents (Claude Code, Codex, OpenClaw) call via standard MCP stdio protocol.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { COMMAND_REGISTRY, executeFlovartCommand } from './core.js';
import { createShadowRuntimeFacade } from './shadow-runtime.js';
import { enqueueCommand, enqueueAndWait } from './flovart-bridge.js';

const LOCAL_COMMANDS = new Set([
  'help', 'setup', 'init', 'doctor',
  'command.list', 'command.schema',
  'inspiration.search', 'inspiration.get',
  'prompt.enhance', 'batch.plan',
  'preferences.manage', 'models.list',
]);

const BROWSER_COMMANDS = new Set([
  'provider.begin-setup', 'element.ignite',
  'workflow.node.run', 'workflow.node.stop',
  'generate.image', 'generate.images-batch', 'generate.video',
]);

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

function toCliArgs(mcpArgs) {
  const cliArgs = {};
  for (const [key, value] of Object.entries(mcpArgs)) {
    if (value === undefined) continue;
    cliArgs[key] = value;
    const kebab = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (kebab !== key) cliArgs[kebab] = value;
  }
  return cliArgs;
}

async function routeAndExecute(command, rawArgs) {
  const { wait = true, timeoutMs = 60000, ...rest } = rawArgs;
  const args = toCliArgs(rest);
  if (LOCAL_COMMANDS.has(command)) {
    return await executeFlovartCommand(command, args, {});
  }
  if (BROWSER_COMMANDS.has(command)) {
    return wait
      ? await enqueueAndWait(command, args, timeoutMs)
      : enqueueCommand(command, args);
  }
  return await executeFlovartCommand(command, args, createShadowRuntimeFacade());
}

const server = new McpServer({
  name: 'flovart',
  version: '0.3.0',
  instructions: [
    'Flovart MCP Server — deterministic canvas/workflow/generation tools.',
    'All tools mirror flovart CLI commands. Keep the Flovart browser app open for provider-backed generation.',
    'Browser commands (generate.*, element.ignite, workflow.node.run/stop) accept optional `wait` (default true) and `timeoutMs` (default 60000).',
    'If a browser command times out, it returns a pending result — use video.status or element.watch to poll.',
    'Never read, print, or store API keys. Provider keys stay in the browser UI only.',
  ].join(' '),
});

for (const [commandName, def] of Object.entries(COMMAND_REGISTRY)) {
  const toolName = commandName.replace(/[-.]/g, '_');
  const schema = buildSchema(def.args);
  if (BROWSER_COMMANDS.has(commandName)) {
    schema.wait = z.boolean().optional();
    schema.timeoutMs = z.number().optional();
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
