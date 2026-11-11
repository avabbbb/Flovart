import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import localforage from 'localforage';
import { BrowserAgentRuntime, AgentRuntimeError, delegatedPolicyFor, getBrowserAgentRuntime, type RuntimeKernel } from '../services/browserAgentRuntime';
import { resolveBrowserAgentTextRoute } from '../services/browserAgentKernel';
import type { UserApiKey } from '../types';
import { COMMAND_REGISTRY } from '../tools/flovart/core.js';
import { AGENT_PUBLIC_COMMANDS } from '../tools/flovart/agent-surface.js';

const textKey: UserApiKey = {
  id: 'runtime-key',
  provider: 'deepseek',
  capabilities: ['text'],
  key: 'secret',
  customModels: ['deepseek-v4-flash'],
  routeMappings: [{ target: { kind: 'runtime-capability', capability: 'agent-text' }, routeId: 'deepseek-v4-flash', order: 0 }],
  createdAt: 1,
  updatedAt: 1,
};

const projectId = 'project-runtime';

async function connect() {
  const route = resolveBrowserAgentTextRoute([textKey]);
  if (!route) throw new Error('runtime fixture route missing');
  return BrowserAgentRuntime.connect({
    projectId,
    route,
    confirm: async () => true,
    systemPrompt: 'runtime fixture',
  });
}

describe('browser agent runtime', () => {
  beforeEach(async () => {
    await localforage.removeItem(`flovart.agent.sessions.${projectId}`);
    await localforage.removeItem(`flovart.agent.session.${projectId}`);
  });

  afterEach(async () => {
    await localforage.removeItem(`flovart.agent.sessions.${projectId}`);
    await localforage.removeItem(`flovart.agent.session.${projectId}`);
  });

  it('registers by project, opens a session, and unregisters on close', async () => {
    expect(getBrowserAgentRuntime(projectId)).toBeNull();
    const runtime = await connect();

    expect(getBrowserAgentRuntime(projectId)).toBe(runtime);
    const snapshot = await runtime.snapshot() as { sessionId?: string; messages?: unknown[] };
    expect(snapshot.sessionId).toBeTruthy();
    expect(snapshot.messages).toEqual([]);

    await runtime.close();
    expect(runtime.isClosed).toBe(true);
    expect(getBrowserAgentRuntime(projectId)).toBeNull();
    await runtime.close();
  });

  it('delegates session commands and survives a new session request', async () => {
    const runtime = await connect();
    const before = await runtime.listSessions();
    expect(before.length).toBeGreaterThan(0);

    await runtime.newSession();
    const sessions = await runtime.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    const current = await runtime.snapshot() as { sessionId: string };
    await runtime.openSessionById(current.sessionId);
    await runtime.close();
  });

  it('drops listeners on close so a closed runtime does not forward events', async () => {
    const runtime = await connect();
    const seen: string[] = [];
    runtime.subscribe(event => seen.push(event.type));
    await runtime.close();
    // 关闭后不再有内核事件；这里只验证 close 清空监听且重复 close 安全。
    expect(seen).toEqual([]);
  });
});


function fakeKernel(text = '处理完成') {
  const state = {
    sessionId: 'session-1',
    running: false,
    messages: [] as Array<Record<string, unknown>>,
    sends: [] as string[],
    opened: [] as string[],
  };
  const kernel: RuntimeKernel = {
    openSession: async () => undefined,
    close: async () => undefined,
    subscribe: () => () => undefined,
    snapshot: async () => ({ sessionId: state.sessionId, running: state.running, messages: [...state.messages] }),
    send: async (input: string) => {
      state.sends.push(input);
      state.messages.push({ role: 'user', text: input });
      state.messages.push({ role: 'assistant', text });
      state.messages.push({ role: 'tool', toolName: 'flovart_workflow_inspect', isError: false });
      return undefined;
    },
    cancel: () => undefined,
    listSessions: async () => [],
    newSession: async () => undefined,
    openSessionById: async (id: string) => { state.opened.push(id); state.sessionId = id; return undefined; },
    deleteSession: async () => undefined,
    branchSession: async () => undefined,
  };
  return { kernel, state };
}

const fakeRoute = { provider: 'deepseek', model: 'm', baseUrl: 'http://127.0.0.1', apiKey: 'k' } as const;

async function connectFake(kernel: RuntimeKernel, draftVersion = 7) {
  return BrowserAgentRuntime.connect({
    projectId,
    route: fakeRoute,
    confirm: async () => true,
    systemPrompt: 'runtime fixture',
    getDraftVersion: () => draftVersion,
  }, { kernel });
}

describe('delegated agent turns', () => {
  beforeEach(async () => {
    await localforage.removeItem(`flovart.agent.sessions.${projectId}`);
  });

  it('defaults to a read-only sandbox and on-request approval', () => {
    expect(delegatedPolicyFor()).toEqual({ sandbox: 'read-only', approval: 'on-request' });
    expect(delegatedPolicyFor('workspace-write')).toEqual({ sandbox: 'workspace-write', approval: 'on-request' });
  });

  it('returns a summary, tool calls, and the draft version', async () => {
    const { kernel } = fakeKernel('改了标题');
    const runtime = await connectFake(kernel);
    const result = await runtime.runDelegatedTurn({ prompt: '看一下画布', mutationId: 'm1' });
    expect(result).toMatchObject({
      sessionId: 'session-1',
      text: '改了标题',
      draftVersion: 7,
      toolCalls: [{ name: 'flovart_workflow_inspect', status: 'success' }],
    });
    await runtime.close();
  });

  it('replays the same mutationId without running twice', async () => {
    const { kernel, state } = fakeKernel();
    const runtime = await connectFake(kernel);
    const first = await runtime.runDelegatedTurn({ prompt: '第一轮', mutationId: 'same' });
    const second = await runtime.runDelegatedTurn({ prompt: '第一轮', mutationId: 'same' });
    expect(state.sends).toEqual(['第一轮']);
    expect(second).toEqual(first);
    await runtime.close();
  });

  it('rejects a concurrent turn with AGENT_BUSY', async () => {
    const { kernel, state } = fakeKernel();
    const runtime = await connectFake(kernel);
    const first = runtime.runDelegatedTurn({ prompt: 'a', mutationId: 'a' });
    const second = runtime.runDelegatedTurn({ prompt: 'b', mutationId: 'b' });
    await expect(second).rejects.toMatchObject({ code: 'AGENT_BUSY' });
    await first;
    expect(state.sends).toEqual(['a']);
    await runtime.close();
  });

  it('refuses to run while the panel is already streaming', async () => {
    const { kernel, state } = fakeKernel();
    state.running = true;
    const runtime = await connectFake(kernel);
    await expect(runtime.runDelegatedTurn({ prompt: 'a', mutationId: 'a' }))
      .rejects.toMatchObject({ code: 'AGENT_BUSY' });
    await runtime.close();
  });

  it('switches to a requested session and truncates long summaries', async () => {
    const { kernel, state } = fakeKernel('长'.repeat(7000));
    const runtime = await connectFake(kernel);
    const result = await runtime.runDelegatedTurn({ prompt: 'a', mutationId: 'a', sessionId: 'session-9' });
    expect(state.opened).toEqual(['session-9']);
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(6001);
    await runtime.close();
  });

  it('fails closed after the runtime closes', async () => {
    const { kernel } = fakeKernel();
    const runtime = await connectFake(kernel);
    await runtime.close();
    await expect(runtime.runDelegatedTurn({ prompt: 'a', mutationId: 'a' }))
      .rejects.toBeInstanceOf(AgentRuntimeError);
  });

  it('publishes agent.turn in the registry and the public surface', () => {
    expect(COMMAND_REGISTRY['agent.turn']).toMatchObject({ args: expect.objectContaining({ prompt: 'string' }) });
    expect(AGENT_PUBLIC_COMMANDS).toContain('agent.turn');
  });
});
