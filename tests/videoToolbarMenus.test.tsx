import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowNodeToolbar } from '../components/workflow/WorkflowNodeToolbar';

type VideoMetadata = Parameters<typeof createWorkflowNode>[3];
const video = (metadata: VideoMetadata) => createWorkflowNode('v1', 'video', { x: 0, y: 0 }, { name: 'clip.mp4', status: 'success', ...metadata });

describe('video node toolbar', () => {
  it('offers split, vocals and background extraction plus frame capture from dropdowns', () => {
    const avSplit = vi.fn();
    const extractFrame = vi.fn();
    const extractFrameAt = vi.fn();
    render(<WorkflowNodeToolbar nodes={[video({ href: 'data:video/mp4;base64,AA==' })]} onCopy={vi.fn()} onDelete={vi.fn()} videoTools={{ trim: vi.fn(), avSplit, extractFrame, extractFrameAt }} />);

    fireEvent.click(screen.getByRole('button', { name: '分离音视频' }));
    expect(screen.getByRole('menuitem', { name: '背景音提取' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '人声提取' }));
    expect(avSplit).toHaveBeenCalledWith('v1', 'vocals');

    fireEvent.click(screen.getByRole('button', { name: '视频截帧' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '截取尾帧' }));
    expect(extractFrame).toHaveBeenCalledWith('v1', 'last');
  });

  it('keeps video tools visible but disabled while the media is still resolving', () => {
    render(<WorkflowNodeToolbar nodes={[video({ storageKey: 'not-loaded-yet' })]} onCopy={vi.fn()} onDelete={vi.fn()} videoTools={{ trim: vi.fn(), avSplit: vi.fn(), extractFrame: vi.fn() }} />);
    expect(screen.getByRole('button', { name: '分离音视频' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '视频剪辑' })).toBeDisabled();
  });
});
