import { describe, expect, it } from 'vitest';
import { createTodoTool, normalizeTodoList } from '../agent/todo.js';
import { createFlovartAgentTools } from '../agent/tools.js';
import { latestTodoFromMessages, todoFromToolResult } from '../components/agent/agentTodo';

type ToolOut = { details: { isError?: boolean }; content: Array<{ type: string; text: string }> };

describe('agent todo tool', () => {
  it('normalizes a full list and summarizes progress', () => {
    const todo = normalizeTodoList({ items: [
      { id: 'anchor', content: '建立角色锁点', status: 'done' },
      { id: 'shots', content: '拆镜', status: 'active' },
      { id: 'merge', content: '拼接成片', status: 'pending' },
    ] });
    expect(todo.summary).toEqual({ total: 3, done: 1, active: 1, blocked: 0, pending: 1 });
  });

  it('rejects two active items and blocked items without a note', () => {
    expect(() => normalizeTodoList({ items: [{ id: 'a', content: 'x', status: 'active' }, { id: 'b', content: 'y', status: 'active' }] })).toThrow(/active/);
    expect(() => normalizeTodoList({ items: [{ id: 'a', content: 'x', status: 'blocked' }] })).toThrow(/note/);
    expect(() => normalizeTodoList({ items: [{ id: 'a', content: 'x' }, { id: 'a', content: 'y' }] })).toThrow(/重复/);
  });

  it('returns a structured error instead of throwing, and the panel parser round-trips', async () => {
    const tool = createTodoTool();
    const bad = (await tool.execute('t1', { items: [{ id: 'a', content: 'x', status: 'blocked' }] })) as unknown as ToolOut;
    expect(bad.details.isError).toBe(true);
    expect(todoFromToolResult(bad)).toBeNull();
    const good = (await tool.execute('t2', { items: [{ id: 'a', content: '锁点', status: 'active' }] })) as unknown as ToolOut;
    expect(todoFromToolResult(good)).toEqual([{ id: 'a', content: '锁点', status: 'active' }]);
    expect(latestTodoFromMessages([
      { role: 'tool', toolName: 'flovart_todo', text: good.content[0].text },
      { role: 'tool', toolName: 'flovart_todo', text: bad.content[0].text, isError: true },
    ])).toEqual([{ id: 'a', content: '锁点', status: 'active' }]);
  });
});

describe('agent tool failures', () => {
  it('returns budget failures to the model as structured results with progress updates', async () => {
    const tools = createFlovartAgentTools(async () => ({ ok: false, error: { code: 'BUDGET_EXCEEDED', message: '预算不足' } }));
    const run = tools.find(tool => tool.name.includes('node_run'));
    expect(run).toBeTruthy();
    const updates: unknown[] = [];
    const result = (await run!.execute('c1', { projectId: 'p', nodeIds: ['n1'], idempotencyKey: 'k1' } as never, undefined, (update: unknown) => updates.push(update))) as unknown as ToolOut;
    expect(result.details.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error.code).toBe('BUDGET_EXCEEDED');
    expect(updates).toHaveLength(1);
  });
});
