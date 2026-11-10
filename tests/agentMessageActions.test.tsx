import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowAgentMessages, type WorkflowAgentDisplayMessage } from '../components/workflow/WorkflowAgentMessages';

describe('agent message actions', () => {
  const messages: WorkflowAgentDisplayMessage[] = [
    { id: 'u1', role: 'user', text: '把时长改成 15 秒' },
    { id: 'a1', role: 'assistant', text: '已改好。' },
    { id: 't1', role: 'tool', text: 'ok', title: '批量修改画布', status: 'success' },
  ];

  it('shows branch only on assistant messages and reports clicks', () => {
    const onCopyMessage = vi.fn();
    const onBranchMessage = vi.fn();
    render(<WorkflowAgentMessages messages={messages} language="zho" onCopyMessage={onCopyMessage} onBranchMessage={onBranchMessage} />);

    expect(screen.getAllByRole('button', { name: '复制这条消息' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: '从这里分支' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '从这里分支' }));
    expect(onBranchMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }));

    const copyButtons = screen.getAllByRole('button', { name: '复制这条消息' });
    fireEvent.click(copyButtons[0]);
    expect(onCopyMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }));
  });

  it('disables branching while a turn is running', () => {
    render(<WorkflowAgentMessages messages={messages} language="en" onBranchMessage={vi.fn()} branchDisabled />);
    expect(screen.getByRole('button', { name: 'Branch from here' })).toBeDisabled();
  });
});
