#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { AGENT_OPERATION_DEFINITIONS, AGENT_PUBLIC_COMMANDS } from './agent-surface.js';
import { COMMAND_REGISTRY } from './core.js';
import { createOperationGateway, MCP_TOOL_NAMES } from './operation-gateway.js';

const CONTEXT_FIELDS = new Set(['agentIdentity', 'hostSessionId', 'idempotencyKey']);

function descriptorSchema(descriptor) {
  const optional = String(descriptor).endsWith('?');
  const base = String(descriptor).replace(/\?$/, '');
  const alternatives = base.split('|');
  let schema;
  if (alternatives.length > 1) schema = z.enum(alternatives);
  else if (base === 'number') schema = z.number();
  else if (base === 'boolean') schema = z.boolean();
  else if (base === 'object') schema = z.record(z.string(), z.unknown());
  else if (base === 'array') schema = z.array(z.unknown());
  else if (base === 'string[]') schema = z.array(z.string());
  else schema = z.string();
  return optional ? schema.optional() : schema;
}

export function mcpInputShape(command) {
  const definition = COMMAND_REGISTRY[command];
  if (!definition) throw new Error(`Missing canonical command metadata: ${command}`);
  const shape = Object.fromEntries(
    Object.entries(definition.args || {}).map(([name, descriptor]) => [name, descriptorSchema(descriptor)]),
  );
  // Keep this optional at the Zod seam so the canonical gateway can return
  // the same structured INVALID_ARGUMENT error as the CLI/SDK projections.
  if (AGENT_OPERATION_DEFINITIONS[command]?.mutation) shape.idempotencyKey = z.string().min(1).optional();
  shape.agentIdentity = z.string().min(1).max(100).optional();
  shape.hostSessionId = z.string().min(1).max(500).optional();
  return shape;
}

function redactSecrets(value, key = '') {
  if (value === null || value === undefined) return value;
  if (/(?:api[-_]?key|authorization|\btoken\b|access[-_]?token|refresh[-_]?token|workspace[-_]?token|agent[-_]?token|secret|credential)/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSecrets(item, name)]));
  return value;
}

function jsonText(value) {
  return JSON.stringify(redactSecrets(value), null, 2);
}

function successResult(result) {
  const safe = redactSecrets(result);
  const response = {
    content: [{ type: 'text', text: jsonText(safe) }],
  };
  if (safe && typeof safe === 'object' && !Array.isArray(safe)) response.structuredContent = safe;
  return response;
}

function failureResult(error) {
  const normalized = typeof error?.toJSON === 'function'
    ? error.toJSON()
    : { code: error?.code || 'MCP_OPERATION_FAILED', message: error instanceof Error ? error.message : String(error), retryable: false };
  const payload = { ok: false, error: redactSecrets(normalized) };
  return {
    isError: true,
    content: [{ type: 'text', text: jsonText(payload) }],
    structuredContent: payload,
  };
}

function operationContext(input) {
  const { agentIdentity, hostSessionId, idempotencyKey } = input;
  return {
    source: 'mcp',
    ...(idempotencyKey ? { idempotencyKey } : {}),
    ...(agentIdentity ? { caller: { agentIdentity, ...(hostSessionId ? { hostSessionId } : {}) } } : {}),
  };
}

async function readResource(execute, uri, command) {
  try {
    const result = await execute(command, {}, { source: 'mcp' });
    return {
      contents: [{ uri: String(uri), mimeType: 'application/json', text: jsonText(result) }],
    };
  } catch (error) {
    return {
      contents: [{ uri: String(uri), mimeType: 'application/json', text: jsonText({ ok: false, error: failureResult(error).structuredContent.error }) }],
    };
  }
}

export function createMcpServer(options = {}) {
  const execute = options.gateway
    || createOperationGateway(options);
  const server = new McpServer(options.serverInfo || {
    name: 'flovart',
    version: '0.3.2',
  }, {
    instructions: 'Flovart exposes the same small Agent surface as its CLI. Keep Workflow edits visible in the Browser Workflow; never send API keys or tokens as tool arguments.',
  });

  for (const command of AGENT_PUBLIC_COMMANDS) {
    const name = MCP_TOOL_NAMES[command];
    if (!name) throw new Error(`Missing MCP tool name for ${command}`);
    const definition = COMMAND_REGISTRY[command];
    server.registerTool(name, {
      description: definition.summary,
      inputSchema: mcpInputShape(command),
    }, async input => {
      const values = input || {};
      try {
        if (values.hostSessionId && !values.agentIdentity) {
          throw new Error('hostSessionId requires agentIdentity.');
        }
        const operationArgs = Object.fromEntries(Object.entries(values).filter(([key]) => !CONTEXT_FIELDS.has(key)));
        const result = await execute(command, operationArgs, operationContext(values));
        return successResult(result);
      } catch (error) {
        return failureResult(error);
      }
    });
  }

  if (options.includeResources !== false) {
    server.registerResource('flovart-workspace-current', 'flovart://workspace/current', {
      description: 'Current local Flovart readiness and visible Workflow connection state.',
      mimeType: 'application/json',
    }, async uri => readResource(execute, uri, 'status'));
    server.registerResource('flovart-workflow-current', 'flovart://workflow/current', {
      description: 'Current visible Workflow graph with media and secrets redacted.',
      mimeType: 'application/json',
    }, async uri => readResource(execute, uri, 'workflow.inspect'));
  }

  return server;
}

export async function runMcpServer(options = {}) {
  const server = options.server || createMcpServer(options);
  const transport = options.transport || new StdioServerTransport();
  await server.connect(transport);
  return { server, transport };
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  runMcpServer().catch(error => {
    console.error(`[flovart-mcp] ${error instanceof Error ? error.stack || error.message : String(error)}`);
    process.exitCode = 1;
  });
}
