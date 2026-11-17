import { undoWorkflowDraftChangeSet } from './draftAuthority';
import type {
  WorkflowConnection,
  WorkflowDraftActor,
  WorkflowDraftChangeSet,
  WorkflowNode,
  WorkflowProject,
} from './types';

// 画布操作 Timeline：一行一句人话（谁 · 做了什么 · 哪些节点 · rev）。
// 数据来源是已有的 draftChangeSets（每次写入画布的唯一权威记录，带 before/after 与 rev），
// 再加上 timelineEvents 里不走 ChangeSet 的生成结果。这里只做纯函数：摘要、分组、恢复帧推算。

export type TimelineLanguage = 'zho' | 'en';
export type TimelineActor = 'you' | 'agent' | 'external';
export type TimelineRange = 'day' | 'week' | 'month';

export interface WorkflowTimelineEntry {
  id: string;
  kind: 'change' | 'generation';
  at: string;
  revision: number;
  actor: TimelineActor;
  text: string;
  nodeIds: string[];
  /** ChangeSet 已被撤销（仍保留在列表里，弱化显示）。 */
  undone: boolean;
  /** 只有仍在 ChangeSet 窗口内、未撤销的修改可以「恢复到此版本」。 */
  changeSetId?: string;
}

/** 生成结果事件：生成走 store.updateProject，不产生 ChangeSet，单独记录。 */
export interface WorkflowTimelineEvent {
  id: string;
  projectId: string;
  at: string;
  revision: number;
  actor: TimelineActor;
  kind: 'generated' | 'failed';
  mediaType: 'image' | 'video' | 'audio' | 'text';
  nodeIds: string[];
  nodeTitles: string[];
  count?: number;
}

export const actorFromDraftActor = (actor: WorkflowDraftActor): TimelineActor => (
  actor === 'agent' ? 'agent' : actor === 'cli' || actor === 'operator' ? 'external' : 'you'
);

const ACTOR_LABEL: Record<TimelineLanguage, Record<TimelineActor, string>> = {
  zho: { you: '你', agent: 'Agent', external: '外部 Agent' },
  en: { you: 'You', agent: 'Agent', external: 'External agent' },
};
export const timelineActorLabel = (actor: TimelineActor, language: TimelineLanguage) => ACTOR_LABEL[language][actor];

const TYPE_LABEL: Record<TimelineLanguage, Record<string, string>> = {
  zho: { image: '图片', video: '视频', audio: '音频', text: '文本', config: '配置', script: '脚本', operation: '操作', design: '设计', subgraph: '子画布', group: '分组' },
  en: { image: 'image', video: 'video', audio: 'audio', text: 'text', config: 'config', script: 'script', operation: 'operation', design: 'design', subgraph: 'subgraph', group: 'group' },
};

const isGroupFrame = (node?: WorkflowNode) => Boolean(node && node.type === 'subgraph' && node.metadata?.groupKind === 'group');
const typeOf = (node: WorkflowNode) => (isGroupFrame(node) ? 'group' : node.type);
const nodeTitle = (node: WorkflowNode | undefined, fallback: string) => (node?.title?.trim() || fallback);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function quote(names: string[], language: TimelineLanguage) {
  const shown = names.slice(0, 2);
  const list = language === 'zho' ? shown.map(name => `「${name}」`).join('、') : shown.map(name => `“${name}”`).join(', ');
  if (names.length <= 2) return list;
  return language === 'zho' ? `${list} 等 ${names.length} 个节点` : `${list} and ${names.length - 2} more`;
}

/** 名字多于 2 个时说数量，更像一句话；只有 1–2 个时直接点名。 */
function subject(names: string[], language: TimelineLanguage, noun?: string) {
  if (names.length > 2) return language === 'zho' ? ` ${names.length} 个${noun || '节点'}` : `${names.length} ${noun ? noun + 's' : 'nodes'}`;
  return quote(names, language);
}

type Clause = { weight: number; zho: string; en: string; nodeIds: string[] };

function mediaChanged(before: WorkflowNode, after: WorkflowNode) {
  const b = before.metadata || {};
  const a = after.metadata || {};
  return Boolean((a.storageKey && a.storageKey !== b.storageKey) || (a.href && a.href !== b.href && !a.storageKey));
}

/** 只比较除 metadata 外的结构字段 + metadata 的 key 列表，找出这次 update 改了哪一类东西。 */
function updateKinds(before: WorkflowNode, after: WorkflowNode) {
  const kinds = new Set<string>();
  if (!same(before.position, after.position)) kinds.add('move');
  if (before.width !== after.width || before.height !== after.height) kinds.add('resize');
  if (before.title !== after.title) kinds.add('rename');
  if (Boolean(before.isLocked) !== Boolean(after.isLocked)) kinds.add(after.isLocked ? 'lock' : 'unlock');
  if ((before.isVisible !== false) !== (after.isVisible !== false)) kinds.add(after.isVisible === false ? 'hide' : 'show');
  if ((before.batchId || '') !== (after.batchId || '')) kinds.add(after.batchId ? 'batch' : 'unbatch');
  if ((before.parentId || '') !== (after.parentId || '')) kinds.add(after.parentId ? 'into-group' : 'out-of-group');
  const b = before.metadata || {};
  const a = after.metadata || {};
  if ((b.prompt || '') !== (a.prompt || '')) kinds.add('prompt');
  const becameSuccess = a.status === 'success' && b.status !== 'success';
  if (mediaChanged(before, after)) kinds.add(becameSuccess || b.status === 'loading' ? 'generated' : 'media');
  else if (a.status === 'error' && b.status !== 'error') kinds.add('failed');
  else if (a.status === 'loading' && b.status !== 'loading') kinds.add('run');
  const metaKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const ignored = new Set(['prompt', 'status', 'storageKey', 'href', 'error', 'progress', 'generationTransfer', 'generationRequestId', 'generationProviderTaskId', 'mimeType', 'naturalWidth', 'naturalHeight', 'bytes', 'posterStorageKey', 'previewStorageKey', 'name', 'durationMs', 'updatedAt']);
  const otherMeta = [...metaKeys].some(key => !ignored.has(key) && !same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  const otherShape = !same(before.shot, after.shot) || !same(before.anchor, after.anchor) || before.type !== after.type;
  if (otherMeta || otherShape) kinds.add('edit');
  return kinds;
}

/**
 * 把一个 ChangeSet 归纳成不含主语的一句话（「添加了图片节点「图片 3」」）。
 * 结构性动作优先（分组 > 增删 > 生成 > 提示词 > 连线 > 移动），最多说两件，余下「等」。
 */
export function describeChangeSet(changeSet: Pick<WorkflowDraftChangeSet, 'nodeChanges' | 'connectionChanges' | 'nodeOrderBefore' | 'nodeOrderAfter' | 'intent'>, language: TimelineLanguage, lookup: (id: string) => WorkflowNode | undefined = () => undefined): { text: string; nodeIds: string[] } {
  const zh = language === 'zho';
  const clauses: Clause[] = [];
  const allIds = () => changeSet.nodeChanges.filter(change => change.after).map(change => change.id);
  // 恢复类修改：说「恢复」本身，而不是把它拆成一串增删。
  const restoredTo = /^恢复到 rev (\d+)/.exec(changeSet.intent || '');
  if (restoredTo) return { text: zh ? `把画布恢复到 rev ${restoredTo[1]}` : `restored the canvas to rev ${restoredTo[1]}`, nodeIds: allIds() };
  if ((changeSet.intent || '').startsWith('恢复快照')) return { text: zh ? '恢复了一个快照' : 'restored a snapshot', nodeIds: allIds() };
  const nodeName = (id: string, before?: WorkflowNode, after?: WorkflowNode) => nodeTitle(after || before || lookup(id), zh ? '未命名节点' : 'untitled node');

  const added = changeSet.nodeChanges.filter(change => !change.before && change.after);
  const removed = changeSet.nodeChanges.filter(change => change.before && !change.after);
  const updated = changeSet.nodeChanges.filter(change => change.before && change.after);

  // 分组：新建了分组框，成员 parentId 指向它。
  const addedGroups = added.filter(change => isGroupFrame(change.after));
  const removedGroups = removed.filter(change => isGroupFrame(change.before));
  const groupedMemberIds = new Set<string>();
  addedGroups.forEach(group => {
    const members = updated.filter(change => change.after!.parentId === group.id && change.before!.parentId !== group.id);
    members.forEach(member => groupedMemberIds.add(member.id));
    const names = members.map(member => nodeName(member.id, member.before, member.after));
    clauses.push({
      weight: 100,
      zho: names.length ? `把${subject(names, 'zho')}编成分组「${nodeName(group.id, undefined, group.after)}」` : `新建了分组「${nodeName(group.id, undefined, group.after)}」`,
      en: names.length ? `grouped ${subject(names, 'en')} into “${nodeName(group.id, undefined, group.after)}”` : `created group “${nodeName(group.id, undefined, group.after)}”`,
      nodeIds: [group.id, ...members.map(member => member.id)],
    });
  });
  removedGroups.forEach(group => {
    const members = updated.filter(change => change.before!.parentId === group.id && change.after!.parentId !== group.id);
    members.forEach(member => groupedMemberIds.add(member.id));
    clauses.push({
      weight: 95,
      zho: `解散了分组「${nodeName(group.id, group.before)}」`,
      en: `ungrouped “${nodeName(group.id, group.before)}”`,
      nodeIds: members.map(member => member.id),
    });
  });

  const plainAdded = added.filter(change => !isGroupFrame(change.after));
  if (plainAdded.length) {
    const names = plainAdded.map(change => nodeName(change.id, undefined, change.after));
    const types = [...new Set(plainAdded.map(change => typeOf(change.after!)))];
    const noun = types.length === 1 ? TYPE_LABEL[language][types[0]] || types[0] : '';
    clauses.push({
      weight: 90,
      zho: names.length > 2 ? `添加了 ${names.length} 个${noun}节点` : `添加了${noun}节点${quote(names, 'zho')}`,
      en: names.length > 2 ? `added ${names.length} ${noun ? noun + ' ' : ''}nodes` : `added ${noun ? noun + ' ' : ''}node ${quote(names, 'en')}`,
      nodeIds: plainAdded.map(change => change.id),
    });
  }
  const plainRemoved = removed.filter(change => !isGroupFrame(change.before));
  if (plainRemoved.length) {
    const names = plainRemoved.map(change => nodeName(change.id, change.before));
    clauses.push({
      weight: 85,
      zho: names.length > 2 ? `删除了 ${names.length} 个节点` : `删除了${quote(names, 'zho')}`,
      en: names.length > 2 ? `deleted ${names.length} nodes` : `deleted ${quote(names, 'en')}`,
      nodeIds: [],
    });
  }

  const byKind = new Map<string, typeof updated>();
  updated.forEach(change => {
    // 分组框随成员自动伸缩 / 成员进出分组已经由分组句子说过。
    if (isGroupFrame(change.after) && !groupedMemberIds.has(change.id)) {
      const kinds = updateKinds(change.before!, change.after!);
      if ([...kinds].every(kind => kind === 'move' || kind === 'resize' || kind === 'edit') && changeSet.nodeChanges.length > 1) return;
    }
    updateKinds(change.before!, change.after!).forEach(kind => {
      if (groupedMemberIds.has(change.id) && (kind === 'into-group' || kind === 'out-of-group' || kind === 'move')) return;
      byKind.set(kind, [...(byKind.get(kind) || []), change]);
    });
  });
  const names = (list: typeof updated) => list.map(change => nodeName(change.id, change.before, change.after));
  const push = (kind: string, weight: number, zho: (n: string[]) => string, en: (n: string[]) => string) => {
    const list = byKind.get(kind);
    if (!list?.length) return;
    clauses.push({ weight, zho: zho(names(list)), en: en(names(list)), nodeIds: list.map(change => change.id) });
  };
  push('generated', 80, n => {
    const list = byKind.get('generated')!;
    const types = [...new Set(list.map(change => change.after!.type))];
    const noun = types.length === 1 && (types[0] === 'video' || types[0] === 'audio') ? TYPE_LABEL.zho[types[0]] : '图片';
    return n.length > 2 ? `生成了 ${n.length} 个${noun}` : `在${quote(n, 'zho')}生成了${noun}`;
  }, n => {
    const list = byKind.get('generated')!;
    const types = [...new Set(list.map(change => change.after!.type))];
    const noun = types.length === 1 && (types[0] === 'video' || types[0] === 'audio') ? types[0] : 'image';
    return n.length > 2 ? `generated ${n.length} ${noun}s` : `generated ${noun === 'image' ? 'an image' : `a ${noun}`} in ${quote(n, 'en')}`;
  });
  push('batch', 75, n => `把${subject(n, 'zho')}叠成一组`, n => `stacked ${subject(n, 'en')}`);
  push('unbatch', 74, n => `把${subject(n, 'zho')}拆出叠放`, n => `unstacked ${subject(n, 'en')}`);
  push('into-group', 73, n => `把${subject(n, 'zho')}移进分组`, n => `moved ${subject(n, 'en')} into a group`);
  push('out-of-group', 72, n => `把${subject(n, 'zho')}移出分组`, n => `moved ${subject(n, 'en')} out of a group`);
  push('prompt', 70, n => `修改了${subject(n, 'zho')}的提示词`, n => `edited the prompt of ${subject(n, 'en')}`);
  push('media', 68, n => `替换了${subject(n, 'zho')}的媒体`, n => `replaced the media in ${subject(n, 'en')}`);
  push('failed', 66, n => `在${quote(n, 'zho')}生成失败`, n => `generation failed in ${quote(n, 'en')}`);
  push('run', 64, n => `运行了${subject(n, 'zho')}`, n => `ran ${subject(n, 'en')}`);
  push('rename', 60, n => `重命名了${subject(n, 'zho')}`, n => `renamed ${subject(n, 'en')}`);

  const addedConnections = changeSet.connectionChanges.filter(change => !change.before && change.after);
  const removedConnections = changeSet.connectionChanges.filter(change => change.before && !change.after);
  const endpoint = (id: string) => {
    const change = changeSet.nodeChanges.find(item => item.id === id);
    return nodeName(id, change?.before, change?.after);
  };
  const touchedByNodeClause = new Set([...plainAdded, ...plainRemoved].map(change => change.id));
  const visibleConnection = (connection: WorkflowConnection) => !touchedByNodeClause.has(connection.fromNodeId) && !touchedByNodeClause.has(connection.toNodeId);
  const newLinks = addedConnections.map(change => change.after!).filter(visibleConnection);
  if (newLinks.length) {
    const first = newLinks[0];
    clauses.push({
      weight: 55,
      zho: newLinks.length > 1 ? `连接了 ${newLinks.length} 条连线` : `连接了「${endpoint(first.fromNodeId)}」→「${endpoint(first.toNodeId)}」`,
      en: newLinks.length > 1 ? `connected ${newLinks.length} links` : `connected “${endpoint(first.fromNodeId)}” → “${endpoint(first.toNodeId)}”`,
      nodeIds: [...new Set(newLinks.flatMap(link => [link.fromNodeId, link.toNodeId]))],
    });
  }
  const goneLinks = removedConnections.map(change => change.before!).filter(visibleConnection);
  if (goneLinks.length) {
    const first = goneLinks[0];
    clauses.push({
      weight: 54,
      zho: goneLinks.length > 1 ? `断开了 ${goneLinks.length} 条连线` : `断开了「${endpoint(first.fromNodeId)}」→「${endpoint(first.toNodeId)}」`,
      en: goneLinks.length > 1 ? `removed ${goneLinks.length} links` : `disconnected “${endpoint(first.fromNodeId)}” → “${endpoint(first.toNodeId)}”`,
      nodeIds: [...new Set(goneLinks.flatMap(link => [link.fromNodeId, link.toNodeId]))],
    });
  }
  const rewired = changeSet.connectionChanges.filter(change => change.before && change.after);
  if (rewired.length && !newLinks.length && !goneLinks.length) {
    clauses.push({ weight: 50, zho: `调整了 ${rewired.length} 条连线`, en: `rewired ${rewired.length} link${rewired.length > 1 ? 's' : ''}`, nodeIds: [] });
  }

  push('edit', 45, n => `编辑了${subject(n, 'zho')}`, n => `edited ${subject(n, 'en')}`);
  push('lock', 42, n => `锁定了${subject(n, 'zho')}`, n => `locked ${subject(n, 'en')}`);
  push('unlock', 41, n => `解锁了${subject(n, 'zho')}`, n => `unlocked ${subject(n, 'en')}`);
  push('hide', 40, n => `隐藏了${subject(n, 'zho')}`, n => `hid ${subject(n, 'en')}`);
  push('show', 39, n => `显示了${subject(n, 'zho')}`, n => `showed ${subject(n, 'en')}`);
  push('resize', 32, n => `调整了${subject(n, 'zho')}的尺寸`, n => `resized ${subject(n, 'en')}`);
  push('move', 30, n => `移动了${subject(n, 'zho')}`, n => `moved ${subject(n, 'en')}`);

  if (!clauses.length && changeSet.nodeOrderBefore && changeSet.nodeOrderAfter && !same(changeSet.nodeOrderBefore, changeSet.nodeOrderAfter)) {
    clauses.push({ weight: 20, zho: '调整了图层顺序', en: 'reordered layers', nodeIds: [] });
  }
  if (!clauses.length) {
    const intent = changeSet.intent?.trim();
    return { text: intent && !/^[a-z_]+ \d/.test(intent) && intent !== '编辑画布' ? (zh ? intent : `edited the canvas (${intent})`) : (zh ? '编辑了画布' : 'edited the canvas'), nodeIds: changeSet.nodeChanges.map(change => change.id) };
  }
  clauses.sort((a, b) => b.weight - a.weight);
  const shown = clauses.slice(0, 2);
  const text = shown.map(clause => (zh ? clause.zho : clause.en)).join(zh ? '，' : ', ') + (clauses.length > 2 ? (zh ? ' 等' : ' and more') : '');
  return { text, nodeIds: [...new Set(clauses.flatMap(clause => clause.nodeIds))] };
}

/** 「你」+ 句子；英文句首大写，中文主语是拉丁字母时加空格。 */
export function timelineSentence(actor: TimelineActor, clause: string, language: TimelineLanguage) {
  const label = timelineActorLabel(actor, language);
  if (language === 'en') return `${label} ${clause}`;
  return /[A-Za-z]$/.test(label) ? `${label} ${clause}` : `${label}${clause}`;
}

function describeEvent(event: WorkflowTimelineEvent, language: TimelineLanguage) {
  const zh = language === 'zho';
  const noun = zh ? TYPE_LABEL.zho[event.mediaType] || '图片' : event.mediaType;
  const titles = event.nodeTitles.length ? event.nodeTitles : [zh ? '未命名节点' : 'untitled node'];
  const count = event.count && event.count > 1 ? event.count : 0;
  if (event.kind === 'failed') return zh ? `在${quote(titles, 'zho')}生成${noun}失败` : `${noun} generation failed in ${quote(titles, 'en')}`;
  if (zh) return count ? `在${quote(titles.slice(0, 1), 'zho')}生成了 ${count} 张${noun === '图片' ? '图片' : noun}` : `在${quote(titles, 'zho')}生成了${noun}`;
  return count ? `generated ${count} ${noun}s in ${quote(titles.slice(0, 1), 'en')}` : `generated ${noun === 'image' ? 'an image' : `a ${noun}`} in ${quote(titles, 'en')}`;
}

/** ChangeSet + 生成事件 → 按时间倒序的条目。 */
export function buildWorkflowTimeline(project: Pick<WorkflowProject, 'nodes' | 'draftChangeSets'>, events: WorkflowTimelineEvent[], language: TimelineLanguage): WorkflowTimelineEntry[] {
  const nodes = new Map(project.nodes.map(node => [node.id, node]));
  const lookup = (id: string) => nodes.get(id);
  const changes: WorkflowTimelineEntry[] = (project.draftChangeSets || [])
    .filter(changeSet => changeSet.status !== 'failed')
    .map(changeSet => {
      const actor = actorFromDraftActor(changeSet.actor);
      const described = describeChangeSet(changeSet, language, lookup);
      return {
        id: changeSet.id,
        kind: 'change' as const,
        at: changeSet.at,
        revision: changeSet.resultDraftVersion,
        actor,
        text: timelineSentence(actor, described.text, language),
        nodeIds: described.nodeIds,
        undone: changeSet.status === 'undone',
        changeSetId: changeSet.id,
      };
    });
  const generated: WorkflowTimelineEntry[] = events.map(event => ({
    id: event.id,
    kind: 'generation' as const,
    at: event.at,
    revision: event.revision,
    actor: event.actor,
    text: timelineSentence(event.actor, describeEvent(event, language), language),
    nodeIds: event.nodeIds,
    undone: false,
  }));
  return [...changes, ...generated].sort((a, b) => b.at.localeCompare(a.at) || b.revision - a.revision);
}

const DAY = 86_400_000;
const startOfDay = (time: number) => { const date = new Date(time); date.setHours(0, 0, 0, 0); return date.getTime(); };
const pad = (value: number) => String(value).padStart(2, '0');
const isoDay = (time: number) => { const date = new Date(time); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; };

/** 日 / 周 / 月：只看最近 1 / 7 / 30 天（含今天）。 */
export function filterTimelineRange(entries: WorkflowTimelineEntry[], range: TimelineRange, now = Date.now()) {
  const days = range === 'day' ? 1 : range === 'week' ? 7 : 30;
  const since = startOfDay(now) - (days - 1) * DAY;
  return entries.filter(entry => Date.parse(entry.at) >= since);
}

export interface TimelineGroup { key: string; label: string; entries: WorkflowTimelineEntry[] }

/** 日期标记：今天 / 昨天 / 2026-11-15（英文 Today / Yesterday / Nov 15, 2026）。 */
export function timelineDateLabel(time: number, language: TimelineLanguage, now = Date.now()) {
  const diff = Math.round((startOfDay(now) - startOfDay(time)) / DAY);
  if (diff === 0) return language === 'zho' ? '今天' : 'Today';
  if (diff === 1) return language === 'zho' ? '昨天' : 'Yesterday';
  if (language === 'zho') return isoDay(time);
  return new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function groupTimelineByDay(entries: WorkflowTimelineEntry[], language: TimelineLanguage, now = Date.now()): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  entries.forEach(entry => {
    const time = Date.parse(entry.at);
    const key = isoDay(time);
    const last = groups.at(-1);
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, label: timelineDateLabel(time, language, now), entries: [entry] });
  });
  return groups;
}

/** 行尾相对时间：刚刚 / 5 分钟前 / 3 小时前 / 2 天前。 */
export function timelineRelativeTime(at: string, language: TimelineLanguage, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - Date.parse(at)) / 1000));
  const zh = language === 'zho';
  if (seconds < 45) return zh ? '刚刚' : 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return zh ? `${minutes} 分钟前` : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours} h ago`;
  const days = Math.round(hours / 24);
  return zh ? `${days} 天前` : `${days} d ago`;
}

export type WorkflowRestorePlan =
  | { ok: true; frame: { nodes: WorkflowNode[]; connections: WorkflowConnection[] }; undoCount: number; revision: number }
  | { ok: false; reason: 'not-found' | 'undone' | 'latest' };

/**
 * 推算「恢复到某个 ChangeSet 之后的样子」：在副本上按现有撤销逻辑逐个撤回它之后的修改，
 * 只返回目标帧，不改任何东西。调用方把它作为一次新的可撤销修改提交（不改写历史）。
 */
export function planWorkflowRestore(project: WorkflowProject, changeSetId: string): WorkflowRestorePlan {
  const sets = project.draftChangeSets || [];
  const target = sets.find(item => item.id === changeSetId);
  if (!target) return { ok: false, reason: 'not-found' };
  if (target.status !== 'completed' && target.status !== 'partial') return { ok: false, reason: 'undone' };
  const index = sets.indexOf(target);
  const later = sets.slice(index + 1).filter(item => item.status === 'completed' || item.status === 'partial');
  if (!later.length) return { ok: false, reason: 'latest' };
  let working: WorkflowProject = project;
  for (let step = 0; step < later.length; step += 1) {
    const result = undoWorkflowDraftChangeSet(working);
    if (result.ok === false) return { ok: false, reason: 'not-found' };
    working = result.project;
  }
  return {
    ok: true,
    frame: { nodes: working.nodes, connections: working.connections },
    undoCount: later.length,
    revision: target.resultDraftVersion,
  };
}
