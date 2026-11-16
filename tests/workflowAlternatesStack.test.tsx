import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { InfiniteWorkflow } from '../components/workflow/InfiniteWorkflow';
import { WorkflowAlternatesDock, workflowAlternatesExtent } from '../components/workflow/WorkflowAlternatesDock';
import { WorkflowAlternatesStack } from '../components/workflow/WorkflowAlternatesStack';
import { ALTERNATE_STACK_MAX_TOTAL, usesAlternateStack } from '../components/workflow/batchAlternates';
import type { WorkflowMediaAlternate, WorkflowNode, WorkflowProject } from '../components/workflow/types';

const STAMP = new Date(Date.UTC(2026, 10, 16)).toISOString();
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

const alternate = (id: string, type: 'image' | 'video' = 'image'): WorkflowMediaAlternate => ({
  id, type, title: id, width: 320, height: 200, batchId: 'B',
  metadata: type === 'video'
    ? { href: 'data:video/mp4;base64,AAAA', poster: PNG, mimeType: 'video/mp4', durationMs: 5000, status: 'success' }
    : { href: PNG, mimeType: 'image/png', status: 'success' },
});

const primary = (count: number, types: Array<'image' | 'video'> = []): WorkflowNode => ({
  ...createWorkflowNode('root', 'image', { x: 100, y: 100 }, {
    href: PNG, mimeType: 'image/png', status: 'success', naturalWidth: 1600, naturalHeight: 1000,
    alternates: Array.from({ length: count - 1 }, (_, index) => alternate('alt' + (index + 1), types[index] || 'image')),
  }),
  width: 320, height: 200, title: '生成图片',
});

describe('alternate stack threshold', () => {
  it('uses the stack for 2–4 results in total and the grid above that', () => {
    expect(ALTERNATE_STACK_MAX_TOTAL).toBe(4);
    expect(usesAlternateStack(primary(1))).toBe(false);
    for (const total of [2, 3, 4]) expect(usesAlternateStack(primary(total))).toBe(true);
    for (const total of [5, 8, 16]) expect(usesAlternateStack(primary(total))).toBe(false);
  });

  it('extends the overlay box to the right / bottom only while a stack is expanded', () => {
    const node = primary(4);
    expect(workflowAlternatesExtent(node, { stackExpanded: false }).right).toBe(0);
    expect(workflowAlternatesExtent(node, { stackExpanded: true })).toEqual({ right: 320 + 12, bottom: 200 + 12 });
    expect(workflowAlternatesExtent(primary(2), { stackExpanded: true })).toEqual({ right: 320 + 12, bottom: 0 });
    expect(workflowAlternatesExtent(primary(8)).right).toBe(0);
    expect(workflowAlternatesExtent(primary(8)).bottom).toBeGreaterThan(0);
  });

  it('the grid dock renders nothing for a stack-sized set (no thumbnail strip mode any more)', () => {
    const noop = () => undefined;
    const { container } = render(<WorkflowAlternatesDock node={primary(4)} onPreview={noop} onPromote={noop} onRemove={noop} onSplit={noop} onExport={noop} />);
    expect(container.innerHTML).toBe('');
    const { container: grid } = render(<WorkflowAlternatesDock node={primary(5)} onPreview={noop} onPromote={noop} onRemove={noop} onSplit={noop} onExport={noop} />);
    expect(grid.querySelector('[data-variant="grid"]')).not.toBeNull();
  });
});

describe('WorkflowAlternatesStack', () => {
  it('collapsed: fans up to two back cards (images and videos alike) and offers “N 张”', () => {
    render(<div><WorkflowAlternatesStack node={primary(4, ['video', 'image', 'image'])} expanded={false} onToggleExpanded={() => undefined} onPreview={() => undefined} onPromote={() => undefined} /></div>);
    const stack = screen.getByTestId('workflow-alternates');
    expect(stack.dataset.variant).toBe('stack');
    const layers = stack.querySelectorAll('.workflow-batch-stack__layer');
    expect(layers).toHaveLength(2);
    expect(layers[0].getAttribute('data-alternate-id')).toBe('alt1');
    // 视频备选用封面当后层卡片，和图片一样
    expect(layers[0].querySelector('img')?.getAttribute('src')).toBe(PNG);
    const toggle = screen.getByRole('button', { name: '展开 4 个结果' });
    expect(toggle.textContent).toContain('4张');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByTestId('workflow-alternate-stack-cell')).toHaveLength(0);
  });

  it('expanded: lays results out as a 2-column grid with 设为首图 / preview / 收起', () => {
    const onPreview = vi.fn();
    const onPromote = vi.fn();
    const onToggle = vi.fn();
    render(<div><WorkflowAlternatesStack node={primary(4, ['image', 'video', 'image'])} expanded onToggleExpanded={onToggle} onPreview={onPreview} onPromote={onPromote} /></div>);
    const cells = screen.getAllByTestId('workflow-alternate-stack-cell');
    expect(cells.map(cell => [cell.style.left, cell.style.top])).toEqual([['332px', '0px'], ['0px', '212px'], ['332px', '212px']]);
    expect(screen.getByText('首图')).toBeTruthy();
    fireEvent.click(within(cells[1]).getByRole('button', { name: '把第 3 个结果（视频）设为首图' }));
    expect(onPromote).toHaveBeenCalledWith('alt2');
    expect(onPreview).not.toHaveBeenCalled();
    fireEvent.pointerDown(cells[2], { clientX: 10, clientY: 10 });
    fireEvent.click(cells[2], { clientX: 10, clientY: 10 });
    expect(onPreview).toHaveBeenCalledWith(3);
    // 按下后拖动过（拖的是节点）：松手不进画廊
    onPreview.mockClear();
    fireEvent.pointerDown(cells[0], { clientX: 10, clientY: 10 });
    fireEvent.click(cells[0], { clientX: 90, clientY: 60 });
    expect(onPreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '收起结果' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('hides 设为首图 on a locked node', () => {
    render(<div><WorkflowAlternatesStack node={{ ...primary(3), isLocked: true }} expanded onToggleExpanded={() => undefined} onPreview={() => undefined} onPromote={() => undefined} /></div>);
    expect(screen.queryByRole('button', { name: /设为首图/ })).toBeNull();
  });
});

describe('alternate stack on the canvas', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1400, bottom: 900, width: 1400, height: 900, toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const project = (node: WorkflowNode): WorkflowProject => ({
    id: 'project-stack', title: 'Stack', nodes: [node], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
    backgroundMode: 'dots', agentSessions: [], activeAgentSessionId: null, createdAt: STAMP, updatedAt: STAMP,
  });

  it.each([false, true])('dragging the stack moves the one primary node with everything attached (expanded=%s)', expanded => {
    const writes: Partial<WorkflowProject>[] = [];
    render(<InfiniteWorkflow project={project(primary(4, ['image', 'video', 'image']))} updateProject={patch => { writes.push(patch); }} onRunNode={() => undefined} onOpenAgent={() => undefined} />);
    const editor = screen.getByTestId('workflow-editor');
    const nodeEl = editor.querySelector<HTMLElement>('[data-workflow-node-id="root"]')!;
    const stack = within(nodeEl).getByTestId('workflow-alternates');
    expect(stack.dataset.variant).toBe('stack');
    if (expanded) {
      act(() => { fireEvent.click(within(nodeEl).getByRole('button', { name: '展开 4 个结果' })); });
      expect(within(nodeEl).getAllByTestId('workflow-alternate-stack-cell')).toHaveLength(3);
    }
    // 从备选格（展开）或斜出的后层卡片（收起）按住拖：都是拖首图节点
    const grip = expanded
      ? within(nodeEl).getAllByTestId('workflow-alternate-stack-cell')[2]
      : nodeEl.querySelector<HTMLElement>('.workflow-batch-stack__layer')!;
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientX: 150, clientY: 150 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 210, clientY: 190 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 210, clientY: 190 });
    const nodeWrites = writes.filter(patch => Array.isArray(patch.nodes));
    expect(nodeWrites).toHaveLength(1);
    const moved = nodeWrites[0]!.nodes!;
    // 仍然只有一个节点（没有同位叠放的兄弟节点可以留在原地），备选跟着它走
    expect(moved).toHaveLength(1);
    expect(moved[0]!.position).toEqual({ x: 160, y: 140 });
    expect(moved[0]!.metadata.alternates?.map(item => item.id)).toEqual(['alt1', 'alt2', 'alt3']);
    // 卡片 / 格子都在节点 DOM 里，画布上没有别的 [data-workflow-node-id]
    expect(editor.querySelectorAll('[data-workflow-node-id]')).toHaveLength(1);
    expect(nodeEl.contains(grip)).toBe(true);
    // 拖完松手不算单击：不打开画廊
    expect(document.querySelector('.workflow-preview-modal--gallery')).toBeNull();
  });

  it('shows the grid dock, not the stack, for more than four results', () => {
    render(<InfiniteWorkflow project={project(primary(8))} updateProject={() => undefined} onRunNode={() => undefined} onOpenAgent={() => undefined} />);
    const nodeEl = screen.getByTestId('workflow-editor').querySelector<HTMLElement>('[data-workflow-node-id="root"]')!;
    expect(within(nodeEl).getByTestId('workflow-alternates').dataset.variant).toBe('grid');
    expect(nodeEl.querySelector('.workflow-alt-stack')).toBeNull();
  });
});
