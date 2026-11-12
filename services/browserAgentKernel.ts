import { readSseEvents } from './sse';
import { commitStreamUsage, createStreamUsageAccumulator, streamOutcome } from './streamUsage';
import { fetchStreamWithUsageOptIn, type StreamUsageMode } from './streamUsageOptIn';
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
import { resolveAgentTextRoutes } from './agentTextRoutes';
import { createBrowserWorkflowContract } from './browserWorkflowContract';
import { withWorkflowHumanApproval, workflowCommandNeedsConfirmation } from './workflowDispatcher';
import { getBundledProductionSkill, type ProductionSkillAttachment } from './productionSkillCatalog';
import { workflowConfirmRequest } from './workflowAgentBridge';
import type { AgentConfirmRequest } from './agentSpendMandate';
import { COMMAND_ALIASES, COMMAND_REGISTRY } from '../tools/flovart/core.js';
import { AGENT_BROWSER_COMMANDS } from '../tools/flovart/agent-surface.js';
import { WORKFLOW_APPLY_GUIDE, WORKFLOW_OPERATIONS_SCHEMA } from '../tools/flovart/workflow-operation-schema.js';
import { createTodoTool, TODO_TOOL_NAME } from '../agent/todo.js';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { WorkflowNode } from '../components/workflow/types';
import { loadAgentNodeMedia, type AgentVideoFrame } from './agentMediaView';
import { WORKFLOW_OPERATION_CAPABILITIES, WORKFLOW_OPERATION_CAPABILITY_IDS, WORKFLOW_OPERATION_NODE_TOOLS } from '../components/workflow/operationRegistry';
import { formatSearchSources, searchAgentWeb, WEB_SEARCH_TOOL_NAME, type AgentSearchCredential, type SearchRecency } from './agentWebSearch';
import { formatGrepMatches, grepLocalFolders, LOCAL_GREP_TOOL_NAME } from './agentLocalGrep';
import { decideToolCall, toolRiskFor, type ApprovalPolicy, type SandboxPolicy } from './agentToolPolicy';
import type { UserApiKey } from '../types';
import { displayError } from './displayError';

// ---------------------------------------------------------------------------
// 会话持久化：localforage 存 InMemorySessionStorage 的 metadata + entries
// ---------------------------------------------------------------------------

interface LegacyPersistedSession {
  metadata: { id: string; createdAt: string; metadata?: Record<string, unknown> };
  entries: unknown[];
}

interface PersistedSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  entries: unknown[];
}

// 旧版单会话存储 key（flovart.agent.session.<projectId>），迁移后删除
const sessionKey = (projectId: string) => `flovart.agent.session.${projectId}`;
// 每个项目保存一个会话列表（含历史对话），key 形如 flovart.agent.sessions.<projectId>
const sessionsKey = (projectId: string) => `flovart.agent.sessions.${projectId}`;

/** 从会话第一条用户消息派生标题，最多取 24 字。 */
function deriveTitle(entries: unknown[]): string {
  for (const entry of entries as Array<{ type?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } }>) {
    if (entry?.type === 'message' && entry.message?.role === 'user') {
      const text = (entry.message.content || []).filter(block => block.type === 'text').map(block => block.text || '').join(' ').trim();
      if (text) return text.slice(0, 24) || '新对话';
    }
  }
  return '新对话';
}

class BrowserSessionStore {
  constructor(private readonly projectId: string) {}

  async loadAll(): Promise<PersistedSession[]> {
    const saved = await localforage.getItem<PersistedSession[]>(sessionsKey(this.projectId));
    return Array.isArray(saved) ? saved : [];
  }

  async saveAll(sessions: PersistedSession[]): Promise<void> {
    await localforage.setItem(sessionsKey(this.projectId), sessions);
  }

  /** 迁移旧版单会话 key（flovart.agent.session.<id>），只迁移一次。 */
  async migrateLegacy(): Promise<PersistedSession[]> {
    const legacy = await localforage.getItem<LegacyPersistedSession>(sessionKey(this.projectId));
    if (!legacy) return this.loadAll();
    const sessions = await this.loadAll();
    if (!sessions.some(item => item.id === legacy.metadata.id)) {
      sessions.unshift({
        id: legacy.metadata.id,
        title: deriveTitle(legacy.entries || []),
        createdAt: legacy.metadata.createdAt,
        updatedAt: legacy.metadata.createdAt,
        metadata: legacy.metadata.metadata,
        entries: legacy.entries || [],
      });
      await this.saveAll(sessions);
    }
    await localforage.removeItem(sessionKey(this.projectId));
    return sessions;
  }
}

class BrowserSessionRepo {
  constructor(private readonly projectId: string, private readonly store = new BrowserSessionStore(projectId)) {}

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
    const sessions = await this.store.migrateLegacy();
    const saved = sessions.find(item => item.id === metadata.id);
    if (!saved) throw new Error(`Agent 会话不存在：${metadata.id}`);
    const storage = new InMemorySessionStorage({
      metadata: { id: saved.id, createdAt: saved.createdAt, metadata: saved.metadata } as never,
      entries: saved.entries as never[],
    });
    return toSession(storage);
  }

  async list(): Promise<Array<{ id: string; title: string; createdAt: string; updatedAt: string; metadata?: Record<string, unknown> }>> {
    const sessions = await this.store.migrateLegacy();
    return sessions.map(({ id, title, createdAt, updatedAt, metadata }) => ({ id, title, createdAt, updatedAt, metadata }));
  }

  async delete(sessionId?: string): Promise<void> {
    if (!sessionId) { await localforage.removeItem(sessionsKey(this.projectId)); return; }
    const sessions = await this.store.loadAll();
    await this.store.saveAll(sessions.filter(item => item.id !== sessionId));
  }

  async persist(session: Session): Promise<void> {
    const storage = session.getStorage();
    const metadata = await storage.getMetadata();
    const entries = (await storage.getEntries()) as unknown[];
    const sessions = await this.store.migrateLegacy();
    const now = new Date().toISOString();
    const next = sessions.filter(item => item.id !== metadata.id);
    // 自定义 metadata 存在 InMemorySessionStorage 构造参数里，getMetadata 只返回 id/createdAt；
    // 从既有列表找回该会话的自定义字段，找不到视为无。
    const existing = sessions.find(item => item.id === metadata.id);
    next.unshift({
      id: String(metadata.id || crypto.randomUUID()),
      title: deriveTitle(entries),
      createdAt: String(metadata.createdAt || now),
      updatedAt: now,
      metadata: existing?.metadata,
      entries,
    });
    await this.store.saveAll(next);
  }
}

// ---------------------------------------------------------------------------
// 模型线路：与 runtimeAgentTextRoutes 同源过滤，浏览器本地解析
// ---------------------------------------------------------------------------

export interface BrowserAgentTextRoute {
  provider: string;
  model: string;
  /** 来自 Key 的流式 usage opt-in；缺省 passive，不改请求。 */
  streamUsage?: StreamUsageMode;
  baseUrl: string;
  apiKey: string;
}

export function resolveBrowserAgentTextRoute(keys: UserApiKey[]): BrowserAgentTextRoute | null {
  // 显式 agent-text 映射优先；没有时回退到默认文本 Key 的默认模型（见 agentTextRoutes）。
  const first = resolveAgentTextRoutes(keys)[0];
  if (!first) return null;
  return {
    provider: first.key.provider,
    model: first.model,
    baseUrl: first.baseUrl,
    apiKey: first.key.key,
    ...(first.key.streamUsage === 'request' ? { streamUsage: 'request' as const } : {}),
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

function imagePart(block: { data?: string; mimeType?: string }): Record<string, unknown> | null {
  const data = block.data;
  if (!data) return null;
  return { type: 'image_url', image_url: { url: data.startsWith('data:') ? data : 'data:' + (block.mimeType || 'image/png') + ';base64,' + data } };
}

/** 工具结果里的图片：OpenAI tool 消息只收文本，图片要放进紧随其后的 user 消息。 */
function toolResultImageParts(message: AgentMessage): Array<Record<string, unknown>> {
  if (message.role !== 'toolResult' || !hasContent(message) || typeof message.content === 'string') return [];
  const parts: Array<Record<string, unknown>> = [];
  for (const block of message.content) {
    if (block.type !== 'image') continue;
    const part = imagePart(block);
    if (part) parts.push(part);
  }
  return parts;
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
        const part = imagePart(block);
        if (part) parts.push(part);
        break;
      }
      default:
        break;
    }
  }
  return { role: 'user', content: parts };
}

const ORPHAN_TOOL_RESULT = '已取消：本次工具调用未执行完成（用户停止或会话中断）。';

/**
 * OpenAI 兼容接口要求每个 assistant.tool_calls 都紧跟对应的 tool 消息。
 * 停止、拒绝确认或刷新中断后会话里会留下没有结果的 toolCall，下一轮请求会被整体拒绝；
 * 这里在发送前补齐合成结果，不改写已持久化的会话。
 */
export function toOpenAIMessages(messages: AgentMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let pending: string[] = [];
  // 本批工具结果里的图片：等对应 tool 消息全部补齐后作为一条 user 消息追加，不打断 tool_calls 配对。
  let pendingImages: Array<Record<string, unknown>> = [];
  const emitImages = () => {
    if (pendingImages.length === 0) return;
    out.push({ role: 'user', content: [{ type: 'text', text: '以上工具调用返回的画面：' }, ...pendingImages] });
    pendingImages = [];
  };
  const flush = () => {
    for (const id of pending) out.push({ role: 'tool', tool_call_id: id, content: ORPHAN_TOOL_RESULT });
    pending = [];
    emitImages();
  };
  for (const message of messages) {
    const converted = toOpenAIMessage(message);
    if (converted.role === 'tool') {
      const id = String(converted.tool_call_id || '');
      if (!pending.includes(id)) continue; // 没有对应 tool_call 的孤立结果同样会被拒绝，丢弃。
      pending = pending.filter(item => item !== id);
      out.push(converted);
      pendingImages.push(...toolResultImageParts(message));
      if (pending.length === 0) emitImages();
      continue;
    }
    flush();
    out.push(converted);
    const calls = converted.tool_calls as Array<{ id?: string }> | undefined;
    if (calls?.length) pending = calls.map(call => String(call.id || '')).filter(Boolean);
  }
  flush();
  return out;
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
        const response = await fetchStreamWithUsageOptIn(`${route.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${route.apiKey}`,
          },
          signal: options?.signal,
        }, {
          model: route.model,
          messages: toOpenAIMessages(context.messages),
          ...(context.tools?.length ? {
            tools: context.tools.map(tool => ({
              type: 'function',
              function: { name: tool.name, description: tool.description, parameters: tool.parameters },
            })),
          } : {}),
          stream: true,
          // 工具选择与参数需要可复现，与 aiGateway 的 STABLE_TEXT_TEMPERATURE 保持一致。
          temperature: 0.2,
          max_tokens: 16384,
        }, route.streamUsage);
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`模型请求失败（HTTP ${response.status}）：${body.slice(0, 200)}`);
        }
        if (!response.body) throw new Error('模型没有返回流');
        let text = '';
        const toolCalls: Array<{ index: number; id?: string; name?: string; arguments?: string }> = [];
        let finishReason = '';

        const invalidToolCalls: string[] = [];
        const partial = (strict = false) => {
          const content: AssistantMessage['content'] = [];
          if (text) content.push({ type: 'text', text });
          for (const toolCall of toolCalls) {
            if (!toolCall.id || !toolCall.name) continue;
            let argumentsValue: Record<string, unknown> = {};
            try {
              argumentsValue = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
            } catch {
              // 流式中途参数未完整属正常；最终消息仍无法解析时拒绝执行，绝不以 {} 调用工具。
              if (strict) {
                invalidToolCalls.push(toolCall.name);
                continue;
              }
            }
            content.push({ type: 'toolCall', id: toolCall.id, name: toolCall.name, arguments: argumentsValue });
          }
          return { ...startMessage, content };
        };

        const usage = createStreamUsageAccumulator('openai');
        const usageMeta = { provider: String(route.provider), model: route.model, source: 'browser-agent' };
        try {
          for await (const event of readSseEvents(response)) {
            const data = event.data.trim();
            if (!data || data === '[DONE]') continue;
            let json: { choices?: Array<{ delta?: Record<string, unknown>; finish_reason?: string | null }>; usage?: unknown };
            try { json = JSON.parse(data); } catch { continue; }
            usage.feed(json);
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
        } catch (error) {
          commitStreamUsage(usageMeta, usage, streamOutcome(error, options?.signal));
          throw error;
        }
        commitStreamUsage(usageMeta, usage, 'ok');
        const finalMessage = partial(true);
        if (invalidToolCalls.length) {
          const truncated = finishReason === 'length' ? '，输出被 max_tokens 截断' : '';
          throw new Error('模型返回的工具参数不完整或不是合法 JSON（' + invalidToolCalls.join('、') + truncated + '），未执行任何工具，画布未改动。');
        }
        const message: AssistantMessage = {
          ...finalMessage,
          stopReason: finishReason === 'tool_calls' ? 'toolUse' : finishReason === 'length' ? 'length' : 'stop',
          timestamp: Date.now(),
        };
        stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message });
        stream.end(message);
      } catch (error) {
        const aborted = Boolean(options?.signal?.aborted);
        const message: AssistantMessage = {
          ...startMessage,
          stopReason: aborted ? 'aborted' : 'error',
          errorMessage: displayError(error),
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

export interface AgentAskRequest {
  /** 与 omp ask 相同：一个 HTML <form>，控件必须带 name。 */
  html: string;
}

export type AgentAskResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }
  | { ok: false; cancelled: true };

export interface BrowserAgentToolDependencies {
  projectId: string;
  /** 高风险操作（删除、付费、Production 运行等）的用户确认；返回 false 表示拒绝 */
  confirm: (summary: string, request?: AgentConfirmRequest) => Promise<boolean>;
  /** 结构化提问；提供时注册 flovart_ask（与 omp ask 的 HTML form 契约一致） */
  ask?: (request: AgentAskRequest) => Promise<AgentAskResult>;
  /** 当前 Agent 回合的幂等键（可逆写操作合并进同一 ChangeSet） */
  activeChangeSetId: string;
  /** 读取当前画布节点；提供时注册 flovart_workflow_media_view，让 Agent 看图片/视频的真实画面 */
  getNodes?: () => readonly WorkflowNode[];
  /** DeepSeek 搜索凭证；提供时注册 flovart_web_search */
  webSearch?: AgentSearchCredential;
  /** 当前工具策略；提供时每次调用前按沙箱/审批判定 allow / ask / deny */
  getPolicy?: () => { sandbox: SandboxPolicy; approval: ApprovalPolicy };
}

export function createBrowserAgentTools(dependencies: BrowserAgentToolDependencies): AgentTool[] {
  const workflowContract = createBrowserWorkflowContract();
  // 调用前先过策略层：deny 直接拒绝；ask 时先问用户，命令面自己会问的（删除、付费）不重复弹窗。
  const guard = async (command: string, params: Record<string, unknown>) => {
    const policy = dependencies.getPolicy?.();
    if (!policy) return;
    const risk = toolRiskFor(command, params);
    const verdict = decideToolCall({ ...policy, risk });
    if (verdict.decision === 'deny') throw new Error(verdict.reason);
    if (verdict.decision === 'allow') return;
    if (workflowCommandNeedsConfirmation(command, params)) return;
    const approved = await dependencies.confirm(verdict.summary, {
      kind: risk === 'delete' ? 'destructive' : 'other',
      command,
      args: params,
      risk,
    });
    if (!approved) throw new Error('用户拒绝了该操作');
  };
  // 命令面工具共用的一次调用：策略层 → 浏览器契约 → 需要时请用户确认后带批准重发。
  const runCommand = async (command: string, params: Record<string, unknown>) => {
    const envelope = {
      id: crypto.randomUUID(),
      command,
      args: {
        ...params,
        projectId: dependencies.projectId,
        workspaceMode: 'browser',
      },
      source: 'agent',
      idempotencyKey: dependencies.activeChangeSetId,
    } as const;
    await guard(command, params);
    let result = await workflowContract.dispatch(envelope);
    if (result.confirmation?.required) {
      const approved = await dependencies.confirm(result.confirmation.summary, workflowConfirmRequest(envelope));
      if (!approved) throw new Error('用户拒绝了该操作');
      result = await workflowContract.dispatch(withWorkflowHumanApproval(envelope));
    }
    if (!result.ok) {
      throw new Error(result.error?.message || `${command} 执行失败`);
    }
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result.result ?? { ok: true }) }],
      details: result,
    };
  };
  const commandTools: AgentTool[] = AGENT_BROWSER_COMMANDS.map(command => {
    const definition = COMMAND_REGISTRY[command] || { args: {}, summary: command };
    const args = (definition.args || {}) as Record<string, string>;
    // workflow.apply 的 operations 用完整的按 type 区分的 schema，模型不必猜写法。
    const argumentSchema = (name: string, descriptor: string) => (
      command === 'workflow.apply' && name === 'operations'
        ? Type.Unsafe<unknown[]>({ ...WORKFLOW_OPERATIONS_SCHEMA })
        : descriptorSchema(descriptor)
    );
    const parameters = Type.Object(
      Object.fromEntries(Object.entries(args).map(([name, descriptor]) => [name, argumentSchema(name, descriptor)])),
    );
    const summary = String(definition.summary || command);
    return {
      name: browserToolName(command),
      label: command,
      description: command === 'workflow.apply' ? summary + ' ' + WORKFLOW_APPLY_GUIDE : summary,
      parameters,
      execute: async (_toolCallId, params, _signal) => runCommand(command, params as Record<string, unknown>),
    };
  });
  const extraTools: AgentTool[] = [];
  extraTools.push(createWebSearchTool(dependencies.webSearch, guard));
  extraTools.push(createLocalGrepTool(guard));
  extraTools.push(createNodeToolTool(runCommand));
  if (dependencies.ask) extraTools.push(createAskTool(dependencies.ask));
  if (dependencies.getNodes) extraTools.push(createMediaViewTool(dependencies.getNodes));
  return [...commandTools, ...extraTools];
}

function createWebSearchTool(credential: AgentSearchCredential | undefined, guard: (command: string, params: Record<string, unknown>) => Promise<void>): AgentTool {
  const recency = Type.Union([Type.Literal('day'), Type.Literal('week'), Type.Literal('month'), Type.Literal('year')]);
  return {
    name: WEB_SEARCH_TOOL_NAME,
    label: 'web.search',
    description: '联网搜索（Parallel 公共 MCP，免 Key；失败自动回退 DeepSeek）。返回标题、URL、日期与摘要。query 支持 site:、-site:、引号短语、after:/before:；recency 可选 day/week/month/year；limit 1-40，默认 10。用于查资料、竞品、风格与事实核对。',
    parameters: Type.Object({
      query: Type.String({ description: '搜索词，最长 128 字符' }),
      recency: Type.Optional(recency),
      limit: Type.Optional(Type.Number({ description: '结果条数 1-50' })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const input = params as { query: string; recency?: SearchRecency; limit?: number };
      await guard(WEB_SEARCH_TOOL_NAME, input as unknown as Record<string, unknown>);
      const result = await searchAgentWeb({ query: input.query, recency: input.recency, limit: input.limit, signal, credential });
      return {
        content: [{ type: 'text', text: formatSearchSources(result.sources) }],
        details: { provider: result.provider, sources: result.sources },
      };
    },
  };
}

function createLocalGrepTool(guard: (command: string, params: Record<string, unknown>) => Promise<void>): AgentTool {
  return {
    name: LOCAL_GREP_TOOL_NAME,
    label: 'files.grep',
    description: '本地文件搜索（grep）：在用户连接过的本地文件夹里逐行匹配文本文件，返回 [文件夹/路径] 与 *行号|内容。pattern 是正则（非法时按字面量）；path 可限定子目录；case=false 忽略大小写；limit 默认 200。只搜文本文件，单文件上限 512KB，30s 超时。',
    parameters: Type.Object({
      pattern: Type.String({ description: '正则或字面量搜索词' }),
      path: Type.Optional(Type.String({ description: '文件夹内的子目录，例如 references/shots' })),
      case: Type.Optional(Type.Boolean({ description: '是否区分大小写，默认 true' })),
      limit: Type.Optional(Type.Number({ description: '最多返回多少条匹配，默认 200' })),
    }),
    execute: async (_toolCallId, params, signal) => {
      const input = params as { pattern: string; path?: string; case?: boolean; limit?: number };
      await guard(LOCAL_GREP_TOOL_NAME, input as unknown as Record<string, unknown>);
      const result = await grepLocalFolders({
        pattern: input.pattern,
        path: input.path,
        caseSensitive: input.case,
        limit: input.limit,
        signal,
      });
      return {
        content: [{ type: 'text', text: formatGrepMatches(result) }],
        details: { matchCount: result.matches.length, scannedFiles: result.scannedFiles, truncated: result.truncated, skippedFolders: result.skippedFolders },
      };
    },
  };
}

export const NODE_TOOL_TOOL_NAME = 'flovart_workflow_node_tool';

/** 画布后处理工具清单，直接来自 Operation 注册表：以后新增的工具不需要再改 Agent。 */
export function describeWorkflowNodeTools(): string {
  const operationTools = WORKFLOW_OPERATION_CAPABILITY_IDS
    .map(id => WORKFLOW_OPERATION_CAPABILITIES[id])
    .filter(capability => capability.nodeTool)
    .map(capability => {
      const cost = capability.executor === 'local-transform' ? '本地处理，免费' : '调用 AI 服务，会先请用户确认';
      return `- ${capability.nodeTool}：${capability.label}（${capability.mediaType}，${cost}）${capability.agentUsage ? '；' + capability.agentUsage : ''}`;
    });
  return [...operationTools, '- reverse-prompt：反推提示词（image/video，调用视觉模型，把结果写回节点 prompt）', '- filter：图片滤镜（image，参数 filters：{ brightness, contrast, saturation, ... }，只改节点显示参数）', '- outpaint：扩展画面（image，参数 direction/amount/prompt；direction 为 left/right/top/bottom/all）', '- mask：蒙版编辑（image，参数 prompt + maskNodeId 或 maskHref/maskMimeType；生成新的结果图）'].join('\n');
}

function createNodeToolTool(runCommand: (command: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: unknown }>): AgentTool {
  const optionalNumber = (description: string) => Type.Optional(Type.Number({ description }));
  return {
    name: NODE_TOOL_TOOL_NAME,
    label: 'workflow.node.tool',
    description: '在画布节点上执行后处理工具（与节点工具条按钮同一实现），结果作为新节点写回画布并自动连线，返回 outputNodeIds。先用 inspect 拿到节点 ID；视频截帧前可先用 media_view 的 times 找准时间点。可用工具：\n' + describeWorkflowNodeTools(),
    parameters: Type.Object({
      nodeId: Type.String({ description: '源节点 ID（video-merge 可省略，改用 sourceNodeIds）' }),
      tool: Type.Union([...WORKFLOW_OPERATION_NODE_TOOLS.map(tool => Type.Literal(tool)), Type.Literal('reverse-prompt'), Type.Literal('filter'), Type.Literal('outpaint'), Type.Literal('mask')]),
      position: Type.Optional(Type.Union([Type.Literal('first'), Type.Literal('current'), Type.Literal('last')], { description: 'video-extract-frame：first 首帧 / last 尾帧 / current 指定秒数' })),
      currentTimeSec: optionalNumber('video-extract-frame 的 position=current 时截取的秒数，例如 10'),
      startSec: optionalNumber('剪辑开始秒数'),
      endSec: optionalNumber('剪辑结束秒数'),
      sourceNodeIds: Type.Optional(Type.Array(Type.String(), { description: 'video-merge 的有序视频节点 ID' })),
      audio: Type.Optional(Type.Union([Type.Literal('full'), Type.Literal('vocals'), Type.Literal('background')])),
      prompt: Type.Optional(Type.String()),
      filters: Type.Optional(Type.Record(Type.String(), Type.Number(), { description: 'filter：亮度/对比度/饱和度等数值' })),
      maskNodeId: Type.Optional(Type.String()),
      maskHref: Type.Optional(Type.String()),
      maskMimeType: Type.Optional(Type.String()),
      direction: Type.Optional(Type.String({ description: 'outpaint：left/right/top/bottom/all' })),
      amount: optionalNumber('outpaint 扩展幅度 0.05-2'),
      targetLongEdge: optionalNumber('upscale 目标长边 512-8192'),
      algorithm: Type.Optional(Type.String()),
      action: Type.Optional(Type.String({ description: 'rotate：rotate-90/rotate-180/rotate-270/flip-h/flip-v' })),
      rows: optionalNumber('split-grid 行数 1-6'),
      cols: optionalNumber('split-grid 列数 1-6'),
      speed: optionalNumber('audio-speed 倍速 0.25-4'),
      x: optionalNumber('crop 归一化左边'),
      y: optionalNumber('crop 归一化上边'),
      width: optionalNumber('crop 归一化宽度'),
      height: optionalNumber('crop 归一化高度'),
      style: Type.Optional(Type.String()),
      count: optionalNumber('layer 候选数量 1-4'),
    }),
    execute: async (_toolCallId, params) => {
      const input = { ...(params as Record<string, unknown>) };
      if (input.tool === 'video-merge' && !input.nodeId && Array.isArray(input.sourceNodeIds)) input.nodeId = input.sourceNodeIds[0];
      return runCommand('workflow.node.tool', input);
    },
  };
}

export const ASK_TOOL_NAME = 'flovart_ask';

/** omp ask 的浏览器版：模型给一个 <form>，宿主渲染并回传 JSON。 */
function createAskTool(ask: (request: AgentAskRequest) => Promise<AgentAskResult>): AgentTool {
  return {
    name: ASK_TOOL_NAME,
    label: 'ask',
    description: '向用户提出需要决定的问题。html 必须是一个 <form>，每个控件都要有 name；提交后返回 JSON。'
      + '用 radio/checkbox/select 给选项，用 text/textarea 收集自由输入；不要写 script/style/button，不要要求密钥。'
      + '一次只问一个关键决定，表单保持简短，用 checked/selected 预选推荐项。',
    parameters: Type.Object({
      html: Type.String({ description: 'one HTML <form> with named controls' }),
    }),
    execute: async (_toolCallId, params) => {
      const request = params as AgentAskRequest;
      if (typeof request.html !== 'string' || !request.html.trim()) {
        throw new Error('ask 需要一个非空的 html 表单。');
      }
      const result = await ask(request);
      if (!result.ok && 'cancelled' in result) throw new Error('用户取消了提问。');
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}

export const MEDIA_VIEW_TOOL_NAME = 'flovart_workflow_media_view';

function createMediaViewTool(getNodes: () => readonly WorkflowNode[]): AgentTool {
  const frame = Type.Union([Type.Literal('first'), Type.Literal('middle'), Type.Literal('last')]);
  return {
    name: MEDIA_VIEW_TOOL_NAME,
    label: 'workflow.media.view',
    description: '查看图片/视频节点的真实画面：图片缩到长边 ≤1024px；视频默认抽首/中/尾 3 帧（frames 可选 first/middle/last），也可以用 times 指定任意秒数（如 [4.2, 13]）；单次最多 6 张。',
    parameters: Type.Object({
      nodeIds: Type.Array(Type.String()),
      frames: Type.Optional(Type.Array(frame)),
      times: Type.Optional(Type.Array(Type.Number(), { description: '视频抽帧的秒数列表，例如 [0, 6.5, 13]；给了 times 就忽略 frames。' })),
    }),
    execute: async (_toolCallId, params) => {
      const { nodeIds, frames, times } = params as { nodeIds: string[]; frames?: AgentVideoFrame[]; times?: number[] };
      const nodes = getNodes();
      const found: WorkflowNode[] = [];
      const missing: string[] = [];
      for (const id of nodeIds) {
        const node = nodes.find(item => item.id === id);
        if (node) found.push(node);
        else missing.push(id + '：节点不存在');
      }
      const view = await loadAgentNodeMedia(found, { frames, times });
      const notes = [...view.notes, ...missing];
      const content: Array<{ type: 'text'; text: string } | ImageContent> = [{ type: 'text', text: notes.join('\n') || '没有可查看的画面' }, ...view.images];
      return { content, details: { nodeIds, imageCount: view.images.length } };
    },
  };
}

// ---------------------------------------------------------------------------
// 内核：复刻 agent/kernel.js 的生命周期，浏览器实现（持久化/流/工具）
// ---------------------------------------------------------------------------

export { BROWSER_DEFAULT_SYSTEM_PROMPT };
const BROWSER_DEFAULT_SYSTEM_PROMPT = `你是 Flovart Agent，Flovart 生成式 AI 图像/视频无限画布（Workflow）里的创作搭档：理解用户的创作目标，把它落成用户当前可见画布上的节点、连线与生成任务，并清楚说明画布还能做什么。

## 你能直接调用的工具
- flovart_workflow_inspect：读取当前项目的节点、连线、配置与 revision。处理项目前先调用，不得猜测项目、节点或连接 ID。媒体地址在结果里会被脱敏为 [media]，这不代表节点没有内容。
- flovart_workflow_selection_get：读取用户当前选中的节点。
- flovart_workflow_apply：结构化修改画布。operations 只允许 add_node、create_connected_node、update_node、delete_nodes、delete_connections、connect_nodes、move_nodes、reorder_nodes、group_nodes、ungroup_nodes、set_batch_primary。
- flovart_workflow_node_run：运行生成节点（nodeId 或 nodeIds 批量，一次确认费用）。
- flovart_workflow_node_tool：在节点上执行后处理工具（截取视频任意秒数的帧、剪辑、音视频分离、拼接、裁剪、放大、去背景等），结果作为新节点写回画布。
- flovart_ask：需要用户在几个方案里做选择或补充关键信息时，用 HTML <form> 结构化提问（控件必须带 name；一次只问一个关键决定）。不要用它询问 API Key、Token 等秘密，也不要在正文里堆长问题让用户再回一轮。
- flovart_workflow_media_view：查看图片/视频节点的真实画面（nodeIds；视频可用 frames: first/middle/last 或 times: [秒数] 指定任意时间点）。inspect 里的 [media] 只是脱敏占位；需要判断构图、风格或检查生成结果时调用它。用户 @引用的图片/视频会自动附带画面。用户粘贴的截图、拖入的视频会作为本轮图片内容直接附上。
- flovart_web_search：联网搜索（Parallel 公共 MCP，免 Key，失败回退 DeepSeek）。需要外部资料、竞品信息、风格参考或事实核对时调用；结果给出来源 URL，引用时要带上。
- flovart_grep：在用户连接过的本地文件夹里搜文本文件（正则）。用户说“我本地的素材/文档里有…”时先用它；只能搜已授权文件夹，读不到任意路径。
- flovart_todo：多步制作的任务清单。
command.list/schema 属于 CLI discovery/debug，不是你的工具；不得访问 Shell、任意文件或 Provider Secret。

## 画布能力地图
节点类型：image、text、video、audio、config（生成配置）、script、operation、design、subgraph（逆向子画布框），插件可扩展自定义类型。
生成（你可以做）：用 apply 建立/更新 config 或媒体节点并连好参考，再用 node_run 运行。
- 图片：metadata.submode 为 text-to-image（文生图）或 image-to-image（图生图）；可设画幅 aspectRatio、分辨率、质量、张数 1-4、提示词增强等。
- 视频：submode 为 text-to-video（文生视频）、image-to-video（图生视频）、reference-to-video（全能参考）、first-last-frame（首尾帧生视频）、video-extension（视频续写/扩展）。
- 文本与音频：text-generate、audio-generate。
- 参考角色（连线/引用的 role）：first_frame、last_frame、reference、character、style、mask、source_video、source_audio。首尾帧视频要把两张图分别以 first_frame / last_frame 连到视频配置节点。
- 当前模型路由不支持某个 submode 时会返回明确错误：如实转告并建议换模型，不要假装成功。

媒体后处理工具（用 flovart_workflow_node_tool 直接执行，与节点工具条按钮同一实现；用户想自己点时，再说明在哪个节点上点哪个按钮）：
- 图片：裁剪、高清放大（长边 512-8192）、去背景、拆分图层、AI 编辑（编辑/扩图/局部重绘/标注/重打光，需提示词）、旋转/镜像、宫格切分（1-6 行列）、图层贴纸、矢量化（SVG）、滤镜、反推 Prompt（结果生成一个「反推提示词」文本节点）。
- 视频：视频剪辑（起止秒）、音视频分离（完整音轨/人声/背景音，输出无声视频 + 音频节点）、视频拼接（按顺序 ≥2 段）、截取首帧/尾帧/任意秒数的帧（position=current + currentTimeSec，输出图片节点，可直接作为下一段的 first_frame 做续镜）。只想看画面用 media_view，需要把帧留在画布上用 node_tool。
- 音频：音频剪辑、变速（0.25-4×）、人声/伴奏分离。
- 工具栏菜单可开启「新视频自动截首帧 / 尾帧 / 自动音视频分离」。
其中本地处理（裁剪、旋转、宫格、剪辑、分离、拼接、截帧、变速）不花费额度；放大、去背景、AI 编辑、拆图层、图层贴纸会调用模型服务。

其他工作台（只能引导用户操作）：
- 逆向视频（顶部切换到「逆向」）：上传参考视频，按 参考 → 分析 → 目标 → 变体 → 回到画布 拆出镜头、脚本、节奏与可替换槽位，结果以 subgraph 子画布写回 Workflow；双击子画布框回到逆向。你可以读取子画布里的镜头节点继续加工，但不能改逆向工作台本身。
- 逆向游戏美术素材：当前版本没有这个功能，不要承诺；可以用图生图、宫格切分、去背景、拆分图层组合出类似流程。
- 素材库、历史、本地文件夹：用户从侧栏把文件插入画布后，你通过 inspect 按节点 ID 使用它们；你不能自己导入文件。
- 本地 Agent 连接：在 Agent 抽屉的「连接」里选择 Codex、WorkBuddy 等本机 Agent；外部 Agent 通过 Flovart CLI/MCP 操作同一张画布，还能调用节点后处理工具。
- 第三方 API 接入：设置 → API Key 内置五种协议入口（OpenAI compatible、Gemini、火山 Seedance、RunningHub、自定义配置）。其他服务选「自定义配置」并绑定适配脚本（受限 JSON mapping：请求地址/鉴权/请求体/响应映射，不执行任意 JS）。用户需要时你可以按其接口文档起草脚本 JSON，由用户在「自定义配置」里粘贴保存；不得索取或回显密钥。

## 工作规则
默认只操作当前已绑定的可见 Browser Workflow；没有 Browser binding 时必须显式失败，不能切换到 Native、隐藏图或从 React/localforage 读取 Workflow 图，也不能自行解析 Provider。
修改只用 flovart_workflow_apply 的结构化 operations，执行只用 flovart_workflow_node_run（交给 WorkflowExecutor）；不得模拟鼠标、直接改 React state，或用 CLI、文件桥、直接 generate 在后台另做一份结果。
写操作使用稳定的 idempotencyKey；只有工具返回成功后，才能声称画布已变化。可逆修改直接落到用户可见的同一 Workflow 并合并为本轮 ChangeSet，每次修改后读取返回的 draftVersion/objectVersions 再继续。
删除、付费执行、Production 审批和运行会要求用户确认，不得绕过；普通可逆布局和节点编辑无需逐次确认。没有用户确认的 Production Mandate 时不得声称付费制作已经开始。

## 制作循环（每一步都落在可见 Workflow 上）
1. 澄清：缺少时长、画幅、风格、字幕语言或主体参考时，一次性列出缺口并给出建议默认值，等用户回答；信息足够时直接继续。
2. 锚点：先用 workflow.apply 建立角色/产品/场景锚点节点（如三视图、主视觉），节点写入 anchor: { kind, approved: false }；运行后请用户确认，确认后用 update_node 把 approved 设为 true；未确认前不要拆镜。
3. 拆镜：锚点确认后，用一次 workflow.apply 建立分镜节点，每个镜头一个节点，标题写镜号与内容，并写入 shot: { index, durationSec, scene, camera, dialogue, anchorNodeIds }；生成时会自动连上已批准锚点。
4. 批量生成：互不依赖的节点用 flovart_workflow_node_run 的 nodeIds 一次提交，由用户一次确认费用；有依赖的节点（如需要上一镜尾帧）等上游成功后再运行。
5. 汇报：按节点标题说明成功与失败；失败只重跑失败节点，不整批重跑。需要后处理时，指明节点和对应工具按钮。
6. 清单：多步制作开始前用 flovart_todo 建立任务清单，每完成、阻塞一步就更新；工具结果 ok:false 时读 error.code 决定改写提示词、重试或停下说明，预算不足或会话暂停时不得重试。
绑定 Production Skill 时，镜头语言、风格和节奏以 Skill 为准；与用户要求冲突时以用户为准并说明。
Web 模式下 Production Runtime 不可用，production 相关命令会失败并返回明确错误；此时改用 Workflow 节点工具完成可逆编排。`;

const PRODUCTION_SKILL_BINDING_ENTRY = 'flovart.production-skill-binding';

/** 分支切片：保留到指定 entry（含）为止；找不到返回 null。 */
export function entriesUpTo<T extends { id: string }>(entries: readonly T[], entryId: string): T[] | null {
  const index = branchEntryIndex(entries, [entryId]);
  return index < 0 ? null : entries.slice(0, index + 1);
}

/** 分支点定位：先按 entry id，再按消息 id；candidates 从最想用的开始。 */
export function branchEntryIndex(
  entries: readonly { id: string; message?: unknown }[],
  candidates: readonly string[],
): number {
  for (const candidate of candidates) {
    const direct = entries.findIndex(entry => entry.id === candidate);
    if (direct >= 0) return direct;
    const byMessage = entries.findIndex(entry => (entry.message as { id?: string } | undefined)?.id === candidate);
    if (byMessage >= 0) return byMessage;
  }
  return -1;
}

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
    // 与 Node 内核一致：任务清单是内核自带的只读工具，调用方已提供同名工具时不重复注册。
    this.tools = options.tools.some(tool => tool.name === TODO_TOOL_NAME)
      ? options.tools
      : [...options.tools, createTodoTool() as unknown as AgentTool];
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
    // 打开最近更新的会话；全新项目才创建第一个会话
    const latest = sessions[0];
    this.session = latest
      ? await this.repo.open({ id: latest.id })
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
        this.productionSkillBindingError = displayError(error, '技能绑定恢复失败。');
      }
    }

    await this.buildAgent();
    return this.snapshot();
  }

  /** 用当前 session + route 构建 PI Agent 实例；会话切换后复用。 */
  private async buildAgent(): Promise<void> {
    if (!this.session) throw new Error('Flovart Agent session is not open');
    const context = await this.session.buildContext();
    const wrappedTools = this.tools.map(tool => tool.execute ? {
      ...tool,
      execute: (toolCallId: string, input: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate?: (partial: unknown) => void) => tool.execute(toolCallId, {
        ...input,
        ...(this.activeChangeSetId ? { changeSetId: this.activeChangeSetId } : {}),
      }, signal, onUpdate as never),
    } : tool);

    const skillContext = this.boundProductionSkill
      ? (() => {
          const bundled = getBundledProductionSkill(this.boundProductionSkill!.id);
          return bundled ? `\n\n${bundled.skillSource.slice(0, 2000)}` : `\n\n${this.boundProductionSkill!.displayName}`;
        })()
      : '';

    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
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
      // 预期内失败由工具以 details.isError 标记，这里统一翻成 isError。
      afterToolCall: async ({ result }) => ((result as { details?: { isError?: boolean } } | undefined)?.details?.isError ? { isError: true } : undefined),
    });

    this.unsubscribe = this.agent.subscribe(async event => {
      if (event.type === 'message_end') {
        await this.session?.appendMessage((event as { message: AgentMessage }).message);
        if (this.session) await this.repo?.persist(this.session);
      }
      this.emit(event as { type: string; [key: string]: unknown });
    });
  }

  async listSessions(): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
    const repo = this.repo || new BrowserSessionRepo(this.projectId);
    const sessions = await repo.list();
    return sessions.map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
  }

  /** 开启一个全新会话并切换过去；旧会话保留在历史列表里。 */
  async newSession(): Promise<unknown> {
    if (!this.repo || !this.agent) await this.openSession();
    if (this.session) {
      const entries = await this.session.getBranch();
      // 空会话（没有任何消息）不重复进历史，直接复用
      if (!entries.some(entry => entry.type === 'message')) return this.snapshot();
    }
    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.boundProductionSkill = null;
    this.productionSkillBindingError = null;
    this.session = await this.repo!.create({ metadata: { projectId: this.projectId, role: 'main' } });
    await this.buildAgent();
    this.emit({ type: 'session_switched' });
    return this.snapshot();
  }

  /** 从某条消息处分出新会话：复制到该消息为止的全部内容，原会话保持不变。 */
  async branchSession(fromSessionId: string, upto: string | readonly string[]): Promise<unknown> {
    if (!this.repo) this.repo = new BrowserSessionRepo(this.projectId);
    const candidates = (typeof upto === 'string' ? [upto] : [...upto]).filter(Boolean);
    // 优先用内存里的当前会话：历史会话可能还没落盘，或消息已被压缩成摘要。
    const liveMetadata = this.session ? await this.session.getMetadata() : null;
    const live = liveMetadata?.id === fromSessionId ? this.session! : null;
    const sessions: Session[] = live ? [live] : [];
    if (!live) {
      try {
        sessions.push(await this.repo.open({ id: fromSessionId }));
      } catch {
        // 面板的 activeSessionId 可能滞后或为空；下面用当前活动会话兜底。
      }
      if (this.session) sessions.push(this.session);
    }
    if (!sessions.length) throw new Error('会话不存在：' + fromSessionId);
    let kept: Awaited<ReturnType<typeof this.session.getBranch>> | null = null;
    for (const source of sessions) {
      const entries = await source.getBranch();
      const index = branchEntryIndex(entries, candidates);
      if (index >= 0) {
        kept = entries.slice(0, index + 1);
        break;
      }
    }
    if (!kept) throw new Error('分支点不存在：' + (candidates[0] || ''));
    const branchPointId = kept[kept.length - 1].id;
    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.boundProductionSkill = null;
    this.productionSkillBindingError = null;
    const branch = await this.repo.create({
      metadata: { projectId: this.projectId, role: 'branch', branchedFrom: fromSessionId, branchPointId },
    });
    for (const entry of kept) {
      if (entry.type === 'message' && 'message' in entry && entry.message) await branch.appendMessage(entry.message);
      else if (entry.type === 'custom' && entry.customType === PRODUCTION_SKILL_BINDING_ENTRY && entry.data) {
        await branch.appendCustomEntry(entry.customType, entry.data);
      }
    }
    const persistedBinding = [...kept].reverse().find(entry => (
      entry.type === 'custom' && entry.customType === PRODUCTION_SKILL_BINDING_ENTRY
    )) as { data?: ProductionSkillAttachment } | undefined;
    if (persistedBinding?.data?.id && persistedBinding.data.version && persistedBinding.data.contentHash) {
      this.boundProductionSkill = persistedBinding.data;
    }
    this.session = branch;
    await this.buildAgent();
    this.emit({ type: 'session_switched' });
    return this.snapshot();
  }

  /** 切换到历史列表中的指定会话。 */
  async openSessionById(sessionId: string): Promise<unknown> {
    if (!this.repo) await this.openSession();
    if (!this.repo) throw new Error('Flovart Agent session store is unavailable');
    if (this.session) {
      const metadata = await this.session.getMetadata();
      if (metadata.id === sessionId) return this.snapshot();
    }
    this.agent?.abort();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.session = await this.repo.open({ id: sessionId });
    const entries = await this.session.getBranch();
    const persistedBinding = [...entries].reverse().find((entry): entry is Extract<typeof entry, { type: 'custom'; customType: string; data?: unknown }> => (
      entry.type === 'custom' && entry.customType === PRODUCTION_SKILL_BINDING_ENTRY
    ));
    this.boundProductionSkill = null;
    this.productionSkillBindingError = null;
    if (persistedBinding?.data) {
      try {
        const data = persistedBinding.data as ProductionSkillAttachment;
        if (data?.id && data?.version && data?.contentHash) this.boundProductionSkill = data;
      } catch (error) {
        this.productionSkillBindingError = displayError(error, '技能绑定恢复失败。');
      }
    }
    await this.buildAgent();
    this.emit({ type: 'session_switched' });
    return this.snapshot();
  }

  async deleteSession(sessionId: string): Promise<void> {
    if (!this.repo) this.repo = new BrowserSessionRepo(this.projectId);
    await this.repo.delete(sessionId);
    if (this.session) {
      const metadata = await this.session.getMetadata();
      if (metadata.id === sessionId) {
        // 删除的是当前会话：切到剩余最新的，或新建一个
        const remaining = (await this.repo.list())[0];
        if (remaining) await this.openSessionById(remaining.id);
        else await this.newSession();
      }
    }
  }

  cancel(): void {
    this.agent?.abort();
  }

  async send(text: string, images: ImageContent[] = [], skillAttachment?: ProductionSkillAttachment | null): Promise<unknown> {
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
      this.productionSkillBindingError = null;
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

    await this.agent.prompt(prompt, images.length > 0 ? images : undefined);
    return this.snapshot();
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
