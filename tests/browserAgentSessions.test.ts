import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';
import { BrowserAgentKernel, createBrowserAgentTools, resolveBrowserAgentTextRoute } from '../services/browserAgentKernel';
import { workflowMediaStorage } from '../components/workflow/storage';
import type { UserApiKey } from '../types';

const textKey: UserApiKey = {
  id: 'ds-key',
  provider: 'deepseek',
  capabilities: ['text'],
  key: 'secret',
  customModels: ['deepseek-v4-flash'],
  routeMappings: [{ target: { kind: 'runtime-capability', capability: 'agent-text' }, routeId: 'deepseek-v4-flash', order: 0 }],
  createdAt: 1,
  updatedAt: 1,
};

describe('browser agent multi-session history', () => {
  let kernel: BrowserAgentKernel;

  beforeEach(async () => {
    await workflowMediaStorage.clear();
    // localforage 在测试环境走 fake-indexeddb；清掉会话列表避免串扰
    await localforage.removeItem('flovart.agent.sessions.project-hist');
    await localforage.removeItem('flovart.agent.session.project-hist');
    kernel = new BrowserAgentKernel({
      projectId: 'project-hist',
      route: resolveBrowserAgentTextRoute([textKey])!,
      tools: [],
      confirm: async () => true,
    });
  });

  afterEach(async () => {
    await kernel.close();
    await localforage.removeItem('flovart.agent.sessions.project-hist');
    await localforage.removeItem('flovart.agent.session.project-hist');
  });

  it('publishes the inspect/apply/run Canvas contract to the browser Agent', () => {
    const names = createBrowserAgentTools({
      projectId: 'project-hist',
      confirm: async () => true,
      activeChangeSetId: 'turn-1',
    }).map(tool => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      'flovart_workflow_inspect',
      'flovart_workflow_selection_get',
      'flovart_workflow_apply',
      'flovart_workflow_node_run',
    ]));
  });

  it('keeps old sessions in history when starting a new conversation', async () => {
    await kernel.openSession();
    await kernel.close();

    // 第二个实例模拟重开面板
    const second = new BrowserAgentKernel({
      projectId: 'project-hist',
      route: resolveBrowserAgentTextRoute([textKey])!,
      tools: [],
      confirm: async () => true,
    });
    await second.openSession();
    const firstSessionId = String(((await second.snapshot()) as { sessionId: string }).sessionId);

    // 空会话时 newSession 复用当前会话，不产生第二条历史
    await second.newSession();
    // 旧会话写入一条用户消息后新建：历史保留旧会话
    const session = second['session'];
    await session!.appendMessage({ role: 'user', content: [{ type: 'text', text: '帮我做一个开场镜头' }] } as never);
    const repo = second['repo'] as unknown as { persist(session: unknown): Promise<void> };
    await repo.persist(session);

    await second.newSession();
    const list = await second.listSessions();
    expect(list).toHaveLength(2);
    expect(list.some(item => item.title === '帮我做一个开场镜头')).toBe(true);
    expect(firstSessionId).toBeTruthy();
    await second.close();
  });

  it('switches back to a historical session and restores its messages', async () => {
    await kernel.openSession();
    // 直接向当前会话写入一条用户消息（绕过模型调用）
    const session = kernel['session'];
    await session!.appendMessage({ role: 'user', content: [{ type: 'text', text: '第一轮对话内容' }] } as never);
    const repo = kernel['repo'] as unknown as { persist(session: unknown): Promise<void> };
    await repo.persist(session);
    const originalId = ((await kernel.snapshot()) as { sessionId: string }).sessionId;

    await kernel.newSession();
    const fresh = (await kernel.snapshot()) as { sessionId: string; messages: Array<{ text: string }> };
    expect(fresh.sessionId).not.toBe(originalId);
    expect(fresh.messages).toHaveLength(0);

    await kernel.openSessionById(originalId);
    const restored = (await kernel.snapshot()) as { sessionId: string; messages: Array<{ role: string; text: string }> };
    expect(restored.sessionId).toBe(originalId);
    expect(restored.messages.map(message => [message.role, message.text])).toContainEqual(['user', '第一轮对话内容']);
  });

  it('deletes a historical session and falls back to the latest remaining one', async () => {
    await kernel.openSession();
    const first = (await kernel.snapshot()) as { sessionId: string };

    await kernel.newSession();
    // 让新会话非空，确保 newSession 真正创建第二条
    const session = kernel['session'];
    await session!.appendMessage({ role: 'user', content: [{ type: 'text', text: '第二轮' }] } as never);
    const repo = kernel['repo'] as unknown as { persist(session: unknown): Promise<void> };
    await repo.persist(session);

    await kernel.deleteSession(first.sessionId);
    const list = await kernel.listSessions();
    expect(list.some(item => item.id === first.sessionId)).toBe(false);
    const current = (await kernel.snapshot()) as { sessionId: string };
    expect(current.sessionId).not.toBe(first.sessionId);
  });

  it('migrates a legacy single-session record into the history list once', async () => {
    await localforage.setItem('flovart.agent.session.project-hist', {
      metadata: { id: 'legacy-session-1', createdAt: '2026-08-01T00:00:00.000Z' },
      entries: [
        { type: 'message', id: 'e1', message: { role: 'user', content: [{ type: 'text', text: '旧版对话标题来源' }] } },
      ],
    });

    await kernel.openSession();
    // 迁移后打开最近一条（即迁移进来的旧会话），且 legacy key 已删除
    const snapshot = (await kernel.snapshot()) as { sessionId: string; messages: Array<{ text: string }> };
    expect(snapshot.sessionId).toBe('legacy-session-1');
    expect(snapshot.messages.map(message => message.text)).toContain('旧版对话标题来源');
    expect(await localforage.getItem('flovart.agent.session.project-hist')).toBeNull();

    const list = await kernel.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('旧版对话标题来源');
  });

  it('persists the user message exactly once per send()', async () => {
    // 回归：send() 曾手动 appendMessage(user)，agent.prompt() 的 message_end 又写一次，面板显示两条。
    const sse = [
      'data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' } }] }),
      'data: ' + JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]',
      '',
    ].join('\n\n');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    try {
      await kernel.openSession();
      await kernel.send('只发一次');
      const snapshot = (await kernel.snapshot()) as { messages: Array<{ role: string; text: string }> };
      expect(snapshot.messages.filter(message => message.role === 'user' && message.text === '只发一次')).toHaveLength(1);
      expect(snapshot.messages.some(message => message.role === 'assistant' && message.text.includes('OK'))).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });
});
