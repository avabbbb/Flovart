#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { AGENT_OPERATION_DEFINITIONS, AGENT_PUBLIC_COMMANDS } from './agent-surface.js';
import { COMMAND_REGISTRY } from './core.js';
import { createOperationGateway, MCP_DEPRECATED_TOOL_NAMES, MCP_TOOL_NAMES } from './operation-gateway.js';
import { AGENT_TOOL_SPEC_BY_COMMAND } from './agent-tools.js';
import { WORKFLOW_APPLY_GUIDE } from './workflow-operation-schema.js';
import { PIPELINE_COMMAND_NAMES, PIPELINE_WRITE_COMMANDS } from './pipeline/commands.js';
import { SKILL_SURFACE_COMMAND_NAMES, SKILL_SURFACE_WRITE_COMMANDS } from './skill-surface.js';

/** Agent 视频流水线命令的 MCP 工具名：flovart_ + 命令名（点换下划线），如 flovart_composition_render。 */
export const PIPELINE_MCP_TOOL_NAMES = Object.freeze(Object.fromEntries(
  PIPELINE_COMMAND_NAMES.map(command => [command, `flovart_${command.replace(/[.-]/g, '_')}`]),
));

/** Skill 生态与项目回执的 MCP 工具名：flovart_skill_list、flovart_skill_draft、flovart_receipts_list…… */
export const SKILL_MCP_TOOL_NAMES = Object.freeze(Object.fromEntries(
  SKILL_SURFACE_COMMAND_NAMES.map(command => [command, `flovart_${command.replace(/[.-]/g, '_')}`]),
));

const SKILL_GUIDE = 'Production Skills only reach providers through the Flovart Runtime: they never read API keys. To turn a canvas into a Skill, pick a project (workflow.project.list / workflow.inspect, history canvases included), then call skill.draft with fromProject; it installs only with install=true and a passing evaluation.';

const PIPELINE_GUIDE = 'Agent video pipeline: every call is recorded as a step in the run trace. Write tools need a stable mutationId so retries replay instead of re-running. Pass agentIdentity (codex, claude-code, ...) so the trace shows who called.';

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

/** Agent 工具定义里的 JSON Schema → zod（与其他宿主同一份 Schema；转换失败时退回注册表类型标记）。 */
function specPropertySchema(propertySchema, descriptor) {
  try {
    return z.fromJSONSchema(propertySchema);
  } catch {
    const fallback = descriptorSchema(String(descriptor).replace(/\?$/, ''));
    return propertySchema.description ? fallback.describe(propertySchema.description) : fallback;
  }
}

export function mcpInputShape(command) {
  const definition = COMMAND_REGISTRY[command];
  if (!definition) throw new Error(`Missing canonical command metadata: ${command}`);
  const spec = AGENT_TOOL_SPEC_BY_COMMAND[command];
  const shape = spec
    ? Object.fromEntries(Object.entries(spec.inputSchema.properties).map(([name, propertySchema]) => {
      // operations 在 MCP 边界保持宽松（与上一版一致），由 Workflow 分发器给出逐字段的可读错误。
      const schema = command === 'workflow.apply' && name === 'operations'
        ? z.array(z.unknown()).describe(WORKFLOW_APPLY_GUIDE)
        : specPropertySchema(propertySchema, definition.args[name]);
      return [name, spec.inputSchema.required.includes(name) ? schema : schema.optional()];
    }))
    : Object.fromEntries(Object.entries(definition.args || {}).map(([name, descriptor]) => [name, descriptorSchema(descriptor)]));
  if (command === 'workflow.apply' && shape.operations && !spec) shape.operations = shape.operations.describe(WORKFLOW_APPLY_GUIDE);
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

  const registerOperationTool = (name, command, description) => {
    server.registerTool(name, {
      description,
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
  };
  for (const command of AGENT_PUBLIC_COMMANDS) {
    const name = MCP_TOOL_NAMES[command];
    if (!name) throw new Error(`Missing MCP tool name for ${command}`);
    registerOperationTool(name, command, AGENT_TOOL_SPEC_BY_COMMAND[command]?.description || COMMAND_REGISTRY[command].summary);
  }
  if (options.includeDeprecatedAliases !== false) {
    for (const [alias, command] of Object.entries(MCP_DEPRECATED_TOOL_NAMES)) {
      registerOperationTool(alias, command, `[已弃用，下个版本移除] 请改用 ${MCP_TOOL_NAMES[command]}。` + (AGENT_TOOL_SPEC_BY_COMMAND[command]?.description || ''));
    }
  }

  if (options.includePipeline !== false) {
    const executePipeline = options.pipelineExecute
      || (async (command, args, context) => (await import('./pipeline/index.js')).executePipelineCommand(command, args, context));
    for (const command of PIPELINE_COMMAND_NAMES) {
      const definition = COMMAND_REGISTRY[command];
      server.registerTool(PIPELINE_MCP_TOOL_NAMES[command], {
        description: `${definition.summary} ${PIPELINE_GUIDE}`,
        inputSchema: mcpInputShape(command),
        annotations: { readOnlyHint: !PIPELINE_WRITE_COMMANDS.has(command), idempotentHint: true, openWorldHint: false },
      }, async input => {
        const { agentIdentity, hostSessionId: _hostSessionId, ...args } = input || {};
        try {
          const response = await executePipeline(command, args, {
            caller: agentIdentity || 'mcp',
            ...(args.mutationId ? { mutationId: String(args.mutationId) } : {}),
          });
          if (!response?.ok) return failureResult({ toJSON: () => response?.error || { code: 'PIPELINE_FAILED', message: 'pipeline command failed', retryable: false } });
          return successResult({ ...response.result, ...(response.step ? { step: response.step } : {}) });
        } catch (error) {
          return failureResult(error);
        }
      });
    }
  }

  if (options.includeSkills !== false) {
    const executeSkill = options.skillExecute
      || (async (command, args) => (await import('./skill-commands.js')).runSkillCommand(command, args));
    for (const command of SKILL_SURFACE_COMMAND_NAMES) {
      const definition = COMMAND_REGISTRY[command];
      server.registerTool(SKILL_MCP_TOOL_NAMES[command], {
        description: `${definition.summary} ${SKILL_GUIDE}`,
        inputSchema: mcpInputShape(command),
        annotations: { readOnlyHint: !SKILL_SURFACE_WRITE_COMMANDS.has(command), idempotentHint: !SKILL_SURFACE_WRITE_COMMANDS.has(command), openWorldHint: command === 'skill.hub.list' || command === 'skill.install' },
      }, async input => {
        const { agentIdentity: _agentIdentity, hostSessionId: _hostSessionId, ...args } = input || {};
        try {
          const response = await executeSkill(command, args);
          if (!response?.ok) return failureResult({ toJSON: () => response?.error || { code: 'SKILL_COMMAND_FAILED', message: 'skill command failed', retryable: false } });
          return successResult(response);
        } catch (error) {
          return failureResult(error);
        }
      });
    }
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
