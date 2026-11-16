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

  it('gallery mode shows n / N, steps with arrow keys and offers 设为首图 only on alternates', async () => {
    const items = ['a', 'b', 'c'].map((id, index) => ({
      ...createWorkflowNode(id, index === 2 ? 'video' : 'image', { x: 0, y: 0 }, { href: 'data:image/png;base64,AA==', mimeType: index === 2 ? 'video/mp4' : 'image/png' }),
      title: '结果 ' + id,
    }));
    const onPromote = vi.fn();
    function Gallery() {
      const [index, setIndex] = useState(0);
      return <MediaPreviewModal node={null} onClose={() => {}} gallery={{ items, index, onIndexChange: setIndex, primaryId: 'a', onPromote }} />;
    }
    render(<Gallery />);
    const dialog = await screen.findByRole('dialog', { name: '素材预览：结果 a' });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /设为首图/ })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(await screen.findByText('2 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /设为首图/ }));
    expect(onPromote).toHaveBeenCalledWith(items[1]);
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(await screen.findByText('3 / 3')).toBeInTheDocument();
    expect(dialog.querySelector('video[controls]')).not.toBeNull();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(await screen.findByText('1 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^3 \/ 3/ }));
    expect(await screen.findByText('3 / 3')).toBeInTheDocument();
  });
});
