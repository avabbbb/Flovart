import { Agent } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node';

const DEFAULT_SYSTEM_PROMPT = `你是 Flovart Agent，负责把用户的创作目标整理为可审查的制作计划。
你只能使用已注册的 Flovart 制作工具，不得访问 Shell、任意文件或 Provider Secret。
没有足够信息时先说明缺口；没有用户确认的 Production Mandate 时不得声称付费制作已经开始。`;

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .map(block => block?.type === 'text' ? block.text : block?.type === 'thinking' ? block.thinking : '')
    .filter(Boolean)
    .join('\n');
}

function snapshotMessage(entry) {
  const message = entry.message;
  return {
    id: entry.id,
    role: message.role,
    text: messageText(message),
    timestamp: message.timestamp,
    error: message.errorMessage,
  };
}

export class FlovartAgentKernel {
  constructor({ databasePath, model, streamFn, tools = [], systemPrompt = DEFAULT_SYSTEM_PROMPT }) {
    this.databasePath = databasePath;
    this.model = model;
    this.streamFn = streamFn;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.listeners = new Set();
  }

  async openSession({ projectId, cwd }) {
    if (this.session) throw new Error('Flovart Agent session is already open');
    this.env = new NodeExecutionEnv({ cwd });
    this.repo = new SqliteSessionRepo({
      env: this.env,
      sqlite: createNodeSqliteFactory(),
      databasePath: this.databasePath,
    });
    const metadata = (await this.repo.list({ cwd }))
      .find(item => item.metadata?.projectId === projectId && item.metadata?.role === 'main');
    this.session = metadata
      ? await this.repo.open(metadata)
      : await this.repo.create({ cwd, metadata: { projectId, role: 'main' } });
    const context = await this.session.buildContext();
    this.agent = new Agent({
      initialState: {
        systemPrompt: this.systemPrompt,
        model: this.model,
        tools: this.tools,
        messages: context.messages,
      },
      streamFn: this.streamFn,
      beforeToolCall: async ({ toolCall }) => (
        this.tools.some(tool => tool.name === toolCall.name)
          ? undefined
          : { block: true, reason: `未注册的 Flovart 工具：${toolCall.name}` }
      ),
    });
    this.unsubscribe = this.agent.subscribe(async event => {
      if (event.type === 'message_end') await this.session.appendMessage(event.message);
      for (const listener of this.listeners) await listener(event);
    });
    return this.snapshot();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async send(text, images = []) {
    if (!this.agent) throw new Error('Flovart Agent session is not open');
    const prompt = String(text || '').trim();
    if (!prompt && images.length === 0) throw new Error('Flovart Agent message is empty');
    await this.agent.prompt(prompt, images);
    return this.snapshot();
  }

  cancel() {
    this.agent?.abort();
  }

  async snapshot() {
    if (!this.session) throw new Error('Flovart Agent session is not open');
    const metadata = await this.session.getMetadata();
    const entries = await this.session.getBranch();
    return {
      sessionId: metadata.id,
      projectId: metadata.metadata?.projectId,
      messages: entries.filter(entry => entry.type === 'message').map(snapshotMessage),
      running: Boolean(this.agent?.state.isStreaming),
    };
  }

  async close() {
    this.agent?.abort();
    await this.agent?.waitForIdle();
    this.unsubscribe?.();
    await this.session?.getStorage().cleanup?.();
    await this.env?.cleanup();
    this.agent = undefined;
    this.session = undefined;
    this.repo = undefined;
    this.env = undefined;
  }
}
