import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkflowProjectList } from '../components/workflow/WorkflowProjectList';
import { createWorkflowProject, useWorkflowStore } from '../components/workflow/store';
import { useWorkspaceStore } from '../stores/useWorkspaceStore';

afterEach(() => {
  useWorkflowStore.setState({ projects: [], activeProjectId: null });
  useWorkspaceStore.setState({ language: 'zho' });
});

describe('WorkflowProjectList accessibility and locale', () => {
  it('renders an English empty state and accessible actions', () => {
    useWorkspaceStore.setState({ language: 'en' });
    render(<WorkflowProjectList />);
    expect(screen.getByText('No workflows yet. Create one to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import workflow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New workflow' })).toBeInTheDocument();
  });

  it('opens a labelled delete alertdialog, closes on Escape, and restores focus', async () => {
    const project = createWorkflowProject('Promo cut');
    useWorkflowStore.setState({ projects: [project], activeProjectId: project.id });
    render(<WorkflowProjectList />);
    const trigger = screen.getByRole('button', { name: '删除 Promo cut' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('alertdialog', { name: '删除“Promo cut”？' });
    expect(dialog).toHaveAttribute('aria-describedby', 'workflow-delete-dialog-description');
    const cancel = screen.getByRole('button', { name: '取消' });
    await waitFor(() => expect(cancel).toHaveFocus());
    act(() => fireEvent.keyDown(dialog, { key: 'Escape' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
