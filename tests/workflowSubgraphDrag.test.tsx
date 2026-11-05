import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import type { WorkflowProject } from '../components/workflow/types';

const STAMP = new Date(Date.UTC(2026, 10, 5)).toISOString();

const makeProject = (selectedNodeIds: string[], collapsed = false): WorkflowProject => {
  const frame = { ...createWorkflowNode('frame', 'subgraph', { x: 100, y: 100 }), width: 600, height: 400 };
  frame.metadata = { ...frame.metadata, collapsed };
  const child = { ...createWorkflowNode('child', 'text', { x: 140, y: 172 }), parentId: 'frame' };
  const other = createWorkflowNode('other', 'image', { x: 900, y: 100 });
  return {
    id: 'project-subgraph',
    title: 'Subgraph drag',
    nodes: [frame, child, other],
    connections: [],
    selectedNodeIds,
    viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: 'dots',
    agentSessions: [],
    activeAgentSessionId: null,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
};

// 拖动并松手后，返回所有写入 nodes 的 updateProject 补丁。
const dragAndCollectWrites = (project: WorkflowProject, nodeId: string): Partial<WorkflowProject>[] => {
  const patches: Partial<WorkflowProject>[] = [];
  render(<InfiniteWorkflow project={project} updateProject={patch => { patches.push(patch); }} onRunNode={() => undefined} onOpenAgent={() => undefined} />);
  const target = screen.getByTestId('workflow-editor').querySelector<HTMLElement>('[data-workflow-node-id="' + nodeId + '"]')!;
  fireEvent.pointerDown(target, { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
  fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 210, clientY: 190 });
  fireEvent.pointerUp(window, { pointerId: 1, clientX: 210, clientY: 190 });
  return patches.filter(patch => Array.isArray(patch.nodes));
};

const positionOf = (patch: Partial<WorkflowProject>, id: string) => patch.nodes!.find(item => item.id === id)!.position;

describe('subgraph frame drag', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1400, bottom: 900, width: 1400, height: 900, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([false, true])('multi-select drag including a frame moves its children in one write (collapsed=%s)', collapsed => {
    const writes = dragAndCollectWrites(makeProject(['frame', 'other'], collapsed), 'frame');
    expect(writes).toHaveLength(1);
    expect(positionOf(writes[0]!, 'frame')).toEqual({ x: 160, y: 140 });
    expect(positionOf(writes[0]!, 'child')).toEqual({ x: 200, y: 212 });
    expect(positionOf(writes[0]!, 'other')).toEqual({ x: 960, y: 140 });
  });

  it('moves a selected child only once when its frame is also dragged', () => {
    const writes = dragAndCollectWrites(makeProject(['frame', 'child']), 'frame');
    expect(writes).toHaveLength(1);
    expect(positionOf(writes[0]!, 'child')).toEqual({ x: 200, y: 212 });
  });

  it('dragging only a child leaves the frame in place', () => {
    const writes = dragAndCollectWrites(makeProject(['child']), 'child');
    expect(writes).toHaveLength(1);
    expect(positionOf(writes[0]!, 'child')).toEqual({ x: 200, y: 212 });
    expect(positionOf(writes[0]!, 'frame')).toEqual({ x: 100, y: 100 });
  });
});
