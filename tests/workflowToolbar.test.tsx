import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowToolbar } from '../components/workflow/WorkflowToolbar';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

afterEach(() => useWorkspaceStore.setState({ language: 'zho' }));

function mountToolbar() {
  return render(<WorkflowToolbar
    tool="select"
    canUndo={false}
    canRedo={false}
    onToolChange={vi.fn()}
    onAddNode={vi.fn()}
    onAddSharedMedia={vi.fn()}
    onUndo={vi.fn()}
    onRedo={vi.fn()}
    onFit={vi.fn()}
    onToggleGrid={vi.fn()}
  />);
}

describe('WorkflowToolbar popover behavior', () => {
  it('keeps one menu open and closes on outside click', async () => {
    mountToolbar();
    fireEvent.click(screen.getByRole('button', { name: '添加节点' }));
    expect(screen.getByRole('menu', { name: '添加节点' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '工具箱' }));
    await waitFor(() => expect(screen.queryByRole('menu', { name: '添加节点' })).not.toBeInTheDocument());
    expect(screen.getByRole('menu', { name: '画布工具箱' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu', { name: '画布工具箱' })).not.toBeInTheDocument());
  });

  it('uses English labels and restores trigger focus after Escape', async () => {
    useWorkspaceStore.setState({ language: 'en' });
    mountToolbar();
    const trigger = screen.getByRole('button', { name: 'Tools' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('menu', { name: 'Canvas tools' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Canvas tools' })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByText(/工具箱/)).not.toBeInTheDocument();
  });
});
