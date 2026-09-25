import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowContextMenu, type WorkflowContextMenuState } from '../components/workflow/WorkflowContextMenu';

function MenuHarness({ state }: { state: WorkflowContextMenuState }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open menu</button>
    {open && <WorkflowContextMenu state={state} onCopy={vi.fn()} onDelete={vi.fn()} onRun={vi.fn()} onClose={() => setOpen(false)} />}
  </>;
}

describe('WorkflowContextMenu', () => {
  it.each([
    ['top-left', 0, 0, '8px', '8px'],
    ['top-right', 310, 0, '112px', '8px'],
    ['bottom-left', 0, 490, '8px', '192px'],
    ['bottom-right', 310, 490, '112px', '192px'],
  ])('clamps the menu at the %s viewport corner', (_corner, x, y, expectedLeft, expectedTop) => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 500 });
    const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300,
      toJSON: () => ({}),
    }));
    render(<MenuHarness state={{ type: 'node', id: 'node-1', x, y }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('menu')).toHaveStyle({ left: expectedLeft, top: expectedTop });
    getRect.mockRestore();
  });

  it('keeps the menu inside a small viewport and supports keyboard navigation and Escape', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: 500 });
    const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300,
      toJSON: () => ({}),
    }));
    const view = render(<MenuHarness state={{ type: 'node', id: 'node-1', x: 310, y: 490 }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const menu = screen.getByRole('menu', { name: '节点菜单' });
    expect(menu).toHaveStyle({ left: '112px', top: '192px', maxHeight: '484px' });
    const first = screen.getByRole('menuitem', { name: '复制' });
    const second = screen.getByRole('menuitem', { name: '运行节点' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    getRect.mockRestore();
    view.unmount();
  });

  it('closes on outside pointer interaction and restores trigger focus', () => {
    const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, left: 0, top: 0, right: 180, bottom: 180, width: 180, height: 180,
      toJSON: () => ({}),
    }));
    render(<MenuHarness state={{ type: 'connection', id: 'edge-1', x: 20, y: 20 }} />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    getRect.mockRestore();
  });
});
