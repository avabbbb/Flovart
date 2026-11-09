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
import { withWorkflowHumanApproval } from './workflowDispatcher';
import { getBundledProductionSkill, type ProductionSkillAttachment } from './productionSkillCatalog';
import { workflowConfirmRequest } from './workflowAgentBridge';
import type { AgentConfirmRequest } from './agentSpendMandate';
import { COMMAND_ALIASES, COMMAND_REGISTRY } from '../tools/flovart/core.js';
import { AGENT_BROWSER_COMMANDS } from '../tools/flovart/agent-surface.js';
import { createTodoTool, TODO_TOOL_NAME } from '../agent/todo.js';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { WorkflowNode } from '../components/workflow/types';
import { loadAgentNodeMedia, type AgentVideoFrame } from './agentMediaView';
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

export interface BrowserAgentToolDependencies {
  projectId: string;
  /** 高风险操作（删除、付费、Production 运行等）的用户确认；返回 false 表示拒绝 */
  confirm: (summary: string, request?: AgentConfirmRequest) => Promise<boolean>;
  /** 当前 Agent 回合的幂等键（可逆写操作合并进同一 ChangeSet） */
  activeChangeSetId: string;
  /** 读取当前画布节点；提供时注册 flovart_workflow_media_view，让 Agent 看图片/视频的真实画面 */
  getNodes?: () => readonly WorkflowNode[];
}

export function createBrowserAgentTools(dependencies: BrowserAgentToolDependencies): AgentTool[] {
  const workflowContract = createBrowserWorkflowContract();
  const commandTools: AgentTool[] = AGENT_BROWSER_COMMANDS.map(command => {
    const definition = COMMAND_REGISTRY[command] || { args: {}, summary: command };
    const args = (definition.args || {}) as Record<string, string>;
    const parameters = Type.Object(
      Object.fromEntries(Object.entries(args).map(([name, descriptor]) => [name, descriptorSchema(descriptor)])),
    );
    return {
      name: browserToolName(command),
      label: command,
      description: String(definition.summary || command),
      parameters,
      execute: async (_toolCallId, params, _signal) => {
        const envelope = {
          id: crypto.randomUUID(),
          command,
          args: {
            ...(params as Record<string, unknown>),
            projectId: dependencies.projectId,
            workspaceMode: 'browser',
          },
          source: 'agent',
          idempotencyKey: dependencies.activeChangeSetId,
        } as const;
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
          content: [{ type: 'text', text: JSON.stringify(result.result ?? { ok: true }) }],
          details: result,
        };
      },
    };
  });
  return dependencies.getNodes ? [...commandTools, createMediaViewTool(dependencies.getNodes)] : commandTools;
}

export const MEDIA_VIEW_TOOL_NAME = 'flovart_workflow_media_view';

function createMediaViewTool(getNodes: () => readonly WorkflowNode[]): AgentTool {
  const frame = Type.Union([Type.Literal('first'), Type.Literal('middle'), Type.Literal('last')]);
  return {
    name: MEDIA_VIEW_TOOL_NAME,
    label: 'workflow.media.view',
    description: '查看图片/视频节点的真实画面：图片缩到长边 ≤1024px，视频默认抽首/中/尾 3 帧（frames 可选 first/middle/last），单次最多 6 张。',
    parameters: Type.Object({
      nodeIds: Type.Array(Type.String()),
      frames: Type.Optional(Type.Array(frame)),
    }),
    execute: async (_toolCallId, params) => {
      const { nodeIds, frames } = params as { nodeIds: string[]; frames?: AgentVideoFrame[] };
      const nodes = getNodes();
      const found: WorkflowNode[] = [];
      const missing: string[] = [];
      for (const id of nodeIds) {
        const node = nodes.find(item => item.id === id);
        if (node) found.push(node);
        else missing.push(id + '：节点不存在');
      }
      const view = await loadAgentNodeMedia(found, { frames });
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
- flovart_workflow_media_view：查看图片/视频节点的真实画面（nodeIds；视频可选 frames: first/middle/last）。inspect 里的 [media] 只是脱敏占位；需要判断构图、风格或检查生成结果时调用它。用户 @引用的图片/视频会自动附带画面。
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

媒体后处理工具（用户在节点工具条上点击执行；你目前不能直接触发，只能推荐，并说清在哪个节点上点哪个按钮、填什么参数）：
- 图片：裁剪、高清放大（长边 512-8192）、去背景、拆分图层、AI 编辑（编辑/扩图/局部重绘/标注/重打光，需提示词）、旋转/镜像、宫格切分（1-6 行列）、图层贴纸、矢量化（SVG）、滤镜、反推 Prompt（结果生成一个「反推提示词」文本节点）。
- 视频：视频剪辑（起止秒）、音视频分离（完整音轨/人声/背景音，输出无声视频 + 音频节点）、视频拼接（按顺序 ≥2 段）、截取首帧/当前帧/尾帧（输出图片节点，可直接作为下一段的 first_frame 做续镜）。
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
