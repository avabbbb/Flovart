import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowHostStrip } from '../components/workflow/WorkflowHostStrip';

describe('WorkflowHostStrip', () => {
  it('lists host clips and focuses the clicked one', () => {
    const onFocusClip = vi.fn();
    render(<WorkflowHostStrip language="en" onFocusClip={onFocusClip} clips={[
      { nodeId: 'a', host: 'resolve', label: 'Shot 04', locator: { projectId: 'p' }, resultCount: 3, sentCount: 1 },
      { nodeId: 'b', host: 'resolve', label: 'Shot 05', locator: { projectId: 'p' }, resultCount: 0, sentCount: 0 },
    ]} />);
    expect(screen.getByRole('navigation', { name: 'Host timeline clips' })).toBeInTheDocument();
    expect(screen.getByText('3 results')).toBeInTheDocument();
    expect(screen.getByText('1 sent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show Shot 05 on the canvas' }));
    expect(onFocusClip).toHaveBeenCalledWith('b');
  });

  it('renders nothing without host clips', () => {
    const { container } = render(<WorkflowHostStrip clips={[]} onFocusClip={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
