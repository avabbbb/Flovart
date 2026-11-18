// 解析 flovart_todo 工具结果（与 agent/todo.js 的输出同构），供 Agent 面板渲染任务清单。
export type AgentTodoStatus = 'pending' | 'active' | 'blocked' | 'done';
export interface AgentTodoItem { id: string; content: string; status: AgentTodoStatus; note?: string }
export const AGENT_TODO_TOOL_NAME = 'flovart_todo';
const STATUSES: readonly AgentTodoStatus[] = ['pending', 'active', 'blocked', 'done'];

function itemsFrom(value: unknown): AgentTodoItem[] | null {
  const items = (value as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return null;
  return items.flatMap((raw, index) => {
    const item = raw as Partial<AgentTodoItem> | null;
    const content = String(item?.content || '').trim();
    if (!content) return [];
    const status: AgentTodoStatus = STATUSES.includes(item?.status as AgentTodoStatus) ? item?.status as AgentTodoStatus : 'pending';
    return [{ id: String(item?.id || index + 1), content, status, ...(item?.note ? { note: String(item.note) } : {}) }];
  });
}

export function todoFromText(text: string): AgentTodoItem[] | null {
  try {
    const parsed = JSON.parse(text) as { ok?: boolean };
    return parsed?.ok === false ? null : itemsFrom(parsed);
  } catch {
    return null;
  }
}

// 从工具结果中取清单：优先 details.todo，其次 content 文本里的 JSON；失败结果返回 null。
export function todoFromToolResult(result: unknown): AgentTodoItem[] | null {
  const record = result as { details?: { todo?: unknown; isError?: boolean }; content?: Array<{ type?: string; text?: string }> } | null;
  if (!record || record.details?.isError) return null;
  const fromDetails = itemsFrom(record.details?.todo);
  if (fromDetails) return fromDetails;
  const text = record.content?.find(block => block?.type === 'text')?.text;
  return text ? todoFromText(text) : null;
}

// 会话恢复时从快照消息里取最近一次成功的清单。
export function latestTodoFromMessages(messages: ReadonlyArray<{ role: string; toolName?: string; text?: string; isError?: boolean }>): AgentTodoItem[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'tool' || message.toolName !== AGENT_TODO_TOOL_NAME || message.isError) continue;
    const items = todoFromText(message.text || '');
    if (items) return items;
  }
  return null;
}

export function todoProgress(items: readonly AgentTodoItem[]) {
  return { done: items.filter(item => item.status === 'done').length, total: items.length };
}

/**
 * 执行计划卡里受阻步的「确认 / 拒绝」落到哪条路径：
 * - 有等待中的生成计划确认 → 「创建并自动生成」/「调整后再创建」；
 * - 有等待中的其它工具确认 → 本次允许 / 拒绝；
 * - 都没有（模型只把待办标成 blocked、在正文里问）→ 替用户回一句话。
 */
export type BlockedTodoAction =
  | { kind: 'run-plan'; decision: 'auto' | 'adjust' }
  | { kind: 'confirm'; approved: boolean }
  | { kind: 'send'; text: string };

export function blockedTodoAction(
  pending: { isRunPlan: boolean } | null | undefined,
  approved: boolean,
  messages: { confirm: string; skip: string },
): BlockedTodoAction {
  if (pending) return pending.isRunPlan ? { kind: 'run-plan', decision: approved ? 'auto' : 'adjust' } : { kind: 'confirm', approved };
  return { kind: 'send', text: approved ? messages.confirm : messages.skip };
}
