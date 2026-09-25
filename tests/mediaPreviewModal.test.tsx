import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { MediaPreviewModal } from '../components/workflow/MediaPreviewModal';

function PreviewHarness() {
  const [open, setOpen] = useState(false);
  const node = { ...createWorkflowNode('preview-1', 'image', { x: 0, y: 0 }, {
    href: 'data:image/png;base64,AA==',
    mimeType: 'image/png',
  }), title: 'Test image' };
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open preview</button>
    <MediaPreviewModal node={open ? node : null} onClose={() => setOpen(false)} language="en" />
  </>;
}

describe('MediaPreviewModal', () => {
  it('exposes a modal dialog, focuses its close action, and restores focus on Escape', async () => {
    render(<PreviewHarness />);
    const trigger = screen.getByRole('button', { name: 'Open preview' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Media preview: Test image' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const close = screen.getByRole('button', { name: 'Close media preview' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('closes from the visible close button', async () => {
    const onClose = vi.fn();
    const node = createWorkflowNode('preview-2', 'image', { x: 0, y: 0 }, { href: 'data:image/png;base64,AA==', mimeType: 'image/png' });
    render(<MediaPreviewModal node={node} onClose={onClose} language="en" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close media preview' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
