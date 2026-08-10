import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkflowDraftTimeline } from '../components/workflow/WorkflowDraftTimeline';

describe('Workflow Draft timeline', () => {
  it('shows Agent and human changes from the shared Draft history', () => {
    render(<WorkflowDraftTimeline rightInset={414} changeSets={[
      {
        id: 'agent-turn',
        at: '2026-08-10T08:00:00.000Z',
        actor: 'agent',
        intent: '创建 VOX 分镜节点',
        status: 'completed',
        baseDraftVersion: 1,
        resultDraftVersion: 2,
        nodeChanges: [{ id: 'shot-1', after: {} as never }],
        connectionChanges: [],
      },
      {
        id: 'human-turn',
        at: '2026-08-10T08:01:00.000Z',
        actor: 'ui',
        intent: '移动节点',
        status: 'completed',
        baseDraftVersion: 2,
        resultDraftVersion: 3,
        nodeChanges: [{ id: 'shot-1', before: {} as never, after: {} as never }],
        connectionChanges: [],
      },
    ]} />);

    fireEvent.click(screen.getByRole('button', { name: '打开 Draft 时间线' }));

    expect(screen.getByRole('region', { name: 'Draft 时间线' }).closest('[data-workflow-overlay]')).toHaveStyle({ right: '414px' });
    expect(screen.getByText('创建 VOX 分镜节点')).toBeInTheDocument();
    expect(screen.getByText('移动节点')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('你')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
  });
});
