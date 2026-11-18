import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';
import { AGENT_ABORTED_MESSAGE, BrowserAgentKernel } from '../services/browserAgentKernel';
import { isAbortMessage } from '../components/agent/agentAbort';

const route = { provider: 'openai_compatible', model: 'm', baseUrl: 'https://gw.example/v1', apiKey: 'k' };

function sse(chunks: unknown[]): Response {
  const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const reply = (text: string) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
function hangingResponse(signal?: AbortSignal | null): Response {
  return new Response(new ReadableStream({
    start(controller) {
      const fail = () => controller.error(signal?.reason ?? new DOMException('aborted', 'AbortError'));
      if (signal?.aborted) fail();
      else signal?.addEventListener('abort', fail);
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('browser agent steering', () => {
  let kernel: BrowserAgentKernel;
  beforeEach(async () => { await localforage.removeItem('flovart.agent.sessions.project-steer'); });
  afterEach(async () => { await kernel?.close(); await localforage.removeItem('flovart.agent.sessions.project-steer'); });

  it('injects a message sent mid-run into the running turn without aborting it', async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    let releaseFirst: () => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
      return reply(bodies.length === 1 ? '第一段回复' : '收到补充');
    }));
    kernel = new BrowserAgentKernel({ projectId: 'project-steer', route, tools: [], confirm: async () => true, systemPrompt: 'SYS', getThinkingLevel: () => 'off' });
    await kernel.openSession();
    const turn = kernel.send('先做 A');
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(kernel.running).toBe(true);
    expect(kernel.steer('顺便做 B')).toBe(true);
    releaseFirst();
    const snapshot = await turn as { messages: Array<{ role: string; text: string; error?: string }> };
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1].messages)).toContain('顺便做 B');
    expect(snapshot.messages.map(message => [message.role, message.text])).toEqual([
      ['user', '先做 A'], ['assistant', '第一段回复'], ['user', '顺便做 B'], ['assistant', '收到补充'],
    ]);
    expect(snapshot.messages.some(message => message.error)).toBe(false);
  });

  it('steer is refused when idle and stop drops queued steering', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => hangingResponse(init.signal)));
    kernel = new BrowserAgentKernel({ projectId: 'project-steer', route, tools: [], confirm: async () => true, getThinkingLevel: () => 'off' });
    await kernel.openSession();
    expect(kernel.steer('idle')).toBe(false);
    const turn = kernel.send('长任务');
    await vi.waitFor(() => expect(kernel.running).toBe(true));
    kernel.steer('不要再跑了');
    kernel.cancel();
    const snapshot = await turn as { messages: Array<{ role: string; text: string; error?: string; aborted?: boolean }> };
    expect(snapshot.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual(['长任务']);
    const last = snapshot.messages[snapshot.messages.length - 1];
    expect(last.aborted).toBe(true);
    expect(last.error).toBe(AGENT_ABORTED_MESSAGE);
  });
});

describe('browser agent steering boundary (codex-style pending steer)', () => {
  let kernel: BrowserAgentKernel;
  beforeEach(async () => { await localforage.removeItem('flovart.agent.sessions.project-steer'); });
  afterEach(async () => { await kernel?.close(); await localforage.removeItem('flovart.agent.sessions.project-steer'); });

  it('holds a steer until the next boundary, reports pickup with its id, and allows withdrawing before that', async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    let releaseFirst: () => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      if (bodies.length === 1) await new Promise<void>(resolve => { releaseFirst = resolve; });
      return reply(bodies.length === 1 ? '第一段' : '收到');
    }));
    kernel = new BrowserAgentKernel({ projectId: 'project-steer', route, tools: [], confirm: async () => true, getThinkingLevel: () => 'off' });
    await kernel.openSession();
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    kernel.subscribe(event => events.push(event));
    const turn = kernel.send('先做 A');
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(kernel.steer('顺便做 B', [], 'steer-b')).toBe(true);
    expect(kernel.steer('撤回我', [], 'steer-c')).toBe(true);
    expect(kernel.withdrawSteer('steer-c')).toBe(true);
    // 还没到边界：不算送达。
    expect(events.some(event => event.type === 'steer_delivered')).toBe(false);
    releaseFirst();
    await turn;
    expect(events.filter(event => event.type === 'steer_delivered').map(event => event.steerId)).toEqual(['steer-b']);
    // 送达后的 user 消息出现在第二次模型调用里，撤回的那条没有。
    expect(JSON.stringify(bodies[1].messages)).toContain('顺便做 B');
    expect(JSON.stringify(bodies[1].messages)).not.toContain('撤回我');
    expect(kernel.withdrawSteer('steer-b')).toBe(false);
    expect(kernel.takePendingSteers()).toEqual([]);
  });

  it('hands back a steer that never reached a boundary because the turn failed first', async () => {
    let calls = 0;
    let releaseFirst: () => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      await new Promise<void>(resolve => { releaseFirst = resolve; });
      return new Response('boom', { status: 400 });
    }));
    kernel = new BrowserAgentKernel({ projectId: 'project-steer', route, tools: [], confirm: async () => true, getThinkingLevel: () => 'off' });
    await kernel.openSession();
    const turn = kernel.send('会失败');
    await vi.waitFor(() => expect(calls).toBe(1));
    expect(kernel.steer('补充', [], 'steer-late')).toBe(true);
    releaseFirst();
    await turn.catch(() => undefined);
    expect(calls).toBe(1);
    expect(kernel.takePendingSteers()).toEqual(['steer-late']);
    expect(kernel.takePendingSteers()).toEqual([]);
  });
});

describe('abort wording', () => {
  it('recognises raw abort texts from every layer', () => {
    for (const text of ['signal is aborted without reason', 'This operation was aborted', 'The user aborted a request.', '已中止', 'AbortError']) expect(isAbortMessage(text)).toBe(true);
    for (const text of ['模型请求失败（HTTP 500）', 'aborted because the quota ran out', '']) expect(isAbortMessage(text)).toBe(false);
  });
});
