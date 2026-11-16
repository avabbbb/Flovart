import { describe, expect, it } from 'vitest';
import localforage from 'localforage';
import {
  addMemoryEntry,
  createInMemoryMemoryBackend,
  createMemoryTool,
  formatMemorySummary,
  MEMORY_MAX_ENTRIES,
  redactMemorySecrets,
  REDACTED,
  searchMemoryEntries,
  type AgentMemoryEntry,
} from '../services/agentProjectMemory';
import { agentMemoryStoreBackend, useAgentMemoryStore } from '../stores/useAgentMemoryStore';

const textOf = (result: { content: Array<{ type: string; text?: string }> }) => result.content.map(block => block.text || '').join('');

describe('memory redaction', () => {
  it.each([
    ['我的 key 是 sk-proj-AbCdEf1234567890XYZabc', 'sk-proj'],
    ['api_key=abcd1234efgh5678', 'abcd1234efgh5678'],
    ['密码：hunter2hunter', 'hunter2hunter'],
    ['token: "ghp_abcdefghijklmnopqrstuvwxyz0123"', 'ghp_'],
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEFghiJKL', 'eyJhbGci'],
    ['回调 https://x.example/cb?token=abc123def&lang=zh', 'abc123def'],
    ['AWS AKIAIOSFODNN7EXAMPLE 用于上传', 'AKIAIOSFODNN7EXAMPLE'],
    ['裸 key a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8', 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'],
  ])('redacts %s', (input, secret) => {
    const { text, redacted } = redactMemorySecrets(input);
    expect(redacted).toBe(true);
    expect(text).not.toContain(secret);
    expect(text).toContain(REDACTED);
  });

  it('keeps ordinary creative facts and UUIDs untouched', () => {
    for (const input of ['主角叫小林，短发，穿红色风衣', '画幅统一 9:16，时长 15 秒', '锚点 A01 已确认（节点 3f2b9c1e-8a7d-4c2e-9b1a-0d5e6f7a8b9c）']) {
      expect(redactMemorySecrets(input)).toEqual({ text: input, redacted: false });
    }
  });
});

describe('memory list rules', () => {
  const at = (index: number): AgentMemoryEntry => ({ id: `id-${index}`, text: `fact ${index}`, createdAt: index, updatedAt: index });

  it('evicts the oldest entries beyond the 100-entry cap', () => {
    const full = Array.from({ length: MEMORY_MAX_ENTRIES }, (_, index) => at(index));
    const result = addMemoryEntry(full, { text: '新的事实' }, { now: 10_000, id: 'new' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries).toHaveLength(MEMORY_MAX_ENTRIES);
    expect(result.entries[0].id).toBe('new');
    expect(result.evicted.map(entry => entry.id)).toEqual(['id-0']);
    expect(result.entries.some(entry => entry.id === 'id-0')).toBe(false);
  });

  it('refreshes duplicates, rejects empty / secret-only / overlong text', () => {
    const first = addMemoryEntry([], { text: '风格：纸艺拼贴' }, { now: 1, id: 'a' });
    if (!first.ok) throw new Error('add failed');
    const dup = addMemoryEntry(first.entries, { text: '  风格：纸艺拼贴 ' }, { now: 5 });
    expect(dup.ok && dup.duplicate && dup.entries.length === 1 && dup.entry.updatedAt === 5).toBe(true);
    expect(addMemoryEntry([], { text: '   ' }).ok).toBe(false);
    expect(addMemoryEntry([], { text: 'sk-abcdefghijklmnopqrstuvwxyz123456' }).ok).toBe(false);
    expect(addMemoryEntry([], { text: 'x'.repeat(501) }).ok).toBe(false);
    const redacted = addMemoryEntry([], { text: 'DeepSeek key: sk-abcdefghijklmnopqrst1234 只在本机' });
    expect(redacted.ok && redacted.redacted && !redacted.entry.text.includes('sk-')).toBe(true);
  });

  it('searches by terms and formats a bounded summary', () => {
    const entries = [at(1), { ...at(2), text: '主角 小林 红色风衣', tags: ['角色'] }, { ...at(3), text: '配乐用 lo-fi' }];
    expect(searchMemoryEntries(entries, '小林 角色').map(entry => entry.id)).toEqual(['id-2']);
    expect(searchMemoryEntries(entries, '不存在')).toEqual([]);
    const summary = formatMemorySummary(entries);
    expect(summary).toContain('## 项目记忆');
    expect(summary.indexOf('lo-fi')).toBeLessThan(summary.indexOf('fact 1'));
    const many = Array.from({ length: 100 }, (_, index) => ({ ...at(index), text: '很长的事实'.repeat(20) }));
    const bounded = formatMemorySummary(many, 500);
    expect(bounded).toContain('未列出');
    expect(formatMemorySummary([])).toBe('');
  });
});

describe('flovart_memory tool', () => {
  it('adds, lists, searches and deletes within one project only', async () => {
    const backend = createInMemoryMemoryBackend();
    const tool = createMemoryTool({ projectId: 'p1', backend });
    const other = createMemoryTool({ projectId: 'p2', backend });
    const run = (target: typeof tool, params: Record<string, unknown>) => target.execute('c', params as never, undefined as never) as Promise<{ content: Array<{ type: string; text?: string }>; details: Record<string, unknown> }>;
    const added = await run(tool, { action: 'add', text: '用户偏好竖屏 9:16，token=abcd1234secret', tags: ['画幅'] });
    expect(textOf(added)).toContain('已脱敏');
    expect(added.details.redacted).toBe(true);
    expect(textOf(await run(tool, { action: 'list' }))).toContain('竖屏');
    expect(textOf(await run(other, { action: 'list' }))).toContain('还没有记忆');
    expect(textOf(await run(tool, { action: 'search', query: '画幅' }))).toContain('9:16');
    const id = String(added.details.id).slice(0, 8);
    expect(textOf(await run(tool, { action: 'delete', id }))).toContain('已删除');
    expect((await backend.list('p1'))).toHaveLength(0);
    expect((await run(tool, { action: 'delete', id: 'missing' })).details.isError).toBe(true);
    expect((await run(tool, { action: 'add', text: '' })).details.isError).toBe(true);
  });
});

describe('memory store persistence', () => {
  it('persists per project through localforage', async () => {
    await useAgentMemoryStore.getState().clear('mem-test');
    const result = await agentMemoryStoreBackend.add('mem-test', { text: '记住：片尾统一用品牌色' });
    expect(result.ok).toBe(true);
    const stored = await localforage.createInstance({ name: 'flovart', storeName: 'agent-memory' }).getItem<AgentMemoryEntry[]>('project.mem-test');
    expect(stored?.map(entry => entry.text)).toEqual(['记住：片尾统一用品牌色']);
    expect((await agentMemoryStoreBackend.list('mem-test')).map(entry => entry.text)).toEqual(['记住：片尾统一用品牌色']);
    if (result.ok) await agentMemoryStoreBackend.remove('mem-test', result.entry.id);
    expect(await agentMemoryStoreBackend.list('mem-test')).toEqual([]);
  });
});
