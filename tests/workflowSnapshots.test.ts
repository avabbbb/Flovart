import { describe, expect, it } from 'vitest';
import { migrateWorkflowProject } from '../components/workflow/migrations';
import {
  WORKFLOW_SNAPSHOT_LIMIT,
  addWorkflowSnapshot,
  createWorkflowSnapshot,
  removeWorkflowSnapshot,
  renameWorkflowSnapshot,
  workflowSnapshotFrame,
} from '../components/workflow/snapshots';
import type { WorkflowConnection, WorkflowNamedSnapshot, WorkflowNode } from '../components/workflow/types';

const node = (id: string) => ({ id, type: 'text', title: id, position: { x: 0, y: 0 }, width: 100, height: 80, metadata: { text: id } }) as unknown as WorkflowNode;
const doc = () => ({ nodes: [node('a'), node('b')], connections: [] as WorkflowConnection[], viewport: { x: 1, y: 2, k: 1 } });

describe('workflow named snapshots', () => {
  it('uses a default name when blank and deep-copies the document', () => {
    const source = doc();
    const snapshot = createWorkflowSnapshot(source, '   ', new Date(2026, 9, 19, 9, 5), 's1');
    expect(snapshot.name).toBe('快照 2026-10-19 09:05');
    source.nodes[0].title = 'changed';
    expect(snapshot.nodes[0].title).toBe('a');
  });

  it('caps the list and supports rename and remove', () => {
    let list = Array.from({ length: WORKFLOW_SNAPSHOT_LIMIT + 3 }, (_, index) => createWorkflowSnapshot(doc(), 'n' + index, new Date(), 'id' + index))
      .reduce((acc, snapshot) => addWorkflowSnapshot(acc, snapshot), [] as WorkflowNamedSnapshot[]);
    expect(list).toHaveLength(WORKFLOW_SNAPSHOT_LIMIT);
    expect(list[0].id).toBe('id3');
    list = renameWorkflowSnapshot(list, 'id3', '  新名  ');
    expect(list[0].name).toBe('新名');
    expect(renameWorkflowSnapshot(list, 'id3', '  ')[0].name).toBe('新名');
    expect(removeWorkflowSnapshot(list, 'id3')).toHaveLength(WORKFLOW_SNAPSHOT_LIMIT - 1);
  });

  it('restores an independent copy', () => {
    const snapshot = createWorkflowSnapshot(doc(), 'x');
    const frame = workflowSnapshotFrame(snapshot);
    frame.nodes[0].title = 'edited';
    expect(snapshot.nodes[0].title).toBe('a');
  });

  it('migration keeps valid snapshots and drops corrupt ones', () => {
    const project = migrateWorkflowProject({
      id: 'p',
      title: 'P',
      nodes: [],
      connections: [],
      snapshots: [
        { id: 'ok', name: 'good', createdAt: '2026-10-19T00:00:00.000Z', nodes: [node('a')], connections: [] },
        { id: 'bad', name: 'broken', nodes: [{ nope: true }] },
        { name: 'no id', nodes: [] },
      ],
    });
    expect(project.snapshots?.map(snapshot => snapshot.id)).toEqual(['ok']);
    expect(migrateWorkflowProject({ id: 'p', title: 'P' }).snapshots).toBeUndefined();
  });
});
