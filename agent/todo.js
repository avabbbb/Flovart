// Agent 任务清单（参考 omp 的 todo 工具）：模型每次提交完整清单，这里只做校验并回显；
// 前端从 flovart_todo 的工具事件里取最新清单渲染。清单不触达画布、不计费。
import { Type } from 'typebox';

export const TODO_TOOL_NAME = 'flovart_todo';
export const TODO_STATUSES = ['pending', 'active', 'blocked', 'done'];
export const TODO_MAX_ITEMS = 20;

export function summarizeTodo(items) {
  const count = status => items.filter(item => item.status === status).length;
  return { total: items.length, done: count('done'), active: count('active'), blocked: count('blocked'), pending: count('pending') };
}

export function normalizeTodoList(input) {
  const items = Array.isArray(input?.items) ? input.items : null;
  if (!items) throw new Error('items 必须是数组');
  if (items.length > TODO_MAX_ITEMS) throw new Error('清单最多 ' + TODO_MAX_ITEMS + ' 项');
  const seen = new Set();
  const normalized = items.map((item, index) => {
    const id = String(item?.id || index + 1).trim();
    const content = String(item?.content || '').trim();
    const status = TODO_STATUSES.includes(item?.status) ? item.status : 'pending';
    if (!content) throw new Error('第 ' + (index + 1) + ' 项缺少 content');
    if (seen.has(id)) throw new Error('清单 id 重复：' + id);
    seen.add(id);
    const note = item?.note ? String(item.note).trim().slice(0, 200) : '';
    if (status === 'blocked' && !note) throw new Error('blocked 项需要 note 说明阻塞原因：' + id);
    return { id, content: content.slice(0, 120), status, ...(note ? { note } : {}) };
  });
  if (normalized.filter(item => item.status === 'active').length > 1) throw new Error('同一时间只能有一项 active');
  return { items: normalized, summary: summarizeTodo(normalized) };
}

export function createTodoTool() {
  return {
    name: TODO_TOOL_NAME,
    label: '任务清单',
    description: '维护本轮制作的可见任务清单。每次提交完整清单；status 取 pending/active/blocked/done，同时最多一项 active，blocked 必须写 note。多步制作（锁点、拆镜、批量生成、拼接）开始前先建清单，每完成一步更新一次；单步小改动不要建清单。',
    parameters: Type.Object({
      items: Type.Array(Type.Object({
        id: Type.String({ minLength: 1 }),
        content: Type.String({ minLength: 1 }),
        status: Type.Union(TODO_STATUSES.map(value => Type.Literal(value))),
        note: Type.Optional(Type.String()),
      }, { additionalProperties: false }), { maxItems: TODO_MAX_ITEMS }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    async execute(_toolCallId, input) {
      try {
        const todo = normalizeTodoList(input);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...todo }) }], details: { command: 'todo', todo } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { code: 'BAD_REQUEST', message } }) }], details: { command: 'todo', isError: true } };
      }
    },
  };
}
