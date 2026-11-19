import localforage from 'localforage';
import { nodeAlternates, primaryVariantId } from '../components/workflow/batchAlternates';
import type { WorkflowNode } from '../components/workflow/types';

/**
 * 「设为首图」偏好事件（eval/eval.md §6、§4.1）：用户从备选里选中一张换成首图时，记一条
 * `{nodeId, chosen, rejected, prompt, model, time}`，作为 L4 的真实偏好信号。
 *
 * - 只记 ID 与类型，不记媒体本体、URL、storageKey；提示词截断。
 * - 只记用户在画布上的选择（actor: user）；Agent 的 workflow.batch.pick 是自动挑选，不是偏好，不在这里记。
 * - 本地 localforage，最多保留 MAX_EVENTS 条；`exportPreferenceEventsJsonl()` 导出给
 *   `node eval/aigc/run.mjs prefs-export --events <file>`，转成 eval/judge `pairs` 的输入。
 */
export const PREFERENCE_EVENT_SCHEMA = 'flovart.preference-event/1';
const MAX_EVENTS = 2000;
const MAX_PROMPT = 2000;
const STORE_KEY = 'events';

export interface PreferenceSide { id: string; type: 'image' | 'video' }
export interface PreferenceEvent {
  schema: typeof PREFERENCE_EVENT_SCHEMA;
  id: string;
  time: string;
  actor: 'user';
  projectId?: string;
  nodeId: string;
  batchId?: string;
  mediaType: 'image' | 'video';
  chosen: PreferenceSide;
  rejected: PreferenceSide[];
  prompt: string;
  model: string | null;
}

const sideType = (type: string): 'image' | 'video' => (type === 'video' ? 'video' : 'image');

/**
 * 从「换之前」的首图节点与被选中的备选 ID 生成事件。rejected = 被换下去的首图 + 与被选中者同一批的其他备选。
 * 找不到备选时返回 null。纯函数。
 */
export function buildPreferenceEvent(owner: WorkflowNode, alternateId: string, options: { now?: Date; projectId?: string; id?: string } = {}): PreferenceEvent | null {
  const alternates = nodeAlternates(owner);
  const chosen = alternates.find(item => item.id === alternateId);
  if (!chosen) return null;
  const outgoing: PreferenceSide = { id: primaryVariantId(owner), type: sideType(owner.type) };
  const siblings = chosen.batchId
    ? alternates.filter(item => item.id !== chosen.id && item.batchId === chosen.batchId).map(item => ({ id: item.id, type: sideType(item.type) }))
    : [];
  const rejected = [outgoing, ...siblings.filter(side => side.id !== outgoing.id)];
  const prompt = String(chosen.metadata.prompt ?? owner.metadata.prompt ?? '').slice(0, MAX_PROMPT);
  const model = chosen.metadata.config?.modelId ?? owner.metadata.config?.modelId ?? null;
  const time = (options.now ?? new Date()).toISOString();
  return {
    schema: PREFERENCE_EVENT_SCHEMA,
    id: options.id ?? `pe-${owner.id}-${chosen.id}-${Date.parse(time)}`,
    time,
    actor: 'user',
    ...(options.projectId ? { projectId: options.projectId } : {}),
    nodeId: owner.id,
    ...(chosen.batchId ? { batchId: chosen.batchId } : {}),
    mediaType: sideType(chosen.type),
    chosen: { id: chosen.id, type: sideType(chosen.type) },
    rejected,
    prompt,
    model,
  };
}

const store = localforage.createInstance({ name: 'iris-eval-v1', storeName: 'preference_events' });
let queue: Promise<unknown> = Promise.resolve();

/** 追加一条事件（串行写，失败不影响画布操作）。 */
export function recordPreferenceEvent(event: PreferenceEvent): Promise<void> {
  const next = queue.then(async () => {
    const existing = (await store.getItem<PreferenceEvent[]>(STORE_KEY)) ?? [];
    await store.setItem(STORE_KEY, [...existing, event].slice(-MAX_EVENTS));
  });
  queue = next.catch(() => undefined);
  return next.catch(() => undefined);
}

export async function listPreferenceEvents(): Promise<PreferenceEvent[]> {
  await queue;
  return (await store.getItem<PreferenceEvent[]>(STORE_KEY)) ?? [];
}

export async function exportPreferenceEventsJsonl(): Promise<string> {
  const events = await listPreferenceEvents();
  return events.map(event => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '');
}

export async function clearPreferenceEvents(): Promise<void> {
  await queue;
  await store.removeItem(STORE_KEY);
}

// 采集链路（eval/eval.md §9.1）用：无头浏览器里 `await window.__irisPreferenceEvents.exportJsonl()` 取出事件。
// 只读，不提供清空或写入。
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__irisPreferenceEvents', {
    value: Object.freeze({ list: listPreferenceEvents, exportJsonl: exportPreferenceEventsJsonl }),
    configurable: true,
  });
}
