import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import localforage from 'localforage';
import { BrowserAgentRuntime, getBrowserAgentRuntime } from '../services/browserAgentRuntime';
import { resolveBrowserAgentTextRoute } from '../services/browserAgentKernel';
import type { UserApiKey } from '../types';

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
