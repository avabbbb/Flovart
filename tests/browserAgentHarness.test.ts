// 内置 Agent harness：强制技能首轮完整读取、技能已读去重跨压缩、发送前阈值压缩、上下文溢出压缩重试一次、拒答不重试、手动压缩、项目记忆注入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';
import { BrowserAgentKernel, AGENT_CONTEXT_OVERFLOW_MESSAGE } from '../services/browserAgentKernel';
import { createInMemoryMemoryBackend } from '../services/agentProjectMemory';
import type { AgentSkillCatalog } from '../services/agentSkills';

const PROJECT = 'project-harness';
const route = { provider: 'openai_compatible', model: 'm', baseUrl: 'https://gw.example/v1', apiKey: 'k' };

type Body = { messages: Array<{ role: string; content: unknown; tool_calls?: unknown }>; tools?: Array<{ function: { name: string } }> };

function sse(chunks: unknown[]): Response {
  const body = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const reply = (text: string) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const toolCall = (name: string, args: Record<string, unknown>) => sse([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-' + Math.random().toString(36).slice(2), function: { name, arguments: JSON.stringify(args) } }] } }] },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
]);
const isSummaryRequest = (body: Body) => JSON.stringify(body.messages[0]?.content ?? '').includes('context summarization assistant');
const systemOf = (body: Body) => String(body.messages[0]?.role === 'system' ? body.messages[0].content : '');

const LONG_SKILL = ['---', 'name: demo', 'description: 演示技能：纸艺拼贴短片。', '---', ...Array.from({ length: 300 }, (_, index) => `规则 ${index + 1}：保持纸张撕边与阴影一致。`), '最后一行：结尾用品牌色。'].join('\n');
const catalog: AgentSkillCatalog = {
  list: () => [
    { id: 'demo', aliases: ['community.demo'], name: 'demo', description: '演示技能：纸艺拼贴短片。', source: 'bundled' },
    { id: 'flovart', aliases: [], name: 'flovart', description: 'CLI only', source: 'project' },
  ],
  read: async (id, file) => (id === 'demo' && file === 'SKILL.md' ? LONG_SKILL : id === 'demo' && file === 'references/a.md' ? '# 参考 A' : null),
};
const attachment = { id: 'community.demo', version: '1.0.0', contentHash: 'h1', displayName: 'Demo', trustTier: 'bundled-example' };

afterEach(() => vi.unstubAllGlobals());

describe('browser agent harness', () => {
  let kernel: BrowserAgentKernel | undefined;
  beforeEach(async () => { await localforage.removeItem(`flovart.agent.sessions.${PROJECT}`); });
  afterEach(async () => { await kernel?.close(); kernel = undefined; await localforage.removeItem(`flovart.agent.sessions.${PROJECT}`); });

  const make = (options: Partial<ConstructorParameters<typeof BrowserAgentKernel>[0]> = {}) => new BrowserAgentKernel({
    projectId: PROJECT, route, tools: [], confirm: async () => true, systemPrompt: 'SYS', getThinkingLevel: () => 'off',
    skillCatalog: catalog, memory: createInMemoryMemoryBackend(), ...options,
  });

  it('pins a bound skill: full SKILL.md read once on the first turn, index + memory in the system prompt', async () => {
    const bodies: Body[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return reply('好的'); }));
    const memory = createInMemoryMemoryBackend();
    await memory.add(PROJECT, { text: '主角叫小林，红色风衣' });
    kernel = make({ memory });
    await kernel.openSession();
    const events: string[] = [];
    kernel.subscribe(event => { if (event.type.startsWith('tool_execution')) events.push(`${event.type}:${String(event.toolName)}`); });
    const first = await kernel.send('做一条 15 秒短片', [], attachment) as { messages: Array<{ role: string; text: string; toolName?: string }> };
    const system = systemOf(bodies[0]);
    expect(system).toContain('SYS');
    expect(system).toContain('- demo：演示技能');
    expect(system).not.toContain('- flovart：');
    expect(system).toContain('强制使用');
    expect(system).toContain('主角叫小林');
    expect(system).not.toContain('规则 1：');
    const request = JSON.stringify(bodies[0].messages);
    expect(request).toContain('最后一行：结尾用品牌色。'); // 完整原文，没有 2000 字截断
    expect(bodies[0].tools?.map(tool => tool.function.name)).toEqual(expect.arrayContaining(['flovart_skill_read', 'flovart_memory', 'flovart_todo']));
    expect(events).toEqual(['tool_execution_start:flovart_skill_read', 'tool_execution_end:flovart_skill_read']);
    expect(first.messages.map(message => message.role)).toEqual(['user', 'tool', 'assistant']);
    expect(first.messages[1]).toMatchObject({ toolName: 'flovart_skill_read' });

    await kernel.send('再来一版', [], attachment);
    const toolMessages = bodies[1].messages.filter(message => message.role === 'tool');
    expect(toolMessages).toHaveLength(1); // 第二轮不再重复注入
    expect(systemOf(bodies[1])).toContain('本会话已读技能：demo');
  });

  it('dedupes model-initiated skill reads and keeps the read list across compaction and reopen', async () => {
    const bodies: Body[] = [];
    const script: Array<() => Response> = [
      () => toolCall('flovart_skill_read', { id: 'demo', file: 'references/a.md' }),
      () => reply('读完了'),
      () => reply('x'.repeat(4_000)),
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      bodies.push(body);
      if (isSummaryRequest(body)) return reply('## 摘要\n用户在做纸艺短片，已读 demo 技能。');
      return (script.shift() ?? (() => toolCall('flovart_skill_read', { id: 'demo', file: 'references/a.md' })))();
    }));
    kernel = make({ compaction: { keepRecentTokens: 500 } });
    await kernel.openSession();
    await kernel.send('先读参考');
    await kernel.send('长回复 ' + 'y'.repeat(8_000));
    const compacted = await kernel.compactContext();
    expect(compacted.compacted).toBe(true);
    await kernel.close();

    kernel = make();
    await kernel.openSession();
    const snapshot = await kernel.snapshot() as { messages: Array<{ role: string; text: string }> };
    expect(snapshot.messages.some(message => message.role === 'system' && message.text.includes('已压缩上下文'))).toBe(true);
    let followUp = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      bodies.push(body);
      followUp += 1;
      return followUp === 1 ? toolCall('flovart_skill_read', { id: 'demo', file: 'references/a.md' }) : reply('ok');
    }));
    const after = await kernel.send('再看一下参考') as { messages: Array<{ role: string; text: string; toolName?: string }> };
    const lastTool = after.messages.filter(message => message.toolName === 'flovart_skill_read').at(-1)!;
    expect(lastTool.text).toContain('已读过');
    expect(lastTool.text).toContain('压缩');
    expect(lastTool.text).not.toContain('# 参考 A');
    expect(systemOf(bodies.at(-1)!)).toContain('本会话已读技能：demo');
    const retried = bodies.at(-2)!;
    expect(JSON.stringify(retried.messages)).toContain('## 摘要');
  });

  it('compacts before sending when the estimate passes the threshold, updating the previous summary next time', async () => {
    const kinds: string[] = [];
    const summaryPrompts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      if (isSummaryRequest(body)) { kinds.push('summary'); summaryPrompts.push(JSON.stringify(body.messages)); return reply('## 摘要\n早期讨论'); }
      kinds.push('turn');
      return reply('ok');
    }));
    kernel = make({ contextWindow: 30_000, compaction: { keepRecentTokens: 1_000 } });
    await kernel.openSession();
    const events: string[] = [];
    kernel.subscribe(event => { if (event.type.startsWith('compaction')) events.push(`${event.type}:${String(event.reason)}`); });
    for (let index = 0; index < 4; index += 1) await kernel.send(`第 ${index + 1} 段 ` + 'z'.repeat(18_000));
    const summaries = kinds.filter(kind => kind === 'summary').length;
    expect(summaries).toBeGreaterThanOrEqual(1);
    expect(kinds.slice(0, 2)).toEqual(['turn', 'turn']);
    kinds.forEach((kind, index) => { if (kind === 'summary') expect(kinds[index + 1]).toBe('turn'); });
    expect(events).toEqual(Array.from({ length: summaries }, () => ['compaction_start:threshold', 'compaction_end:threshold']).flat());
    if (summaries > 1) expect(summaryPrompts[1]).toContain('previous-summary');
    expect(kernel.estimateContextTokens()).toBeLessThan(15_000);
    const snapshot = await kernel.snapshot();
    // 面板历史保留全部原始消息，压缩只影响发给模型的上下文。
    expect(snapshot.messages.filter(message => message.role === 'user')).toHaveLength(4);
  });

  it('on context overflow compacts and retries exactly once, hiding the overflow error', async () => {
    const kinds: string[] = [];
    let overflowed = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      if (isSummaryRequest(body)) { kinds.push('summary'); return reply('## 摘要\n前情'); }
      const userTurns = body.messages.filter(message => message.role === 'user').length;
      if (userTurns >= 3 && !overflowed) {
        overflowed = true;
        kinds.push('overflow');
        return new Response(JSON.stringify({ error: { message: "This model's maximum context length is 131072 tokens. However, you requested 140000 tokens." } }), { status: 400 });
      }
      kinds.push('turn');
      return reply(userTurns >= 3 ? '压缩后完成' : 'ok');
    }));
    kernel = make();
    await kernel.openSession();
    await kernel.send('一 ' + 'a'.repeat(40_000));
    await kernel.send('二 ' + 'b'.repeat(40_000));
    const snapshot = await kernel.send('三') as { messages: Array<{ role: string; text: string; error?: string }> };
    expect(kinds).toEqual(['turn', 'turn', 'overflow', 'summary', 'turn']);
    expect(snapshot.messages.some(message => message.error)).toBe(false);
    expect(snapshot.messages.at(-1)).toMatchObject({ role: 'assistant', text: '压缩后完成' });
    expect(snapshot.messages.some(message => message.role === 'system' && message.text.includes('已压缩上下文'))).toBe(true);
  });

  it('surfaces the overflow error when nothing can be compacted (no retry loop)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return new Response('{"error":{"code":"context_length_exceeded"}}', { status: 400 });
    }));
    kernel = make();
    await kernel.openSession();
    const snapshot = await kernel.send('单条就超长') as { messages: Array<{ role: string; error?: string }> };
    expect(calls).toBe(1);
    expect(snapshot.messages.at(-1)?.error).toBe(AGENT_CONTEXT_OVERFLOW_MESSAGE);
  });

  it('never compacts or retries on a refusal', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return new Response('{"error":{"code":"content_filter","message":"The response was filtered due to the prompt triggering content management policy"}}', { status: 400 });
    }));
    kernel = make();
    await kernel.openSession();
    const events: string[] = [];
    kernel.subscribe(event => { if (event.type.startsWith('compaction')) events.push(event.type); });
    const snapshot = await kernel.send('敏感请求') as { messages: Array<{ role: string; error?: string }> };
    expect(calls).toBe(1);
    expect(events).toEqual([]);
    expect(snapshot.messages.at(-1)?.error).toBeTruthy();
    expect(snapshot.messages.at(-1)?.error).not.toBe(AGENT_CONTEXT_OVERFLOW_MESSAGE);
  });

  it('manual compaction reports nothing to do on a short conversation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('ok')));
    kernel = make();
    await kernel.openSession();
    await kernel.send('短');
    expect(await kernel.compactContext()).toEqual({ compacted: false });
  });
});

describe('browser agent harness: stop during compaction', () => {
  afterEach(async () => { await localforage.removeItem(`flovart.agent.sessions.${PROJECT}-stop`); });

  it('stopping while the pre-send compaction runs ends the turn without sending it', async () => {
    let turns = 0;
    let summaryStarted: () => void = () => undefined;
    const started = new Promise<void>(resolve => { summaryStarted = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      if (isSummaryRequest(body)) {
        summaryStarted();
        return new Response(new ReadableStream({ start(controller) { init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError'))); } }), { status: 200 });
      }
      turns += 1;
      return reply('ok');
    }));
    const kernel = new BrowserAgentKernel({
      projectId: `${PROJECT}-stop`, route, tools: [], confirm: async () => true, systemPrompt: 'SYS', getThinkingLevel: () => 'off',
      skillCatalog: catalog, memory: null, contextWindow: 30_000, compaction: { keepRecentTokens: 1_000 },
    });
    await kernel.openSession();
    for (let index = 0; index < 2; index += 1) await kernel.send('段落 ' + 'q'.repeat(18_000));
    const before = turns;
    const pending = kernel.send('第三段 ' + 'q'.repeat(18_000));
    await started;
    kernel.cancel();
    await expect(pending).rejects.toThrow('已中止');
    expect(turns).toBe(before);
    await kernel.close();
  });
});
