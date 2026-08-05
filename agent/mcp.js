import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Type } from 'typebox';
import { z } from 'zod';
import { loadAgentConfig } from './config.js';

const sourceCore = '../tools/flovart/core.js';
const bundledCore = '../core.js';
const core = await import(sourceCore).catch(() => import(bundledCore));
const { COMMAND_ALIASES, COMMAND_REGISTRY } = core;
const WORKSPACE_WRITE_COMMANDS = new Set([
  'workflow.project.create', 'workflow.project.use', 'workflow.project.delete',
  'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update',
  'workflow.node.delete', 'workflow.node.move', 'workflow.node.resize',
  'workflow.node.tool',
  'workflow.connect', 'workflow.disconnect', 'workflow.select', 'workflow.viewport.set',
]);
const WORKSPACE_COMMANDS = new Set([
  'workflow.project.list',
  'workflow.inspect',
  ...WORKSPACE_WRITE_COMMANDS,
]);

const descriptorSchema = descriptor => {
  const optional = String(descriptor).endsWith('?');
  const token = optional ? String(descriptor).slice(0, -1) : String(descriptor);
  let schema;
  if (token === 'number') schema = z.coerce.number();
  else if (token === 'boolean') schema = z.union([z.boolean(), z.string().transform(value => value === 'true')]);
  else if (token === 'object') schema = z.record(z.string(), z.unknown());
  else if (token === 'array') schema = z.array(z.unknown());
  else if (token === 'string[]') schema = z.array(z.string());
  else if (token.includes('|')) schema = z.enum(token.split('|'));
  else schema = z.string();
  return optional ? schema.optional() : schema;
};

const inputShape = args => Object.fromEntries(Object.entries(args || {}).map(([name, descriptor]) => [name, descriptorSchema(descriptor)]));

const toolName = command => {
  const alias = Object.entries(COMMAND_ALIASES).find(([name, target]) => target === command && name.startsWith('flovart_'))?.[0];
  return alias || `flovart_${command.replace(/[^a-zA-Z0-9]+/g, '_')}`;
};

const descriptorType = descriptor => {
  const optional = String(descriptor).endsWith('?');
  const token = optional ? String(descriptor).slice(0, -1) : String(descriptor);
  let schema;
  if (token === 'number') schema = Type.Number();
  else if (token === 'boolean') schema = Type.Boolean();
  else if (token === 'object') schema = Type.Record(Type.String(), Type.Unknown());
  else if (token === 'array') schema = Type.Array(Type.Unknown());
  else if (token === 'string[]') schema = Type.Array(Type.String());
  else if (token.includes('|')) schema = Type.Union(token.split('|').map(value => Type.Literal(value)));
  else schema = Type.String();
  return optional ? Type.Optional(schema) : schema;
};

const agentParameters = (args, write) => Type.Object({
  ...Object.fromEntries(Object.entries(args || {}).map(([name, descriptor]) => [name, descriptorType(descriptor)])),
  ...(write ? { idempotencyKey: Type.String({ minLength: 1 }) } : {}),
}, { additionalProperties: false });

export function getFlovartMcpTools() {
  return Object.entries(COMMAND_REGISTRY)
    .filter(([command, metadata]) => metadata.availability === 'available' && WORKSPACE_COMMANDS.has(command))
    .map(([command, metadata]) => ({ command, name: toolName(command), metadata }));
}

export function createFlovartAgentTools(callCommand) {
  return getFlovartMcpTools().map(({ command, name, metadata }) => {
    const write = WORKSPACE_WRITE_COMMANDS.has(command);
    return {
      name,
      label: metadata.summary,
      description: metadata.summary,
      parameters: agentParameters(metadata.args, write),
      executionMode: 'sequential',
      async execute(_toolCallId, input, signal) {
        if (signal?.aborted) throw new Error('Workflow 操作已取消');
        const result = await callCommand(command, input, 'agent', input.idempotencyKey, signal);
        if (result?.ok === false) throw new Error(result.error?.message || 'Flovart Workflow 操作失败');
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: { command, result },
        };
      },
    };
  });
}

export async function startMcpServer() {
  const config = loadAgentConfig(true);
  const server = new McpServer({ name: 'flovart-agent', version: '0.2.0' }, {
    instructions: '先读取 workflow.inspect，再通过当前可见 Workspace 的类型化 Workflow 命令操作节点。不得调用 legacy、Canvas 或 Element 命令；每个写命令使用稳定 idempotencyKey。',
  });
  getFlovartMcpTools().forEach(({ command, name, metadata }) => {
    const inputSchema = inputShape(metadata.args);
    if (WORKSPACE_WRITE_COMMANDS.has(command)) inputSchema.idempotencyKey = z.string().min(1);
    server.registerTool(name, { description: metadata.summary, inputSchema }, async input => {
      const response = await fetch(`${config.url}/api/tools`, {
        method: 'POST',
        signal: AbortSignal.timeout(95_000),
        headers: { 'content-type': 'application/json', 'x-flovart-agent-token': config.token },
        body: JSON.stringify({ command, args: input, source: 'mcp' }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok || body.result?.ok === false) throw new Error(body.result?.error?.message || body.error?.message || body.error || 'Flovart tool call failed');
      return { content: [{ type: 'text', text: JSON.stringify(body.result, null, 2) }] };
    });
  });
  await server.connect(new StdioServerTransport());
}
