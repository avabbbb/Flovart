import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  applyWorkflowDraftChangeSet,
  redoWorkflowDraftChangeSet,
  undoWorkflowDraftChangeSet,
} from '../components/workflow/draftAuthority';
import { createWorkflowProject } from '../components/workflow/store';
import type { WorkflowProject } from '../components/workflow/types';

const apply = (project: WorkflowProject, id: string, actor: 'agent' | 'ui', intent: string, ops: Parameters<typeof applyWorkflowDraftChangeSet>[1]['ops']) => {
  const result = applyWorkflowDraftChangeSet(project, { id, actor, intent, ops });
  if (result.ok === false) throw new Error(result.error.message);
  return result;
};

describe('Workflow Draft Authority', () => {
  it('merges consecutive submissions with the same changeSetId into one turn ChangeSet', () => {
    let project = createWorkflowProject('回合');
    const first = apply(project, 'turn-1', 'agent', '创建大纲', [
      { type: 'add_node', node: createWorkflowNode('outline-1', 'text', { x: 0, y: 0 }, { content: '大纲' }) },
    ]);
    project = first.project;
    const second = apply(project, 'turn-1', 'agent', '创建大纲', [
      { type: 'update_node', id: 'outline-1', patch: { title: '大纲 v2' } },
    ]);

    expect(second.project.draftChangeSets).toHaveLength(1);
    const changeSet = second.project.draftChangeSets![0];
    expect(changeSet).toMatchObject({ id: 'turn-1', actor: 'agent', baseDraftVersion: 1, resultDraftVersion: 3 });
    expect(changeSet.nodeChanges).toHaveLength(1);
    expect(changeSet.nodeChanges[0].id).toBe('outline-1');
    expect(changeSet.nodeChanges[0].before).toBeUndefined();
    expect(changeSet.nodeChanges[0].after).toMatchObject({ title: '大纲 v2', objectVersion: 2 });
  });

  it('undoes an entire merged turn in one step and redoes its final state', () => {
    let project = createWorkflowProject('回合');
    const first = apply(project, 'turn-1', 'agent', '创建大纲', [
      { type: 'add_node', node: createWorkflowNode('outline-1', 'text', { x: 0, y: 0 }, { content: '大纲' }) },
    ]);
    project = first.project;
    const second = apply(project, 'turn-1', 'agent', '创建大纲', [
      { type: 'update_node', id: 'outline-1', patch: { title: '大纲 v2' } },
    ]);
    project = second.project;

    const undone = undoWorkflowDraftChangeSet(project);
    expect(undone.ok).toBe(true);
    if (undone.ok === false) throw new Error(undone.error.message);
    expect(undone.project.nodes.find(node => node.id === 'outline-1')).toBeUndefined();
    expect(undone.project.draftChangeSets![0]).toMatchObject({ status: 'undone' });

    const redone = redoWorkflowDraftChangeSet(undone.project);
    expect(redone.ok).toBe(true);
    if (redone.ok === false) throw new Error(redone.error.message);
    expect(redone.project.nodes.find(node => node.id === 'outline-1')).toMatchObject({ title: '大纲 v2' });
  });

  it('does not merge across different changeSetIds or after a human edit interleaves', () => {
    let project = createWorkflowProject('回合');
    const first = apply(project, 'turn-1', 'agent', '创建大纲', [
      { type: 'add_node', node: createWorkflowNode('outline-1', 'text', { x: 0, y: 0 }, { content: '大纲' }) },
    ]);
    project = first.project;
    const human = apply(project, 'ui-1', 'ui', '手动调整', [
      { type: 'update_node', id: 'outline-1', patch: { title: '人工标题' } },
    ]);
    project = human.project;
    const agentFollow = apply(project, 'turn-1', 'agent', '创建大纲', [
      { type: 'update_node', id: 'outline-1', patch: { title: 'Agent 再次' } },
    ]);

    expect(agentFollow.project.draftChangeSets).toHaveLength(3);
    expect(agentFollow.project.draftChangeSets!.map(item => item.id)).toEqual(['turn-1', 'ui-1', 'turn-1']);
    expect(agentFollow.project.draftChangeSets![1].nodeChanges[0].after).toMatchObject({ title: '人工标题' });
    expect(agentFollow.project.draftChangeSets![2].nodeChanges[0].after).toMatchObject({ title: 'Agent 再次' });

    const separate = apply(agentFollow.project, 'turn-2', 'agent', '移动节点', [
      { type: 'update_node', id: 'outline-1', patch: { position: { x: 40, y: 60 } } },
    ]);
    expect(separate.project.draftChangeSets).toHaveLength(4);
  });
});
