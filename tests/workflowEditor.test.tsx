import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import type { WorkflowProject } from '../components/workflow/types';

const makeProject = (): WorkflowProject => ({
  id: 'project-1',
  title: 'Surface test',
  nodes: [
    createWorkflowNode('source', 'text', { x: 100, y: 100 }),
    createWorkflowNode('target', 'image', { x: 520, y: 120 }),
  ],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
  backgroundMode: 'dots',
  agentSessions: [],
  activeAgentSessionId: null,
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:00:00.000Z',
});

function Harness({ initial = makeProject() }: { initial?: WorkflowProject }) {
  const [project, setProject] = useState(initial);
  return (
    <InfiniteWorkflow
      project={project}
      updateProject={patch => setProject(current => ({ ...current, ...patch }))}
      onRunNode={() => undefined}
      onOpenAgent={() => undefined}
    />
  );
}

const editor = () => screen.getByTestId('workflow-editor');
const node = (id: string) => editor().querySelector<HTMLElement>(`[data-workflow-node-id="${id}"]`)!;
const sourceHandle = () => node('source').querySelector<HTMLButtonElement>('[aria-label="从此节点连接"]')!;
const worldTransform = () => (editor().querySelector<HTMLElement>('.workflow-world')?.style.transform || '');

describe('InfiniteWorkflow surface interactions', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      width: 1000,
      height: 700,
      toJSON: () => ({}),
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('keeps the workflow point under the cursor fixed while zooming', () => {
    render(<Harness />);

    fireEvent.wheel(editor(), { clientX: 400, clientY: 300, deltaY: -200 });

    const transform = worldTransform();
    const [, x, y, k] = transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/) || [];
    expect((400 - Number(x)) / Number(k)).toBeCloseTo(400);
    expect((300 - Number(y)) / Number(k)).toBeCloseTo(300);
  });

  it('pans by dragging the true background', () => {
    render(<Harness />);

    fireEvent.pointerDown(editor(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 145, clientY: 128 });
    fireEvent.pointerUp(window, { clientX: 145, clientY: 128 });

    expect(worldTransform()).toContain('translate(45px, 28px)');
  });

  it('supports modifier node selection and additive box selection', () => {
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, ctrlKey: true, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 120 });
    fireEvent.pointerDown(editor(), { button: 0, ctrlKey: true, shiftKey: true, clientX: 480, clientY: 80 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 900, clientY: 500 });
    fireEvent.pointerUp(window, { clientX: 900, clientY: 500 });

    expect(node('source')).toHaveClass('is-selected');
    expect(node('target')).toHaveClass('is-selected');
  });

  it('records a multi-move node drag as one undoable history entry', () => {
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 150 });
    fireEvent.pointerMove(window, { clientX: 210, clientY: 180 });
    fireEvent.pointerUp(window, { clientX: 210, clientY: 180 });
    expect(node('source').style.transform).toBe('translate(190px, 160px)');

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(node('source').style.transform).toBe('translate(100px, 100px)');
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();
  });

  it('opens the node create menu only from a true background double-click', () => {
    render(<Harness />);

    fireEvent.doubleClick(node('source'), { clientX: 130, clientY: 130 });
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
    fireEvent.doubleClick(editor(), { clientX: 360, clientY: 260 });

    expect(screen.getByRole('menu', { name: '新建节点' })).toBeInTheDocument();
  });

  it('opens the same create menu when a source connection is dropped on blank space and can cancel it', () => {
    render(<Harness />);

    fireEvent.pointerDown(sourceHandle(), { button: 0, clientX: 440, clientY: 210 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 520 });
    fireEvent.pointerUp(window, { clientX: 450, clientY: 520 });

    expect(screen.getByRole('menu', { name: '新建节点' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭新建节点' }));
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
  });

  it('connects to a legal existing node instead of opening the create menu', () => {
    render(<Harness />);

    fireEvent.pointerDown(sourceHandle(), { button: 0, clientX: 440, clientY: 210 });
    fireEvent.pointerMove(window, { clientX: 540, clientY: 180 });
    fireEvent.pointerUp(window, { clientX: 540, clientY: 180 });

    expect(editor().querySelectorAll('[data-workflow-connection-id]')).toHaveLength(1);
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
  });

  it('creates and connects a selected menu node atomically', () => {
    render(<Harness />);

    fireEvent.pointerDown(sourceHandle(), { button: 0, clientX: 440, clientY: 210 });
    fireEvent.pointerUp(window, { clientX: 450, clientY: 520 });
    fireEvent.click(screen.getByRole('menuitem', { name: /文本生成/ }));

    expect(editor().querySelectorAll('[data-workflow-node-id]')).toHaveLength(3);
    expect(editor().querySelectorAll('[data-workflow-connection-id]')).toHaveLength(1);
    expect(editor().querySelectorAll('[data-workflow-node-id].is-selected')).toHaveLength(1);
  });

  it('cancels an invalid nearby connection and exposes the rejection reason', () => {
    render(<Harness />);

    fireEvent.pointerDown(sourceHandle(), { button: 0, clientX: 440, clientY: 210 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 140 });

    expect(screen.getByRole('status')).toHaveTextContent('不能连接节点自身');
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
    expect(editor().querySelectorAll('[data-workflow-connection-id]')).toHaveLength(0);
  });

  it('deletes selected nodes from the keyboard and supports undo and redo', () => {
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 120 });
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(editor().querySelector('[data-workflow-node-id="source"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(node('source')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(editor().querySelector('[data-workflow-node-id="source"]')).not.toBeInTheDocument();
  });
});
