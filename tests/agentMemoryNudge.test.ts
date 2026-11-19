// P1-E：确认决定 / 接近压缩 / 刚压缩时提醒写项目记忆；压缩后项目记忆仍在系统提示词里。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';
import { BrowserAgentKernel } from '../services/browserAgentKernel';
import { createInMemoryMemoryBackend, formatMemoryNudge, looksLikeDecisionConfirmation, MEMORY_TOOL_NAME } from '../services/agentProjectMemory';
import type { AgentSkillCatalog } from '../services/agentSkills';

const PROJECT = 'project-memory-nudge';
const route = { provider: 'openai_compatible', model: 'm', baseUrl: 'https://gw.example/v1', apiKey: 'k' };
type Body = { messages: Array<{ role: string; content: unknown }> };
const sse = (chunks: unknown[]) => new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
const reply = (text: string) => sse([{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]);
const isSummaryRequest = (body: Body) => JSON.stringify(body.messages[0]?.content ?? '').includes('context summarization assistant');
const systemOf = (body: Body) => String(body.messages[0]?.role === 'system' ? body.messages[0].content : '');
const catalog: AgentSkillCatalog = { list: () => [], read: async () => null };

describe('memory nudges', () => {
  it('recognises short confirmations and standing decisions, not ordinary requests', () => {
    for (const text of ['好', '确认', '就用这个', '选 B', 'ok', '第二个', '定稿，以后都用 9:16', 'LGTM']) expect(looksLikeDecisionConfirmation(text), text).toBe(true);
    for (const text of ['帮我生成一张海报', '这张图的背景太暗了，能不能调亮一点再给我看看三个版本', '']) expect(looksLikeDecisionConfirmation(text), text).toBe(false);
    expect(formatMemoryNudge({})).toBe('');
    expect(formatMemoryNudge({ confirmation: true })).toContain(MEMORY_TOOL_NAME + ' add');
  });

  let kernel: BrowserAgentKernel | undefined;
  beforeEach(async () => { await localforage.clear(); });
  afterEach(async () => { vi.unstubAllGlobals(); await kernel?.close(); kernel = undefined; await localforage.clear(); });

  it('adds a nudge on confirmation turns and re-injects memory with a post-compaction note', async () => {
    const bodies: Body[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Body;
      if (isSummaryRequest(body)) return reply('## 摘要\n用户在做竖版短片。');
      bodies.push(body);
      return reply('ok');
    }));
    const memory = createInMemoryMemoryBackend();
    await memory.add(PROJECT, { text: '画幅统一 9:16' });
    kernel = new BrowserAgentKernel({
      projectId: PROJECT, route, tools: [], confirm: async () => true, systemPrompt: 'SYS', getThinkingLevel: () => 'off',
      skillCatalog: catalog, memory, contextWindow: 30_000, compaction: { keepRecentTokens: 1_000 },
    });
    await kernel.openSession();
    await kernel.send('帮我想三个分镜');
    expect(systemOf(bodies.at(-1)!)).not.toContain('## 记忆提醒');
    await kernel.send('就用第二个');
    expect(systemOf(bodies.at(-1)!)).toContain('用户这条消息像是在确认一个决定');
    // 把上下文撑过压缩阈值：压缩后的那一轮仍带项目记忆，并说明刚压缩过。
    for (let index = 0; index < 4; index += 1) await kernel.send(`第 ${index + 1} 段 ` + 'z'.repeat(18_000));
    const systems = bodies.map(systemOf);
    expect(systems.some(text => text.includes('上下文刚被压缩'))).toBe(true);
    expect(systems.filter(text => text.includes('上下文刚被压缩')).every(text => text.includes('画幅统一 9:16'))).toBe(true);
  });
});
