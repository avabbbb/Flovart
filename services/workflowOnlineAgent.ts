import type { WorkflowOnlineTurnInput } from '../components/workflow/WorkflowAgentPanel';
import { WORKFLOW_MUTATION_COMMANDS } from '../components/workflow/agentOps';
import type { ModelPreference, UserApiKey } from '../types';
import { findBestModelSelection, resolveModelSelection } from '../utils/modelRefs';
import { generateTextWithProvider, reversePromptStreamWithProvider } from './aiGateway';
import {
  dispatchWorkflowCommand,
  redactWorkflowAgentValue,
  type WorkflowCommandEnvelope,
  type WorkflowCommandResult,
} from './workflowDispatcher';

interface WorkflowAgentPlanCommand {
  command: string;
  args?: Record<string, unknown>;
}

interface WorkflowAgentPlan {
  message: string;
  commands: WorkflowAgentPlanCommand[];
}

export interface WorkflowOnlineAgentRuntime {
  userApiKeys: UserApiKey[];
  modelPreference: ModelPreference;
  generateText?: typeof generateTextWithProvider;
  describeImage?: typeof reversePromptStreamWithProvider;
  dispatch?: typeof dispatchWorkflowCommand;
}

const ALLOWED_COMMANDS = new Set([
  'workflow.project.list', 'workflow.inspect',
  'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update',
  'workflow.node.delete', 'workflow.node.move', 'workflow.node.resize',
  'workflow.node.run', 'workflow.node.stop', 'workflow.connect', 'workflow.disconnect',
  'workflow.select', 'workflow.viewport.set',
]);

const SYSTEM_PROMPT = `你是 Flovart 网站内置 Workflow Agent。你会收到脱敏后的当前 Workflow JSON、最近对话和用户请求。
只能返回一个 JSON 对象，不要输出 Markdown。格式：
{"message":"说明你的意图，不要声称尚未执行的操作已经成功","commands":[{"command":"workflow.node.create","args":{}}]}
commands 最多 8 条。只可使用下列命令：workflow.project.list、workflow.inspect、workflow.node.create、workflow.node.create-connected、workflow.node.update、workflow.node.delete、workflow.node.move、workflow.node.resize、workflow.node.run、workflow.node.stop、workflow.connect、workflow.disconnect、workflow.select、workflow.viewport.set。
参数契约：
- workflow.node.create: {type,title?,x?,y?,width?,height?,metadata?}
- workflow.node.create-connected: {fromNodeId,type,title?,x?,y?,width?,height?,metadata?}
- workflow.node.update: {nodeId,patch}，prompt/content/config 放在 patch.metadata 内
- workflow.node.delete/run/stop: {nodeId}
- workflow.node.move: {nodeId,x,y}；workflow.node.resize: {nodeId,width,height}
- workflow.connect: {fromNodeId,toNodeId}；workflow.disconnect: {connectionId}
- workflow.select: {ids}；workflow.viewport.set: {x,y,k}
节点类型仅限 text、image、video、audio、config。涉及已有节点时必须使用 Workflow JSON 中真实 id；信息不足时 commands 返回空数组并在 message 中说明。不要在参数中放 API Key、data URL、blob URL、storageKey 或本地路径。写操作会由用户确认并通过 Flovart dispatcher 执行。`;

export async function runWorkflowOnlineAgent(input: WorkflowOnlineTurnInput, runtime: WorkflowOnlineAgentRuntime) {
  const modelRef = runtime.modelPreference.textModel || findBestModelSelection(runtime.userApiKeys, 'text') || '';
  const resolved = resolveModelSelection(modelRef, runtime.userApiKeys, 'text');
  if (!resolved) throw new Error('网站 Agent 需要先配置可用的文本模型 API Key。');
  const attachmentContext = await describeAttachments(input, runtime, resolved.model, resolved.key);
  if (input.signal.aborted) throw new DOMException('Agent 已停止', 'AbortError');

  const recentMessages = input.messages.slice(-16).map(message => ({
    role: message.role,
    text: message.text.slice(0, 4000),
  }));
  const request = [
    `当前 Workflow：\n${JSON.stringify(redactWorkflowAgentValue(input.project)).slice(0, 60_000)}`,
    `最近对话：\n${JSON.stringify(recentMessages)}`,
    attachmentContext ? `附件视觉描述：\n${attachmentContext}` : '',
    `用户请求：\n${input.prompt || '请分析附件并给出下一步。'}`,
  ].filter(Boolean).join('\n\n');
  const raw = await (runtime.generateText || generateTextWithProvider)(request, resolved.model, resolved.key, {
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 3000,
    signal: input.signal,
  });
  const plan = parseWorkflowAgentPlan(raw);
  const results: Array<{ command: string; ok: boolean; message: string }> = [];
  for (const [index, item] of plan.commands.entries()) {
    if (input.signal.aborted) throw new DOMException('Agent 已停止', 'AbortError');
    const toolId = `online-tool-${crypto.randomUUID()}`;
    input.emit({ type: 'tool', id: toolId, title: item.command, text: '等待执行', detail: redactWorkflowAgentValue(item.args), status: 'pending' });
    const envelope: WorkflowCommandEnvelope = {
      id: crypto.randomUUID(),
      command: item.command,
      args: { projectId: input.project.id, ...(item.args || {}) },
      source: 'agent',
      idempotencyKey: `online:${input.project.id}:${index}:${crypto.randomUUID()}`,
    };
    let result = await (runtime.dispatch || dispatchWorkflowCommand)(envelope);
    if (result.confirmation?.required) {
      const approved = await input.confirm(result.confirmation.summary);
      result = approved
        ? await (runtime.dispatch || dispatchWorkflowCommand)({ ...envelope, args: { ...envelope.args, confirmed: true } })
        : denied(envelope.id);
    }
    const message = result.ok ? '执行完成' : result.error?.message || '执行失败';
    results.push({ command: item.command, ok: result.ok, message });
    input.emit({
      type: 'tool', id: toolId, title: item.command, text: message,
      detail: redactWorkflowAgentValue(result), status: result.ok ? 'success' : result.error?.code === 'DENIED' ? 'denied' : 'error',
    });
  }
  const resultSummary = results.length
    ? `\n\n${results.map(item => `${item.ok ? '已完成' : '未完成'} ${item.command}：${item.message}`).join('\n')}`
    : '';
  input.emit({ type: 'assistant', text: `${plan.message}${resultSummary}`.trim() || '已处理。' });
  input.emit({ type: 'done' });
}

async function describeAttachments(
  input: WorkflowOnlineTurnInput,
  runtime: WorkflowOnlineAgentRuntime,
  model: string,
  key: UserApiKey,
) {
  const describe = runtime.describeImage || reversePromptStreamWithProvider;
  const descriptions: string[] = [];
  for (const attachment of input.attachments) {
    if (input.signal.aborted) throw new DOMException('Agent 已停止', 'AbortError');
    try {
      const text = await describe(attachment.dataUrl, attachment.type, model, key, () => undefined, input.signal, 'zho');
      descriptions.push(`${attachment.name}：${text.slice(0, 5000)}`);
    } catch (error) {
      if (input.signal.aborted) throw error;
      descriptions.push(`${attachment.name}：视觉分析失败`);
    }
  }
  return descriptions.join('\n');
}

export function parseWorkflowAgentPlan(raw: string): WorkflowAgentPlan {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('网站 Agent 未返回可执行的结构化结果。');
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); }
  catch { throw new Error('网站 Agent 返回的命令格式无效。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('网站 Agent 返回的计划格式无效。');
  const record = value as Record<string, unknown>;
  const message = typeof record.message === 'string' ? record.message.trim() : '';
  const sourceCommands = Array.isArray(record.commands) ? record.commands.slice(0, 8) : [];
  const commands = sourceCommands.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`网站 Agent 的第 ${index + 1} 条命令格式无效。`);
    const command = String((item as Record<string, unknown>).command || '');
    const args = (item as Record<string, unknown>).args;
    if (!ALLOWED_COMMANDS.has(command)) throw new Error(`网站 Agent 请求了不允许的命令：${command}`);
    if (args !== undefined && (!args || typeof args !== 'object' || Array.isArray(args))) throw new Error(`命令 ${command} 的参数格式无效。`);
    return { command, args: args as Record<string, unknown> | undefined };
  });
  if (!message && !commands.length) throw new Error('网站 Agent 返回了空计划。');
  return { message, commands };
}

function denied(commandId: string): WorkflowCommandResult {
  return { ok: false, commandId, error: { code: 'DENIED', message: '用户拒绝了 Workflow 变更。' } };
}

export function isWorkflowOnlineMutation(command: string) {
  return WORKFLOW_MUTATION_COMMANDS.has(command);
}
