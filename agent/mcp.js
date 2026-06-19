import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { COMMAND_ALIASES, COMMAND_REGISTRY } from '../tools/flovart/core.js';
import { loadAgentConfig } from './config.js';

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

export function getFlovartMcpTools() {
  return Object.entries(COMMAND_REGISTRY).map(([command, metadata]) => ({ command, name: toolName(command), metadata }));
}

export async function startMcpServer() {
  const config = loadAgentConfig(true);
  const server = new McpServer({ name: 'flovart-agent', version: '0.2.0' }, {
    instructions: '先读取 workflow.inspect 或 canvas.inspect，再使用明确的 Flovart CLI 原子命令。Workflow 写操作会在浏览器中二次确认。',
  });
  getFlovartMcpTools().forEach(({ command, name, metadata }) => {
    server.registerTool(name, { description: metadata.summary, inputSchema: inputShape(metadata.args) }, async input => {
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
