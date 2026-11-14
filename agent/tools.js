import { Type } from 'typebox';
import { importFlovartModule, importFlovartPipelineModule } from './flovart-modules.js';

const [{ AGENT_PUBLIC_COMMAND_SET }, core, pipelineCommands] = await Promise.all([
  importFlovartModule('agent-surface'),
  importFlovartModule('core'),
  importFlovartPipelineModule('commands'),
]);
const { PIPELINE_COMMAND_NAMES, PIPELINE_WRITE_COMMANDS } = pipelineCommands;
const { COMMAND_ALIASES, COMMAND_REGISTRY } = core;
const AGENT_WRITE_COMMANDS = new Set([
  'workflow.apply',
  'workflow.node.run',
]);

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

/** 返回模型可调用的最小稳定面；CLI Registry 仍保留兼容命令与 discovery/debug 元数据。 */
export function getFlovartAgentTools() {
  return Object.entries(COMMAND_REGISTRY)
    .filter(([command, metadata]) => metadata.availability === 'available' && AGENT_PUBLIC_COMMAND_SET.has(command))
    .map(([command, metadata]) => ({ command, name: toolName(command), metadata }));
}

export function createFlovartAgentTools(callCommand) {
  return getFlovartAgentTools().map(({ command, name, metadata }) => {
    const write = AGENT_WRITE_COMMANDS.has(command);
    return {
      name,
      label: metadata.summary,
      description: metadata.summary,
      parameters: agentParameters(metadata.args, write),
      executionMode: 'sequential',
      async execute(_toolCallId, input, signal, onUpdate) {
        if (signal?.aborted) throw new Error('Workflow 操作已取消');
        const { idempotencyKey, changeSetId, ...args } = input;
        const commandArgs = command.startsWith('workflow.')
          ? {
            ...args,
            workspaceMode: 'browser',
            ...(AGENT_WRITE_COMMANDS.has(command) && changeSetId ? { changeSetId } : {}),
          }
          : args;
        onUpdate?.({ content: [{ type: 'text', text: JSON.stringify({ command, status: 'running' }) }], details: { command, status: 'running' } });
        const result = await callCommand(command, commandArgs, 'agent', idempotencyKey, signal);
        if (result?.ok === false) {
          // 预期内失败（预算、暂停、审核、版本冲突）作为结构化结果交还模型，由 kernel 的 afterToolCall 标记 isError，不再抛错。
          const failure = { ok: false, error: { code: result.error?.code || 'COMMAND_FAILED', message: result.error?.message || 'Flovart 操作失败' } };
          return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: { command, result, isError: true } };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          details: { command, result },
        };
      },
    };
  });
}

// ---------------- Agent 视频流水线工具集（docs/design/16-agent-video-pipeline.md §3） ----------------
// 不进入稳定 baseline：pipeline.run.start / pipeline.run.get 是入口，其余工具只在本会话有活动 run 时放行（kernel 负责门禁）。
export const PIPELINE_ENTRY_COMMANDS = new Set(['pipeline.run.start', 'pipeline.run.get']);

export { PIPELINE_SYSTEM_RULES } from './pipeline-rules.js';

export function createFlovartPipelineTools(callCommand) {
  return PIPELINE_COMMAND_NAMES.map(command => {
    const metadata = COMMAND_REGISTRY[command];
    const write = PIPELINE_WRITE_COMMANDS.has(command);
    const { mutationId: _mutation, ...args } = metadata.args;
    return {
      name: toolName(command),
      label: metadata.summary,
      description: metadata.summary,
      parameters: Type.Object({
        ...agentParameters(args, false).properties,
        ...(write ? { mutationId: Type.String({ minLength: 1 }) } : {}),
      }, { additionalProperties: false }),
      executionMode: 'sequential',
      pipeline: { command, entry: PIPELINE_ENTRY_COMMANDS.has(command) },
      async execute(_toolCallId, input, signal, onUpdate) {
        if (signal?.aborted) throw new Error('pipeline 操作已取消');
        const { mutationId, changeSetId: _changeSet, ...commandArgs } = input;
        onUpdate?.({ content: [{ type: 'text', text: JSON.stringify({ command, status: 'running' }) }], details: { command, status: 'running' } });
        const result = await callCommand(command, commandArgs, 'agent', mutationId, signal);
        if (result?.ok === false) {
          const failure = { ok: false, error: { code: result.error?.code || 'PIPELINE_FAILED', message: result.error?.message || 'pipeline 操作失败', ...(result.error?.details ? { details: result.error.details } : {}) } };
          return { content: [{ type: 'text', text: JSON.stringify(failure) }], details: { command, result, isError: true } };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { command, result } };
      },
    };
  });
}
