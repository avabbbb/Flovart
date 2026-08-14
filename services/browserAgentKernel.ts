// 浏览器内置 Flovart Agent 内核：直接用 pi-agent-core 在 Web 端跑 Agent，
// 不依赖外部 Managed Agent 服务。会话持久化到 localforage，模型走 OpenAI 兼容
// agent-text 线路（与桌面 Runtime 的 agent-text.route.sync 同源配置），
// 工具走浏览器侧 workflowDispatcher 命令面。
import { Agent, InMemorySessionStorage, toSession } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool, Session, StreamFn } from '@earendil-works/pi-agent-core';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import localforage from 'localforage';
import { Type } from 'typebox';
import { isOpenAICompatibleProvider, resolveProviderBaseUrl } from './baseUrl';
import { dispatchWorkflowCommand } from './workflowDispatcher';
import { getBundledProductionSkill, type ProductionSkillAttachment } from './productionSkillCatalog';
import { COMMAND_ALIASES, COMMAND_REGISTRY } from '../tools/flovart/core.js';
import type { UserApiKey } from '../types';

// ---------------------------------------------------------------------------
// 会话持久化：localforage 存 InMemorySessionStorage 的 metadata + entries
// ---------------------------------------------------------------------------

interface PersistedSession {
  metadata: { id: string; createdAt: string; metadata?: Record<string, unknown> };
  entries: unknown[];
}

const sessionKey = (projectId: string) => `flovart.agent.session.${projectId}`;

class BrowserSessionRepo {
  constructor(private readonly projectId: string) {}

  async create(options: { id?: string; metadata?: Record<string, unknown> } = {}): Promise<Session> {
    const metadata = {
      id: options.id ?? crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...(options.metadata ? { metadata: options.metadata } : {}),
    };
    const storage = new InMemorySessionStorage({ metadata: metadata as never });
    const session = toSession(storage);
    await this.persist(session);
    return session;
  }

  async open(metadata: { id: string }): Promise<Session> {
    const saved = await localforage.getItem<PersistedSession>(sessionKey(this.projectId));
    if (!saved) throw new Error(`Agent 会话不存在：${metadata.id}`);
    const storage = new InMemorySessionStorage({
      metadata: { ...saved.metadata, id: metadata.id } as never,
      entries: saved.entries as never[],
    });
    return toSession(storage);
  }

  async list(): Promise<Array<{ id: string; metadata?: Record<string, unknown> }>> {
    const saved = await localforage.getItem<PersistedSession>(sessionKey(this.projectId));
    return saved ? [{ id: saved.metadata.id, ...(saved.metadata.metadata ? { metadata: saved.metadata.metadata } : {}) }] : [];
  }

  async delete(): Promise<void> {
    await localforage.removeItem(sessionKey(this.projectId));
  }

  async persist(session: Session): Promise<void> {
    const storage = session.getStorage();
    const metadata = await storage.getMetadata();
    const entries = await storage.getEntries();
    await localforage.setItem(sessionKey(this.projectId), {
      metadata: metadata as { id: string; createdAt: string; metadata?: Record<string, unknown> },
      entries,
    });
  }
}

// ---------------------------------------------------------------------------
// 模型线路：与 runtimeAgentTextRoutes 同源过滤，浏览器本地解析
// ---------------------------------------------------------------------------

export interface BrowserAgentTextRoute {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
}

export function resolveBrowserAgentTextRoute(keys: UserApiKey[]): BrowserAgentTextRoute | null {
  const routes = keys
    .filter(key => (
      isOpenAICompatibleProvider(key.provider)
      && key.id
      && key.status !== 'error'
      && (!key.capabilities || key.capabilities.includes('text'))
    ))
    .flatMap(key => (key.routeMappings || [])
      .filter(mapping => mapping.target.kind === 'runtime-capability' && mapping.target.capability === 'agent-text')
      .map(mapping => ({
        key,
        model: mapping.routeId.trim(),
        sourceOrder: mapping.order,
        preferred: Boolean(key.isDefault),
      })))
    .filter(route => route.model)
    .sort((left, right) => (
      left.sourceOrder - right.sourceOrder
      || Number(right.preferred) - Number(left.preferred)
    ));
  const first = routes[0];
  if (!first) return null;
  return {
    provider: first.key.provider,
    model: first.model,
    baseUrl: resolveProviderBaseUrl(first.key.provider, first.key.baseUrl),
    apiKey: first.key.key,
  };
}

// ---------------------------------------------------------------------------
// OpenAI 兼容流式 StreamFn：SSE → AssistantMessageEventStream
// ---------------------------------------------------------------------------

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function hasContent(message: AgentMessage): message is Extract<AgentMessage, { content: unknown }> {
  return 'content' in message;
}

function textBlocks(message: AgentMessage): string {
  if (!hasContent(message)) return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map(block => block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : '')
    .filter(Boolean)
    .join('\n');
}

function toOpenAIMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === 'toolResult') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      content: message.isError ? `错误：${textBlocks(message)}` : textBlocks(message),
    };
  }
  if (message.role === 'assistant') {
    const content: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];
    if (hasContent(message)) {
      for (const block of message.content) {
        if (block.type === 'text') content.push({ type: 'text', text: block.text });
        else if (block.type === 'toolCall') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.arguments ?? {}) },
          });
        }
      }
    }
    return {
      role: 'assistant',
      content: content.length > 0 ? content : '',
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
  }
  if (!hasContent(message)) return { role: 'user', content: '' };
  if (typeof message.content === 'string') return { role: 'user', content: message.content };
  const parts: Array<Record<string, unknown>> = [];
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        parts.push({ type: 'text', text: block.text });
        break;
      case 'image': {
        const data = block.data;
        if (data) {
          parts.push({ type: 'image_url', image_url: { url: data.startsWith('data:') ? data : `data:${block.mimeType || 'image/png'};base64,${data}` } });
        }
        break;
      }
      default:
        break;
    }
  }
  return { role: 'user', content: parts };
}

export function createBrowserAgentStream(route: BrowserAgentTextRoute): StreamFn {
  return async (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    const startMessage: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: 'openai-compatible',
      provider: route.provider,
      model: route.model,
      usage: EMPTY_USAGE as AssistantMessage['usage'],
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    void (async () => {
      try {
        const response = await fetch(`${route.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${route.apiKey}`,
          },
          signal: options?.signal,
          body: JSON.stringify({
            model: route.model,
            messages: context.messages.map(toOpenAIMessage),
            ...(context.tools?.length ? {
              tools: context.tools.map(tool => ({
                type: 'function',
                function: { name: tool.name, description: tool.description, parameters: tool.parameters },
              })),
            } : {}),
            stream: true,
            temperature: 0.7,
            max_tokens: 16384,
          }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`模型请求失败（HTTP ${response.status}）：${body.slice(0, 200)}`);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new Error('模型没有返回流');
        const decoder = new TextDecoder();
        let buffer = '';
        let text = '';
        const toolCalls: Array<{ index: number; id?: string; name?: string; arguments?: string }> = [];
        let finishReason = '';

        const partial = () => {
          const content: AssistantMessage['content'] = [];
          if (text) content.push({ type: 'text', text });
          for (const toolCall of toolCalls) {
            if (!toolCall.id || !toolCall.name) continue;
            let argumentsValue: Record<string, unknown> = {};
            try { argumentsValue = toolCall.arguments ? JSON.parse(toolCall.arguments) : {}; } catch { /* 未完整时忽略 */ }
            content.push({ type: 'toolCall', id: toolCall.id, name: toolCall.name, arguments: argumentsValue });
          }
          return { ...startMessage, content };
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() || '';
          for (const block of blocks) {
            const dataLine = block.split(/\r?\n/).find(line => line.startsWith('data:'));
            if (!dataLine) continue;
            const data = dataLine.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let json: { choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }> };
            try { json = JSON.parse(data); } catch { continue; }
            const delta = json.choices?.[0]?.delta || {};
            if (typeof delta.content === 'string' && delta.content) {
              text += delta.content;
              stream.push({ type: 'text_delta', contentIndex: 0, delta: delta.content, partial: partial() });
            }
            const toolCallsDelta = delta.tool_calls;
            if (Array.isArray(toolCallsDelta)) {
              for (const piece of toolCallsDelta as Array<Record<string, unknown>>) {
                const index = Number(piece?.index ?? 0);
                const current = toolCalls[index] || { index };
                const fn = piece?.function as Record<string, unknown> | undefined;
                if (typeof piece?.id === 'string') current.id = piece.id;
                if (typeof fn?.name === 'string') current.name = fn.name;
                if (typeof fn?.arguments === 'string') current.arguments = (current.arguments || '') + fn.arguments;
                toolCalls[index] = current;
              }
            }
            if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
          }
        }
        const message: AssistantMessage = {
          ...partial(),
          stopReason: finishReason === 'tool_calls' ? 'toolUse' : 'stop',
          timestamp: Date.now(),
        };
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message });
        stream.end(message);
      } catch (error) {
        const aborted = Boolean(options?.signal?.aborted);
        const message: AssistantMessage = {
          ...startMessage,
          stopReason: aborted ? 'aborted' : 'error',
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        };
        stream.push({ type: 'error', reason: aborted ? 'aborted' : 'error', error: message });
        stream.end(message);
      }
    })();
    return stream;
  };
}

// ---------------------------------------------------------------------------
// 工具：复用命令面（与 mcp.js 同源：COMMAND_REGISTRY + COMMAND_ALIASES）
// ---------------------------------------------------------------------------

const WORKSPACE_WRITE_COMMANDS = new Set([
  'workflow.project.create', 'workflow.project.use', 'workflow.project.delete',
  'workflow.node.create', 'workflow.node.create-connected', 'workflow.node.update',
  'workflow.node.delete', 'workflow.node.move', 'workflow.node.resize',
  'workflow.node.tool',
  'workflow.connect', 'workflow.disconnect', 'workflow.select', 'workflow.viewport.set',
]);
const WORKSPACE_COMMANDS = new Set(['workflow.project.list', 'workflow.inspect', ...WORKSPACE_WRITE_COMMANDS]);
const PRODUCTION_COMMANDS = new Set([
  'runtime.status', 'provider.status', 'production.dry-run', 'production.status',
  'production.approve', 'production.run', 'task.get', 'task.cancel', 'workflow.projection.get',
]);
const BROWSER_AGENT_COMMANDS = [...WORKSPACE_COMMANDS, ...PRODUCTION_COMMANDS];

function browserToolName(command: string): string {
  const alias = Object.entries(COMMAND_ALIASES).find(([name, target]) => target === command && name.startsWith('flovart_'))?.[0];
  return alias || `flovart_${command.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

function descriptorSchema(descriptor: string) {
  const optional = descriptor.endsWith('?');
  const token = optional ? descriptor.slice(0, -1) : descriptor;
  let schema;
  if (token === 'number') schema = Type.Number();
  else if (token === 'boolean') schema = Type.Boolean();
  else if (token === 'object') schema = Type.Record(Type.String(), Type.Unknown());
  else if (token === 'array') schema = Type.Array(Type.Unknown());
  else if (token === 'string[]') schema = Type.Array(Type.String());
  else if (token.includes('|')) schema = Type.Union(token.split('|').map(value => Type.Literal(value)));
  else schema = Type.String();
  return optional ? Type.Optional(schema) : schema;
}

export interface BrowserAgentToolDependencies {
  projectId: string;
  /** 高风险操作（删除、付费、Production 运行等）的用户确认；返回 false 表示拒绝 */
  confirm: (summary: string) => Promise<boolean>;
  /** 当前 Agent 回合的幂等键（可逆写操作合并进同一 ChangeSet） */
  activeChangeSetId: string;
}

export function createBrowserAgentTools(dependencies: BrowserAgentToolDependencies): AgentTool[] {
  return BROWSER_AGENT_COMMANDS.map(command => {
    const definition = COMMAND_REGISTRY[command] || { args: {}, description: command };
    const args = (definition.args || {}) as Record<string, string>;
    const parameters = Type.Object(
      Object.fromEntries(Object.entries(args).map(([name, descriptor]) => [name, descriptorSchema(descriptor)])),
    );
    return {
      name: browserToolName(command),
      label: command,
      description: String(definition.description || command),
      parameters,
      execute: async (_toolCallId, params, _signal) => {
        const run = async (confirmed: boolean) => dispatchWorkflowCommand({
          id: crypto.randomUUID(),
          command,
          args: { ...(params as Record<string, unknown>), projectId: dependencies.projectId, ...(confirmed ? { confirmed: true } : {}) },
          source: 'agent',
          idempotencyKey: dependencies.activeChangeSetId,
        });
        let result = await run(false);
        if (result.confirmation?.required) {
          const approved = await dependencies.confirm(result.confirmation.summary);
          if (!approved) throw new Error('用户拒绝了该操作');
          result = await run(true);
        }
        if (!result.ok) {
          throw new Error(result.error?.message || `${command} 执行失败`);
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(result.result ?? { ok: true }) }],
          details: result,
        };
      },
    };
  });
}

// ---------------------------------------------------------------------------
// 内核：复刻 agent/kernel.js 的生命周期，浏览器实现（持久化/流/工具）
// ---------------------------------------------------------------------------

const BROWSER_DEFAULT_SYSTEM_PROMPT = `你是 Flovart Agent，负责把用户的创作目标整理为可审查的制作计划。
你只能使用已注册的 Flovart 制作工具，不得访问 Shell、任意文件或 Provider Secret。
处理当前项目时先调用 flovart_workflow_inspect，不得猜测项目、节点或连接 ID。
写操作必须使用稳定的 idempotencyKey；只有工具返回成功后，才能声称 Workflow 已发生变化。
可逆的 Workflow Draft 修改会直接落到用户当前可见的同一画布，并合并为本轮 ChangeSet；每次修改后读取工具返回的 draftVersion/objectVersions，再继续下一步。
不得用 CLI、文件桥或直接 generate 命令在后台另做一份结果。
删除、付费执行、Production 审批和运行会要求用户确认，不得绕过；普通可逆布局和节点编辑无需逐次确认。
没有足够信息时先说明缺口；没有用户确认的 Production Mandate 时不得声称付费制作已经开始。
Web 模式下 Production Runtime 不可用，production 相关命令会失败并返回明确错误；此时改用 Workflow 节点工具完成可逆编排。`;

const PRODUCTION_SKILL_BINDING_ENTRY = 'flovart.production-skill-binding';

function snapshotMessage(entry: { type: string; id: string; message?: AgentMessage; customType?: string }): {
  id: string;
  role: string;
  text: string;
  toolName?: string;
  isError?: boolean;
  timestamp?: number;
  error?: string;
} {
  const message = entry.message;
  if (message && message.role === 'toolResult') {
    return {
      id: entry.id,
      role: 'tool',
      text: textBlocks(message),
      toolName: (message as { toolName?: string }).toolName,
      isError: Boolean((message as { isError?: boolean }).isError),
      timestamp: (message as { timestamp?: number }).timestamp,
    };
  }
  return {
    id: entry.id,
    role: message?.role ?? 'message',
    text: message ? textBlocks(message) : '',
    timestamp: message ? (message as { timestamp?: number }).timestamp : undefined,
    error: (message as { errorMessage?: string } | undefined)?.errorMessage,
  };
}

export interface BrowserAgentKernelOptions {
  projectId: string;
  route: BrowserAgentTextRoute;
  tools: AgentTool[];
  confirm: (summary: string) => Promise<boolean>;
  systemPrompt?: string;
  skillAttachment?: ProductionSkillAttachment | null;
}

export class BrowserAgentKernel {
  private repo: BrowserSessionRepo | null = null;
  private session: Session | null = null;
  private agent: Agent | null = null;
  private unsubscribe: (() => void) | null = null;
  private listeners = new Set<(event: { type: string; [key: string]: unknown }) => void>();
  private activeChangeSetId = '';
  private boundProductionSkill: ProductionSkillAttachment | null = null;
  private productionSkillBindingError: string | null = null;
  private systemPrompt: string;
  private readonly projectId: string;
  private readonly route: BrowserAgentTextRoute;
  private readonly tools: AgentTool[];
  private readonly confirm: (summary: string) => Promise<boolean>;
  private readonly initialSkillAttachment: ProductionSkillAttachment | null;

  constructor(options: BrowserAgentKernelOptions) {
    this.projectId = options.projectId;
    this.route = options.route;
    this.tools = options.tools;
    this.confirm = options.confirm;
    this.initialSkillAttachment = options.skillAttachment ?? null;
    this.systemPrompt = options.systemPrompt ?? BROWSER_DEFAULT_SYSTEM_PROMPT;
  }

  subscribe(listener: (event: { type: string; [key: string]: unknown }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: { type: string; [key: string]: unknown }) {
    for (const listener of this.listeners) void listener(event);
  }

  async openSession(): Promise<unknown> {
    if (this.session) return this.snapshot();
    this.repo = new BrowserSessionRepo(this.projectId);
    const sessions = await this.repo.list();
    const metadata = sessions.find(item => item.metadata?.projectId === this.projectId && item.metadata.role === 'main');
    this.session = metadata
      ? await this.repo.open({ id: metadata.id })
      : await this.repo.create({ metadata: { projectId: this.projectId, role: 'main' } });

    const entries = await this.session.getBranch();
    const persistedBinding = [...entries].reverse().find((entry): entry is Extract<typeof entry, { type: 'custom'; customType: string; data?: unknown }> => (
      entry.type === 'custom' && entry.customType === PRODUCTION_SKILL_BINDING_ENTRY
    ));
    if (persistedBinding?.data) {
      try {
        const data = persistedBinding.data as ProductionSkillAttachment;
        if (data?.id && data?.version && data?.contentHash) this.boundProductionSkill = data;
      } catch (error) {
        this.productionSkillBindingError = error instanceof Error ? error.message : String(error);
      }
    }

    const context = await this.session.buildContext();
    const wrappedTools = this.tools.map(tool => tool.execute ? {
      ...tool,
      execute: (toolCallId: string, input: Record<string, unknown>, signal: AbortSignal | undefined) => tool.execute(toolCallId, {
        ...input,
        ...(this.activeChangeSetId ? { changeSetId: this.activeChangeSetId } : {}),
      }, signal),
    } : tool);

    const skillContext = this.boundProductionSkill
      ? (() => {
          const bundled = getBundledProductionSkill(this.boundProductionSkill!.id);
          return bundled ? `\n\n${bundled.skillSource.slice(0, 2000)}` : `\n\n${this.boundProductionSkill!.displayName}`;
        })()
      : '';

    this.agent = new Agent({
      initialState: {
        systemPrompt: this.boundProductionSkill ? `${this.systemPrompt}${skillContext}` : this.systemPrompt,
        model: {
          id: this.route.model,
          name: this.route.model,
          api: 'openai-compatible',
          provider: this.route.provider,
          baseUrl: this.route.baseUrl,
          reasoning: false,
          input: ['text', 'image'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
        } as never,
        tools: wrappedTools as never,
        messages: context.messages,
      },
      streamFn: createBrowserAgentStream(this.route),
      beforeToolCall: async ({ toolCall }) => (
        this.tools.some(tool => tool.name === toolCall.name)
          ? undefined
          : { block: true, reason: `未注册的 Flovart 工具：${toolCall.name}` }
      ),
    });

    this.unsubscribe = this.agent.subscribe(async event => {
      if (event.type === 'message_end') {
        await this.session?.appendMessage((event as { message: AgentMessage }).message);
        if (this.session) await this.repo?.persist(this.session);
      }
      this.emit(event as { type: string; [key: string]: unknown });
    });
    return this.snapshot();
  }

  async send(text: string, images: string[] = [], skillAttachment?: ProductionSkillAttachment | null): Promise<unknown> {
    if (!this.agent || !this.session) throw new Error('Flovart Agent session is not open');
    const prompt = String(text || '').trim();
    if (!prompt && images.length === 0) throw new Error('Flovart Agent message is empty');
    this.activeChangeSetId = crypto.randomUUID();

    if (skillAttachment === null) {
      if (this.boundProductionSkill) {
        this.boundProductionSkill = null;
        this.productionSkillBindingError = null;
        this.agent.state.systemPrompt = this.systemPrompt;
        await this.session.appendCustomEntry(PRODUCTION_SKILL_BINDING_ENTRY, null);
      }
    } else if (skillAttachment) {
      const changed = !this.boundProductionSkill
        || this.boundProductionSkill.id !== skillAttachment.id
        || this.boundProductionSkill.version !== skillAttachment.version
        || this.boundProductionSkill.contentHash !== skillAttachment.contentHash;
      this.boundProductionSkill = skillAttachment;
      this.productionSkillBindingError = undefined;
      const bundled = getBundledProductionSkill(skillAttachment.id);
      this.agent.state.systemPrompt = `${this.systemPrompt}\n\n${bundled ? bundled.skillSource.slice(0, 2000) : skillAttachment.displayName}`;
      if (changed) await this.session.appendCustomEntry(PRODUCTION_SKILL_BINDING_ENTRY, {
        id: skillAttachment.id,
        version: skillAttachment.version,
        contentHash: skillAttachment.contentHash,
        displayName: skillAttachment.displayName,
        trustTier: skillAttachment.trustTier,
      });
    }

    await this.session.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      timestamp: Date.now(),
    } as never);
    await this.repo?.persist(this.session);
    await this.agent.prompt(prompt);
    if (this.session) await this.repo?.persist(this.session);
    return this.snapshot();
  }

  cancel(): void {
    this.agent?.abort();
  }

  async snapshot(): Promise<{
    sessionId: string;
    projectId: string;
    boundProductionSkill: ProductionSkillAttachment | null;
    productionSkillBindingError: string | null;
    messages: Array<ReturnType<typeof snapshotMessage>>;
    running: boolean;
  }> {
    if (!this.session) throw new Error('Flovart Agent session is not open');
    const metadata = await this.session.getMetadata();
    const entries = await this.session.getBranch();
    return {
      sessionId: metadata.id,
      projectId: this.projectId,
      boundProductionSkill: this.boundProductionSkill,
      productionSkillBindingError: this.productionSkillBindingError,
      messages: entries
        .filter(entry => entry.type === 'message')
        .map(snapshotMessage)
        .filter(message => message.role !== 'assistant' || message.text || message.error),
      running: Boolean(this.agent?.state.isStreaming),
    };
  }

  async close(): Promise<void> {
    this.agent?.abort();
    this.unsubscribe?.();
    this.agent = null;
    this.session = null;
    this.repo = null;
  }
}
