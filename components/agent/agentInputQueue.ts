// 运行中输入的「待发送」队列（照 openai/codex TUI 的 pending input preview，Apache-2.0）：
// - Enter = 插话（steer）：在下一个工具 / 结果边界注入当前这一轮；真正被模型循环取走前显示在托盘里。
// - Tab = 排队（queue）：先进先出，这一轮空闲后一次发一条。
// - 最终回复还在流式输出时，Enter 也改为排队（codex #12569 修的竞态）。
// - 托盘顺序：先插话，后排队。停止时全部退回输入框，不发送。
// 这里只放纯函数，面板持有状态（每个会话一份，只在内存里）。

export type PendingInputKind = 'steer' | 'queued';

/** 输入框里一次提交的原始内容：文本 / 引用回复 / @引用 / 附件。斜杠与 Skill 等到出队时才解析。 */
export interface ComposerDraft<R, A> {
  text: string;
  quote: string | null;
  references: R[];
  attachments: A[];
}

/** 托盘里的一条：只要求 id 与类型，面板可以挂上自己的字段（原始草稿、已解析的请求文本等）。 */
export interface QueueItem {
  id: string;
  kind: PendingInputKind;
}

export interface PendingInput<R, A> extends QueueItem {
  draft: ComposerDraft<R, A>;
}

export type RunningSubmitKey = 'enter' | 'tab';

/**
 * 运行中提交走插话还是排队。
 * - Tab 一律排队；
 * - 最终回复正在流式输出时 Enter 也排队，避免插话落在回复结束之后、被当成新一轮之外的孤儿消息；
 * - 不能插话（托管 Agent 没有插话通道、消息带媒体需要异步取画面）时排队。
 */
export function routeRunningSubmit(input: { key: RunningSubmitKey; answerStreaming: boolean; steerable: boolean }): PendingInputKind {
  if (input.key === 'tab') return 'queued';
  if (input.answerStreaming) return 'queued';
  return input.steerable ? 'steer' : 'queued';
}

/** 托盘显示顺序：先插话（马上送达），后排队（按先后）。 */
export function trayOrder<T extends QueueItem>(items: readonly T[]): T[] {
  return [...items.filter(item => item.kind === 'steer'), ...items.filter(item => item.kind === 'queued')];
}

export function queuedCount<T extends QueueItem>(items: readonly T[]): number {
  return items.filter(item => item.kind === 'queued').length;
}

/** 托盘行的单行文本：正文优先，其次引文、引用名、附件名。 */
export function draftPreview<R extends { label: string }, A extends { name: string }>(draft: ComposerDraft<R, A>): string {
  const text = draft.text.trim() || draft.quote?.trim() || '';
  const extras = [...draft.references.map(item => `@${item.label}`), ...draft.attachments.map(item => item.name)];
  return [text, extras.join(' ')].filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
}

/** 取出最后一条排队消息（Alt+↑ / Shift+← 取回编辑）。插话不在可取回之列。 */
export function popLastQueued<T extends QueueItem>(items: readonly T[]): { item?: T; rest: T[] } {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].kind === 'queued') return { item: items[index], rest: [...items.slice(0, index), ...items.slice(index + 1)] };
  }
  return { rest: [...items] };
}

/** 队首（第一条排队的）出队，供这一轮空闲后自动发送。 */
export function shiftQueued<T extends QueueItem>(items: readonly T[]): { next?: T; rest: T[] } {
  const index = items.findIndex(item => item.kind === 'queued');
  if (index < 0) return { rest: [...items] };
  return { next: items[index], rest: [...items.slice(0, index), ...items.slice(index + 1)] };
}

export function removeInput<T extends QueueItem>(items: readonly T[], id: string): T[] {
  return items.filter(item => item.id !== id);
}

/**
 * 这一轮结束仍没送达的插话：转成排队，放在其他排队消息之前（它们本该先到），保持原先后。
 * 不传 ids 时把所有插话都转过去。
 */
export function requeueSteers<T extends QueueItem>(items: readonly T[], ids?: readonly string[]): T[] {
  const pick = (item: T) => item.kind === 'steer' && (!ids || ids.includes(item.id));
  const moved = items.filter(pick).map(item => ({ ...item, kind: 'queued' as const }) as T);
  if (!moved.length) return [...items];
  const rest = items.filter(item => !pick(item));
  const steers = rest.filter(item => item.kind === 'steer');
  const queued = rest.filter(item => item.kind === 'queued');
  return [...steers, ...moved, ...queued];
}

/** 一条排队消息改为插话（↑ 立即发送且内核接受了插话）。 */
export function promoteToSteer<T extends QueueItem>(items: readonly T[], id: string): T[] {
  return items.map(item => (item.id === id ? { ...item, kind: 'steer' as const } as T : item));
}

/** 不能插话时的「立即发送」：挪到排队队首，这一轮一结束就发它。 */
export function moveToFront<T extends QueueItem>(items: readonly T[], id: string): T[] {
  const target = items.find(item => item.id === id);
  if (!target) return [...items];
  const rest = items.filter(item => item.id !== id);
  const steers = rest.filter(item => item.kind === 'steer');
  return [...steers, target, ...rest.filter(item => item.kind === 'queued')];
}

/**
 * 把若干条待发送内容并回输入框（停止时全部退回 / 取回编辑）：按给定顺序，最后接上输入框里正在写的内容。
 * 正文用空行隔开；引用回复取第一条；@引用按 type+id 去重；附件依次拼接。
 */
export function mergeDrafts<R extends { id: string; type: string }, A>(drafts: ReadonlyArray<ComposerDraft<R, A>>, current: ComposerDraft<R, A>): ComposerDraft<R, A> {
  const all = [...drafts, current];
  const references: R[] = [];
  for (const draft of all) {
    for (const reference of draft.references) {
      if (!references.some(item => item.id === reference.id && item.type === reference.type)) references.push(reference);
    }
  }
  return {
    text: all.map(draft => draft.text.trim()).filter(Boolean).join('\n\n'),
    quote: all.find(draft => draft.quote)?.quote ?? null,
    references,
    attachments: all.flatMap(draft => draft.attachments),
  };
}

export function draftIsEmpty<R, A>(draft: ComposerDraft<R, A>): boolean {
  return !draft.text.trim() && !draft.quote && draft.references.length === 0 && draft.attachments.length === 0;
}

export function draftHasContent<R, A>(draft: ComposerDraft<R, A>): boolean {
  return !draftIsEmpty(draft);
}
