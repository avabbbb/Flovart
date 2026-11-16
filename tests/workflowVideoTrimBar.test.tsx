import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowVideoTrimBar } from '../components/workflow/WorkflowVideoTrimBar';

afterEach(cleanup);

const fakeVideo = () => {
  const video = { currentTime: 0, pause: vi.fn(), play: vi.fn(() => Promise.resolve()) } as unknown as HTMLVideoElement;
  const ref = createRef<HTMLVideoElement>() as { current: HTMLVideoElement | null };
  ref.current = video;
  return { video, ref };
};

describe('WorkflowVideoTrimBar (in-node trim)', () => {
  it('sets in/out with the keyboard, seeks the node video and confirms the range', () => {
    const { video, ref } = fakeVideo();
    const onConfirm = vi.fn();
    const { rerender } = render(<WorkflowVideoTrimBar videoRef={ref} durationSec={10} currentTimeSec={2} onConfirm={onConfirm} onCancel={vi.fn()} />);
    const bar = screen.getByTestId('video-trim-bar');
    expect(document.activeElement).toBe(bar);
    fireEvent.keyDown(bar, { key: 'i' });
    rerender(<WorkflowVideoTrimBar videoRef={ref} durationSec={10} currentTimeSec={5} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.keyDown(bar, { key: 'ArrowUp', shiftKey: true });
    expect(video.currentTime).toBe(5.01);
    fireEvent.keyDown(bar, { key: 'o' });
    expect(screen.getByTestId('trim-range').textContent).toBe('00:02.00 – 00:05.01');
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledWith(2.1, 5.11);
  });

  it('plays only the selection with space and cancels with Escape', () => {
    const { video, ref } = fakeVideo();
    const onCancel = vi.fn();
    const { rerender } = render(<WorkflowVideoTrimBar videoRef={ref} durationSec={10} currentTimeSec={0} onConfirm={vi.fn()} onCancel={onCancel} />);
    const bar = screen.getByTestId('video-trim-bar');
    fireEvent.change(screen.getByLabelText('出点'), { target: { value: '3' } });
    fireEvent.keyDown(bar, { key: ' ' });
    expect(video.play).toHaveBeenCalled();
    rerender(<WorkflowVideoTrimBar videoRef={ref} durationSec={10} currentTimeSec={3.2} onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(video.pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(3);
    fireEvent.keyDown(bar, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
