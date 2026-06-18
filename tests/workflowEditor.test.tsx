import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import { WorkflowMiniMap } from '../components/workflow/WorkflowMiniMap';
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
const resizeHandle = () => node('source').querySelector<HTMLButtonElement>('[aria-label="调整节点大小"]')!;
const worldTransform = () => (editor().querySelector<HTMLElement>('.workflow-world')?.style.transform || '');

describe('InfiniteWorkflow surface interactions', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it('patches UI selection immediately and adopts later canonical selection', () => {
    let project = makeProject();
    const updateProject = vi.fn((patch: Partial<WorkflowProject>) => { project = { ...project, ...patch }; });
    const view = render(<InfiniteWorkflow project={project} updateProject={updateProject} onRunNode={() => undefined} onOpenAgent={() => undefined} />);

    fireEvent.pointerDown(node('source'), { button: 0, pointerId: 1, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 120, clientY: 120 });
    expect(updateProject).toHaveBeenCalledWith({ selectedNodeIds: ['source'] });

    updateProject.mockClear();
    project = { ...project, selectedNodeIds: ['target'] };
    view.rerender(<InfiniteWorkflow project={project} updateProject={updateProject} onRunNode={() => undefined} onOpenAgent={() => undefined} />);
    expect(node('source')).not.toHaveClass('is-selected');
    expect(node('target')).toHaveClass('is-selected');
    expect(updateProject).not.toHaveBeenCalled();
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

  it('batches native pointer moves and flushes the latest position before pointerup', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, pointerId: 7, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 160, clientY: 150 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 200, clientY: 180 });
    expect(node('source').style.transform).toBe('translate(100px, 100px)');
    expect(frames.size).toBe(1);

    frames.values().next().value?.(0);
    expect(node('source').style.transform).toBe('translate(180px, 160px)');
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 220, clientY: 190 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 230, clientY: 200 });
    expect(node('source').style.transform).toBe('translate(210px, 180px)');
  });

  it('ignores move, up, and cancel events from a different pointer', () => {
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, pointerId: 3, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 500, clientY: 500 });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 500, clientY: 500 });
    fireEvent.pointerCancel(window, { pointerId: 4 });
    fireEvent.pointerUp(window, { pointerId: 3, clientX: 140, clientY: 130 });

    expect(node('source').style.transform).toBe('translate(120px, 110px)');
  });

  it('pans from a node with the pan tool or Space without moving the node', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '平移工具' }));
    fireEvent.pointerDown(node('source'), { button: 0, pointerId: 1, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 170, clientY: 150 });
    expect(worldTransform()).toContain('translate(50px, 30px)');
    expect(node('source').style.transform).toBe('translate(100px, 100px)');

    fireEvent.click(screen.getByRole('button', { name: '选择工具' }));
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.pointerDown(node('source'), { button: 0, pointerId: 2, clientX: 170, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 200, clientY: 170 });
    fireEvent.keyUp(window, { code: 'Space', key: ' ' });
    expect(worldTransform()).toContain('translate(80px, 50px)');
    expect(node('source').style.transform).toBe('translate(100px, 100px)');
  });

  it('pans from source and resize handles without connecting or resizing', () => {
    const initial = makeProject();
    initial.connections = [{ id: 'connection-1', fromNodeId: 'source', toNodeId: 'target' }];
    render(<Harness initial={initial} />);
    const connection = editor().querySelector<SVGPathElement>('[data-workflow-connection-id="connection-1"]')!;
    fireEvent.keyDown(connection, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '平移工具' }));
    fireEvent.doubleClick(editor(), { clientX: 900, clientY: 600 });

    fireEvent.pointerDown(sourceHandle(), { button: 0, pointerId: 11, clientX: 440, clientY: 210 });
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 480, clientY: 230 });
    expect(worldTransform()).toContain('translate(40px, 20px)');
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
    expect(editor().querySelector('.workflow-connection.is-selected')).not.toBeInTheDocument();
    expect(editor().querySelector('.workflow-connection.is-active')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择工具' }));
    fireEvent.keyDown(window, { code: 'Space', key: ' ' });
    fireEvent.pointerDown(resizeHandle(), { button: 0, pointerId: 12, clientX: 440, clientY: 320 });
    fireEvent.pointerUp(window, { pointerId: 12, clientX: 470, clientY: 340 });
    fireEvent.keyUp(window, { code: 'Space', key: ' ' });
    expect(worldTransform()).toContain('translate(70px, 40px)');
    expect(node('source').style.width).toBe('340px');
    expect(node('source').style.height).toBe('220px');
  });

  it('records every actual node and resize delta while a click stays out of history', () => {
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 120 });
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();

    fireEvent.pointerDown(node('source'), { button: 0, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 121, clientY: 121 });
    expect(node('source').style.transform).toBe('translate(101px, 101px)');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(node('source').style.transform).toBe('translate(100px, 100px)');

    const resize = node('source').querySelector<HTMLButtonElement>('[aria-label="调整节点大小"]')!;
    fireEvent.pointerDown(resize, { button: 0, clientX: 440, clientY: 320 });
    fireEvent.pointerUp(window, { clientX: 441, clientY: 321 });
    expect(node('source').style.width).toBe('341px');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(node('source').style.width).toBe('340px');
  });

  it('rolls back node, resize, and pan state when their gesture is cancelled', () => {
    render(<Harness />);

    fireEvent.pointerDown(node('source'), { button: 0, clientX: 120, clientY: 120 });
    fireEvent.pointerMove(window, { clientX: 170, clientY: 150 });
    fireEvent.pointerCancel(window);
    expect(node('source').style.transform).toBe('translate(100px, 100px)');

    const resize = node('source').querySelector<HTMLButtonElement>('[aria-label="调整节点大小"]')!;
    fireEvent.pointerDown(resize, { button: 0, clientX: 440, clientY: 320 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 370 });
    fireEvent.blur(window);
    expect(node('source').style.width).toBe('340px');
    expect(node('source').style.height).toBe('220px');

    fireEvent.pointerDown(editor(), { button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 130 });
    fireEvent.pointerCancel(window);
    expect(worldTransform()).toContain('translate(0px, 0px)');
    expect(screen.getByRole('button', { name: '撤销' })).toBeDisabled();

    fireEvent.pointerDown(node('source'), { button: 0, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 120 });
    fireEvent.pointerDown(editor(), { button: 0, ctrlKey: true, clientX: 480, clientY: 80 });
    fireEvent.pointerMove(window, { buttons: 1, clientX: 900, clientY: 500 });
    fireEvent.pointerCancel(window);
    expect(node('source')).toHaveClass('is-selected');
    expect(node('target')).not.toHaveClass('is-selected');

    fireEvent.pointerDown(sourceHandle(), { button: 0, clientX: 440, clientY: 210 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 520 });
    fireEvent.pointerCancel(window);
    expect(editor().querySelector('.workflow-connection.is-active')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
  });

  it('opens the node create menu only from a true background double-click', () => {
    render(<Harness />);

    fireEvent.doubleClick(node('source'), { clientX: 130, clientY: 130 });
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
    fireEvent.doubleClick(editor(), { clientX: 360, clientY: 260 });

    expect(screen.getByRole('menu', { name: '新建节点' })).toBeInTheDocument();
  });

  it('supports keyboard navigation in the create menu and renders audio nodes', () => {
    render(<Harness />);

    fireEvent.doubleClick(editor(), { clientX: 360, clientY: 260 });
    const menu = screen.getByRole('menu', { name: '新建节点' });
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(items[4]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items[4]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[3]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(editor().querySelector('.workflow-node--audio')).toBeInTheDocument();
    expect(screen.getByText('音频节点')).toBeInTheDocument();

    fireEvent.doubleClick(editor(), { clientX: 900, clientY: 600 });
    fireEvent.keyDown(screen.getByRole('menu', { name: '新建节点' }), { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '新建节点' })).not.toBeInTheDocument();
  });

  it('restores focus to the surface or source handle after closing the create menu', () => {
    render(<Harness />);
    expect(editor()).toHaveAttribute('tabindex', '-1');

    fireEvent.doubleClick(editor(), { clientX: 900, clientY: 600 });
    fireEvent.keyDown(screen.getByRole('menu', { name: '新建节点' }), { key: 'Escape' });
    expect(editor()).toHaveFocus();

    fireEvent.pointerDown(sourceHandle(), { button: 0, pointerId: 21, clientX: 440, clientY: 210 });
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 450, clientY: 520 });
    fireEvent.click(screen.getByRole('menuitem', { name: /文本生成/ }));
    expect(sourceHandle()).toHaveFocus();

    fireEvent.pointerDown(sourceHandle(), { button: 0, pointerId: 22, clientX: 440, clientY: 210 });
    fireEvent.pointerUp(window, { pointerId: 22, clientX: 900, clientY: 650 });
    fireEvent.click(screen.getByRole('button', { name: '关闭新建节点' }));
    expect(sourceHandle()).toHaveFocus();
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

  it('makes the wide connection hit path keyboard selectable', () => {
    const initial = makeProject();
    initial.connections = [{ id: 'connection-1', fromNodeId: 'source', toNodeId: 'target' }];
    render(<Harness initial={initial} />);
    const path = editor().querySelector<SVGPathElement>('[data-workflow-connection-id="connection-1"]')!;

    expect(path).toHaveAttribute('tabindex', '0');
    expect(path).toHaveAccessibleName('选择连接：文本 到 图片');
    expect(screen.getByRole('group', { name: '工作流连接' })).not.toHaveAttribute('aria-hidden');
    fireEvent.keyDown(path, { key: ' ' });
    expect(editor().querySelector('.workflow-connection.is-selected')).toBeInTheDocument();
    fireEvent.pointerDown(node('source'), { button: 0, pointerId: 9, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 120, clientY: 120 });
    fireEvent.keyDown(path, { key: 'Enter' });
    expect(editor().querySelector('.workflow-connection.is-selected')).toBeInTheDocument();
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

  it('maps a wide minimap node center and letterbox edge to content bounds', () => {
    const project = makeProject();
    const onCenter = vi.fn();
    render(<WorkflowMiniMap nodes={project.nodes} viewport={project.viewport} onCenter={onCenter} />);
    const minimap = screen.getByRole('button', { name: '工作流小地图' });
    vi.spyOn(minimap, 'getBoundingClientRect').mockReturnValue({
      x: 200,
      y: 100,
      left: 200,
      top: 100,
      right: 366,
      bottom: 212,
      width: 166,
      height: 112,
      toJSON: () => ({}),
    });
    const target = minimap.querySelector<HTMLElement>('.workflow-minimap__node--image')!;
    fireEvent.click(minimap, {
      clientX: 200 + parseFloat(target.style.left) + parseFloat(target.style.width) / 2,
      clientY: 100 + parseFloat(target.style.top) + parseFloat(target.style.height) / 2,
    });

    const [x, y] = onCenter.mock.calls[0];
    expect(x).toBeCloseTo(690);
    expect(y).toBeCloseTo(240);

    fireEvent.click(minimap, { clientX: 200 + 75, clientY: 100 });
    expect(onCenter.mock.calls[1][1]).toBeCloseTo(100);
  });

  it('centers tall minimap content and clamps horizontal letterbox clicks', () => {
    const nodes = [
      createWorkflowNode('top', 'text', { x: 50, y: 0 }),
      createWorkflowNode('bottom', 'image', { x: 50, y: 2000 }),
    ];
    const onCenter = vi.fn();
    render(<WorkflowMiniMap nodes={nodes} viewport={{ x: 0, y: 0, k: 1 }} onCenter={onCenter} />);
    const minimap = screen.getByRole('button', { name: '工作流小地图' });
    vi.spyOn(minimap, 'getBoundingClientRect').mockReturnValue({
      x: 200, y: 100, left: 200, top: 100, right: 366, bottom: 212, width: 166, height: 112, toJSON: () => ({}),
    });

    fireEvent.click(minimap, { clientX: 200, clientY: 148 });
    expect(onCenter.mock.calls[0][0]).toBeCloseTo(50);
  });
});
