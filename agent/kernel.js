import { Agent } from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import crypto from 'node:crypto';
import {
  createNodeSqliteFactory,
  SqliteSessionRepo,
} from '@earendil-works/pi-storage-sqlite-node';
import { resolveProductionSkillAttachment } from './production-skills.js';

const DEFAULT_SYSTEM_PROMPT = `你是 Flovart Agent，负责把用户的创作目标整理为可审查的制作计划。
你只能使用已注册的 Flovart 制作工具，不得访问 Shell、任意文件或 Provider Secret。
处理当前项目时先调用 flovart_workflow_inspect，不得猜测项目、节点或连接 ID。
写操作必须使用稳定的 idempotencyKey；只有工具返回成功后，才能声称 Workflow 已发生变化。
可逆的 Workflow Draft 修改会直接落到用户当前可见的同一画布，并合并为本轮 ChangeSet；每次修改后读取工具返回的 draftVersion/objectVersions，再继续下一步。
不得用 CLI、文件桥或直接 generate 命令在后台另做一份结果。视频制作必须走 production.dry-run → 用户审批系统门禁/风格参考 → production.run → production.status，并由 Runtime Projection 持续回到同一个 Workflow。
production.dry-run 必须携带 workflow.inspect 的当前 draftVersion 和本片实际使用的 sourceNodeIds 作为 draftBinding；版本冲突时重读画布，不能绕过或自行改小版本号。
删除、付费执行、Production 审批和运行会要求用户确认，不得绕过；普通可逆布局和节点编辑无需逐次确认。
没有足够信息时先说明缺口；没有用户确认的 Production Mandate 时不得声称付费制作已经开始。`;
const PRODUCTION_SKILL_BINDING_ENTRY = 'flovart.production-skill-binding';

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
  if (message.role === 'toolResult') {
    return {
      id: entry.id,
      role: 'tool',
      text: messageText(message),
      toolName: message.toolName,
      isError: Boolean(message.isError),
      timestamp: message.timestamp,
    };
  }
  return {
    id: entry.id,
    role: message.role,
    text: messageText(message),
    timestamp: message.timestamp,
    error: message.errorMessage,
  };
}

function publicProductionSkill(binding) {
  return binding ? {
    id: binding.id,
    version: binding.version,
    contentHash: binding.contentHash,
    displayName: binding.displayName,
    trustTier: binding.trustTier,
  } : undefined;
}

export class FlovartAgentKernel {
  constructor({
    databasePath,
    model,
    streamFn,
    tools = [],
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    resolveProductionSkill = resolveProductionSkillAttachment,
  }) {
    this.databasePath = databasePath;
    this.model = model;
    this.streamFn = streamFn;
    this.tools = tools;
    this.systemPrompt = systemPrompt;
    this.resolveProductionSkill = resolveProductionSkill;
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
    const entries = await this.session.getBranch();
    const persistedBinding = [...entries].reverse().find(entry => (
      entry.type === 'custom' && entry.customType === PRODUCTION_SKILL_BINDING_ENTRY
    ));
    if (persistedBinding?.data) {
      try {
        this.boundProductionSkill = await this.resolveProductionSkill(persistedBinding.data);
      } catch (error) {
        this.productionSkillBindingError = error instanceof Error ? error.message : String(error);
      }
    }
    const context = await this.session.buildContext();
    const wrappedTools = this.tools.map(tool => tool.execute ? {
      ...tool,
      execute: (toolCallId, input, signal) => tool.execute(toolCallId, {
        ...input,
        ...(this.activeChangeSetId ? { changeSetId: this.activeChangeSetId } : {}),
      }, signal),
    } : tool);
    this.agent = new Agent({
      initialState: {
        systemPrompt: this.boundProductionSkill
          ? `${this.systemPrompt}\n\n${this.boundProductionSkill.systemContext}`
          : this.systemPrompt,
        model: this.model,
        tools: wrappedTools,
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

  async send(text, images = [], skillAttachment) {
    if (!this.agent) throw new Error('Flovart Agent session is not open');
    const prompt = String(text || '').trim();
    if (!prompt && images.length === 0) throw new Error('Flovart Agent message is empty');
    this.activeChangeSetId = crypto.randomUUID();
    if (skillAttachment === null) {
      if (this.boundProductionSkill) {
        this.boundProductionSkill = undefined;
        this.productionSkillBindingError = undefined;
        this.agent.state.systemPrompt = this.systemPrompt;
        await this.session.appendCustomEntry(PRODUCTION_SKILL_BINDING_ENTRY, null);
      }
    } else if (skillAttachment) {
      const resolved = await this.resolveProductionSkill(skillAttachment);
      const changed = !this.boundProductionSkill
        || this.boundProductionSkill.id !== resolved.id
        || this.boundProductionSkill.version !== resolved.version
        || this.boundProductionSkill.contentHash !== resolved.contentHash;
      this.boundProductionSkill = resolved;
      this.productionSkillBindingError = undefined;
      this.agent.state.systemPrompt = `${this.systemPrompt}\n\n${this.boundProductionSkill.systemContext}`;
      if (changed) await this.session.appendCustomEntry(
        PRODUCTION_SKILL_BINDING_ENTRY,
        publicProductionSkill(this.boundProductionSkill),
      );
    }
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
      boundProductionSkill: publicProductionSkill(this.boundProductionSkill),
      productionSkillBindingError: this.productionSkillBindingError,
      messages: entries
        .filter(entry => entry.type === 'message')
        .map(snapshotMessage)
        .filter(message => message.role !== 'assistant' || message.text || message.error),
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
    this.boundProductionSkill = undefined;
    this.productionSkillBindingError = undefined;
    this.env = undefined;
  }
}
