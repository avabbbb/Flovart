// 流式气泡的纯更新：正文增量与思考增量分开累积在同一条助手消息上。
// 思考开始时记下时间；第一段正文到来时思考「完成」并定格用时（自动收起）。
import type { WorkflowAgentDisplayMessage } from '../workflow/WorkflowAgentMessages';

/** 思考增量：没有这条消息就新建（正文为空），已有就追加；正文已开始后的思考照样追加但不再改计时。 */
export function applyThinkingDelta(
  items: WorkflowAgentDisplayMessage[],
  id: string,
  delta: string,
  now: number,
): WorkflowAgentDisplayMessage[] {
  if (!delta) return items;
  if (!items.some(item => item.id === id)) {
    return [...items, { id, role: 'assistant', text: '', thinking: delta, thinkingStartedAt: now }];
  }
  return items.map(item => item.id === id
    ? { ...item, thinking: (item.thinking || '') + delta, thinkingStartedAt: item.thinkingStartedAt ?? now }
    : item);
}

/** 正文增量：第一段正文到来时，若正在思考就定格思考用时并标记完成。 */
export function applyTextDelta(
  items: WorkflowAgentDisplayMessage[],
  id: string,
  delta: string,
  now: number,
): WorkflowAgentDisplayMessage[] {
  if (!items.some(item => item.id === id)) return [...items, { id, role: 'assistant', text: delta }];
  return items.map(item => item.id === id ? { ...finishThinking(item, now), text: item.text + delta } : item);
}

/** 思考结束（正文开始、工具调用开始或本轮结束）：定格用时；已完成或没有思考时原样返回。 */
export function finishThinking(item: WorkflowAgentDisplayMessage, now: number): WorkflowAgentDisplayMessage {
  if (!item.thinking || item.thinkingDone) return item;
  const startedAt = item.thinkingStartedAt ?? now;
  return { ...item, thinkingDone: true, thinkingMs: item.thinkingMs ?? Math.max(0, now - startedAt) };
}

/** 把某条消息上进行中的思考收尾（例如这条助手消息直接转去调工具）。 */
export function finishThinkingById(items: WorkflowAgentDisplayMessage[], id: string, now: number): WorkflowAgentDisplayMessage[] {
  return items.some(item => item.id === id && item.thinking && !item.thinkingDone)
    ? items.map(item => item.id === id ? finishThinking(item, now) : item)
    : items;
}

/**
 * 回合结束的快照会整体替换消息；快照里的工具卡只有结果文字。把实时卡片上的参数、结果原文（含图片，用于缩略图）
 * 与真实起止时间按 toolCallId 接回去，否则一结束缩略图和用时就消失。思考用时同理：快照没有时沿用实时定格值。
 */
export function carryLiveState(
  previous: readonly WorkflowAgentDisplayMessage[],
  next: WorkflowAgentDisplayMessage[],
): WorkflowAgentDisplayMessage[] {
  const live = new Map(previous.map(item => [item.id, item]));
  const liveAssistants = previous.filter(item => item.role === 'assistant' && item.thinking);
  return next.map(item => {
    if (item.role === 'tool') {
      const before = item.toolCallId ? live.get('tool-' + item.toolCallId) : undefined;
      if (!before) return item;
      return {
        ...item,
        args: item.args ?? before.args,
        detail: item.detail ?? (before.detail === before.args ? undefined : before.detail),
        startedAt: item.startedAt ?? before.startedAt,
        endedAt: item.endedAt ?? before.endedAt,
      };
    }
    if (item.role === 'assistant' && item.thinking && item.thinkingMs === undefined) {
      const before = liveAssistants.find(candidate => candidate.thinking === item.thinking);
      if (before?.thinkingMs !== undefined) return { ...item, thinkingMs: before.thinkingMs };
    }
    return item;
  });
}
