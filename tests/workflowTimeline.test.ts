import { describe, expect, it } from 'vitest';
import { buildGroupCreateOps } from '../components/workflow/canvasGroups';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowDraftChangeSet, undoWorkflowDraftChangeSet } from '../components/workflow/draftAuthority';
import { createWorkflowProject } from '../components/workflow/store';
import {
  buildWorkflowTimeline,
  describeChangeSet,
  filterTimelineRange,
  groupTimelineByDay,
  planWorkflowRestore,
  timelineRelativeTime,
  timelineSentence,
  type WorkflowTimelineEvent,
} from '../components/workflow/timeline';
import { appendTimelineEvent } from '../components/workflow/timelineEvents';
import type { WorkflowDocumentOperation, WorkflowProject } from '../components/workflow/types';

const apply = (project: WorkflowProject, actor: 'ui' | 'agent' | 'cli', intent: string, ops: WorkflowDocumentOperation[]) => {
  const result = applyWorkflowDraftChangeSet(project, { actor, intent, ops });
  if (result.ok === false) throw new Error(result.error.message);
  return result;
};

const seeded = () => {
  let project = createWorkflowProject('Timeline');
  project = apply(project, 'ui', 'add', [
    { type: 'add_node', node: { ...createWorkflowNode('a', 'image', { x: 0, y: 0 }), title: '图片 1' } },
  ]).project;
  project = apply(project, 'ui', 'add', [
    { type: 'add_node', node: { ...createWorkflowNode('b', 'video', { x: 400, y: 0 }), title: '镜头 2' } },
  ]).project;
  return project;
};

const last = (project: WorkflowProject) => project.draftChangeSets!.at(-1)!;

describe('canvas timeline summarizer', () => {
  it('names an added node with its type', () => {
    const project = seeded();
    expect(describeChangeSet(last(project), 'zho').text).toBe('添加了视频节点「镜头 2」');
    expect(describeChangeSet(last(project), 'en').text).toBe('added video node “镜头 2”');
  });

  it('describes moves, prompt edits and deletes', () => {
    let project = seeded();
    project = apply(project, 'ui', 'move', [{ type: 'move_nodes', positions: [{ id: 'a', position: { x: 80, y: 40 } }] }]).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('移动了「图片 1」');
    project = apply(project, 'agent', 'prompt', [{ type: 'update_node', id: 'b', metadata: { prompt: '雨夜霓虹街头' } }]).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('修改了「镜头 2」的提示词');
    expect(describeChangeSet(last(project), 'en').text).toBe('edited the prompt of “镜头 2”');
    project = apply(project, 'ui', 'delete', [{ type: 'delete_nodes', ids: ['a'] }]).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('删除了「图片 1」');
  });

  it('describes connections between named nodes', () => {
    let project = seeded();
    project = apply(project, 'ui', 'connect', [{ type: 'connect_nodes', id: 'c1', fromNodeId: 'a', toNodeId: 'b' }]).project;
    const lookup = (id: string) => project.nodes.find(node => node.id === id);
    expect(describeChangeSet(last(project), 'zho', lookup).text).toBe('连接了「图片 1」→「镜头 2」');
  });

  it('describes a generated result written through a ChangeSet', () => {
    let project = seeded();
    project = apply(project, 'ui', 'run', [{ type: 'update_node', id: 'a', metadata: { status: 'loading' } }]).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('运行了「图片 1」');
    project = apply(project, 'ui', 'done', [{ type: 'update_node', id: 'a', metadata: { status: 'success', storageKey: 'media-1' } }]).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('在「图片 1」生成了图片');
  });

  it('describes grouping as one sentence instead of a pile of moves', () => {
    let project = seeded();
    const { ops } = buildGroupCreateOps(project.nodes, ['a', 'b'], { groupId: 'g1', title: '开场' });
    project = apply(project, 'ui', 'group', ops).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('把「图片 1」、「镜头 2」编成分组「开场」');
    expect(describeChangeSet(last(project), 'zho').nodeIds).toEqual(expect.arrayContaining(['g1', 'a', 'b']));
  });

  it('collapses many nodes into a count and says "等" for extra clauses', () => {
    let project = createWorkflowProject('Many');
    project = apply(project, 'agent', 'batch', [
      ...[1, 2, 3].map(index => ({ type: 'add_node' as const, node: { ...createWorkflowNode('n' + index, 'image', { x: index * 300, y: 0 }), title: '图 ' + index } })),
    ]).project;
    expect(describeChangeSet(last(project), 'zho').text).toBe('添加了 3 个图片节点');
    expect(describeChangeSet(last(project), 'en').text).toBe('added 3 image nodes');
  });

  it('describes a restore by its target revision', () => {
    const text = describeChangeSet({ nodeChanges: [], connectionChanges: [], intent: '恢复到 rev 12' }, 'zho').text;
    expect(text).toBe('把画布恢复到 rev 12');
  });

  it('prefixes who did it', () => {
    expect(timelineSentence('you', '移动了「图片 1」', 'zho')).toBe('你移动了「图片 1」');
    expect(timelineSentence('agent', '移动了「图片 1」', 'zho')).toBe('Agent 移动了「图片 1」');
    expect(timelineSentence('external', 'moved “a”', 'en')).toBe('External agent moved “a”');
  });
});

describe('canvas timeline list', () => {
  it('merges ChangeSets and generation events newest first with actors and revisions', () => {
    let project = seeded();
    project = apply(project, 'cli', 'cli edit', [{ type: 'update_node', id: 'a', patch: { title: '封面' } }]).project;
    const events: WorkflowTimelineEvent[] = [{
      id: 'ev1', projectId: project.id, at: '2999-01-01T00:00:00.000Z', revision: project.draftVersion || 1,
      actor: 'agent', kind: 'generated', mediaType: 'image', nodeIds: ['a'], nodeTitles: ['封面'], count: 4,
    }];
    const entries = buildWorkflowTimeline(project, events, 'zho');
    expect(entries[0]).toMatchObject({ kind: 'generation', text: 'Agent 在「封面」生成了 4 张图片', actor: 'agent' });
    expect(entries[1]).toMatchObject({ kind: 'change', text: '外部 Agent 重命名了「封面」', revision: project.draftVersion });
    expect(entries.at(-1)).toMatchObject({ text: '你添加了图片节点「图片 1」' });
  });

  it('marks undone ChangeSets', () => {
    const project = undoWorkflowDraftChangeSet(seeded());
    if (project.ok === false) throw new Error('undo failed');
    const entries = buildWorkflowTimeline(project.project, [], 'zho');
    expect(entries.find(entry => entry.text.includes('镜头 2'))?.undone).toBe(true);
  });

  it('groups by day with 今天 / 昨天 / ISO date and filters by range', () => {
    const now = new Date(2026, 10, 17, 15, 0).getTime();
    const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
    const base = { kind: 'change' as const, revision: 1, actor: 'you' as const, text: 'x', nodeIds: [], undone: false };
    const entries = [0, 1, 2, 10].map(days => ({ ...base, id: 'e' + days, at: at(days) }));
    expect(groupTimelineByDay(entries, 'zho', now).map(group => group.label)).toEqual(['今天', '昨天', '2026-11-15', '2026-11-07']);
    expect(groupTimelineByDay(entries, 'en', now)[2].label).toBe('Nov 15, 2026');
    expect(filterTimelineRange(entries, 'day', now)).toHaveLength(1);
    expect(filterTimelineRange(entries, 'week', now)).toHaveLength(3);
    expect(filterTimelineRange(entries, 'month', now)).toHaveLength(4);
  });

  it('formats relative time', () => {
    const now = Date.parse('2026-11-17T08:00:00.000Z');
    expect(timelineRelativeTime('2026-11-17T07:59:50.000Z', 'zho', now)).toBe('刚刚');
    expect(timelineRelativeTime('2026-11-17T07:55:00.000Z', 'zho', now)).toBe('5 分钟前');
    expect(timelineRelativeTime('2026-11-17T05:00:00.000Z', 'en', now)).toBe('3 h ago');
  });
});

describe('canvas timeline restore plan', () => {
  it('computes the frame after a ChangeSet without touching the project', () => {
    let project = seeded();
    const target = last(project).id;
    project = apply(project, 'ui', 'move', [{ type: 'move_nodes', positions: [{ id: 'a', position: { x: 999, y: 0 } }] }]).project;
    project = apply(project, 'agent', 'delete', [{ type: 'delete_nodes', ids: ['b'] }]).project;
    const plan = planWorkflowRestore(project, target);
    expect(plan.ok).toBe(true);
    if (plan.ok === false) return;
    expect(plan.undoCount).toBe(2);
    expect(plan.frame.nodes.map(node => node.id)).toEqual(['a', 'b']);
    expect(plan.frame.nodes.find(node => node.id === 'a')!.position.x).toBe(0);
    // 原项目不变
    expect(project.nodes.map(node => node.id)).toEqual(['a']);
    expect(project.draftChangeSets!.every(changeSet => changeSet.status === 'completed')).toBe(true);
  });

  it('refuses the latest, undone and unknown ChangeSets', () => {
    const project = seeded();
    expect(planWorkflowRestore(project, last(project).id)).toEqual({ ok: false, reason: 'latest' });
    expect(planWorkflowRestore(project, 'nope')).toEqual({ ok: false, reason: 'not-found' });
    const undone = undoWorkflowDraftChangeSet(project);
    if (undone.ok === false) throw new Error('undo failed');
    expect(planWorkflowRestore(undone.project, last(project).id)).toEqual({ ok: false, reason: 'undone' });
  });
});

describe('timeline event log', () => {
  it('is bounded and idempotent', () => {
    const event = (id: string): WorkflowTimelineEvent => ({ id, projectId: 'p', at: '2026-11-17T00:00:00.000Z', revision: 1, actor: 'you', kind: 'generated', mediaType: 'image', nodeIds: [], nodeTitles: [] });
    let list: WorkflowTimelineEvent[] = [];
    for (let index = 0; index < 8; index += 1) list = appendTimelineEvent(list, event('e' + index), 5);
    expect(list.map(item => item.id)).toEqual(['e3', 'e4', 'e5', 'e6', 'e7']);
    expect(appendTimelineEvent(list, event('e7'), 5)).toBe(list);
  });
});
