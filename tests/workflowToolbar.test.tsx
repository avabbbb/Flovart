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

describe('WorkflowToolbar revision', () => {
  it('shows the current draft revision when one is known', () => {
    render(<WorkflowToolbar tool="select" canUndo={false} canRedo={false} onToolChange={vi.fn()} onAddNode={vi.fn()} onAddSharedMedia={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onFit={vi.fn()} onToggleGrid={vi.fn()} revision={42} />);
    expect(screen.getByTestId('workflow-revision')).toHaveTextContent('rev 42');
  });

  it('hides the revision before the draft has one', () => {
    mountToolbar();
    expect(screen.queryByTestId('workflow-revision')).not.toBeInTheDocument();
  });
});

describe('WorkflowToolbar stale rerun and host send', () => {
  const base = { tool: 'select' as const, canUndo: false, canRedo: false, onToolChange: vi.fn(), onAddNode: vi.fn(), onAddSharedMedia: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onFit: vi.fn(), onToggleGrid: vi.fn() };

  it('offers a selective rerun only when something is stale', () => {
    const onRerunStale = vi.fn();
    const view = render(<WorkflowToolbar {...base} staleCount={2} onRerunStale={onRerunStale} />);
    fireEvent.click(screen.getByTestId('workflow-rerun-stale'));
    expect(onRerunStale).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('workflow-rerun-stale')).toHaveTextContent('重跑 2 个过期节点');
    view.rerender(<WorkflowToolbar {...base} staleCount={0} onRerunStale={onRerunStale} />);
    expect(screen.queryByTestId('workflow-rerun-stale')).not.toBeInTheDocument();
  });

  it('shows Send to host for an eligible result and its status once requested', () => {
    const onSend = vi.fn();
    useWorkspaceStore.setState({ language: 'en' });
    const view = render(<WorkflowToolbar {...base} hostSend={{ host: 'Resolve', onSend }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Resolve' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    view.rerender(<WorkflowToolbar {...base} hostSend={{ host: 'Resolve', onSend, status: 'requested' }} />);
    expect(screen.getByTestId('workflow-host-send-status')).toHaveTextContent('Waiting for host panel');
    expect(screen.queryByRole('button', { name: 'Send to Resolve' })).not.toBeInTheDocument();
  });
});
