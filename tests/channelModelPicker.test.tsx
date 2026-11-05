import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChannelModelPicker } from '../components/settings/ChannelModelPicker';

describe('ChannelModelPicker', () => {
  const existing = [{ id: 'gpt-4o', name: 'gpt-4o' }];
  const fetched = [
    { id: 'gpt-4o', name: 'gpt-4o', capability: 'text' as const },
    { id: 'kling-v2', name: 'kling-v2', capability: 'video' as const },
  ];

  it('splits fetched models into new and existing columns and confirms selection with capability override', () => {
    const onConfirm = vi.fn();
    render(<ChannelModelPicker existing={existing} fetched={fetched} fetching={false} fetchError={null} canFetch onFetch={() => undefined} onConfirm={onConfirm} onClose={() => undefined} />);

    const fresh = screen.getByTestId('channel-model-picker-fresh');
    expect(within(fresh).getByText('kling-v2')).toBeInTheDocument();
    expect(within(fresh).queryByText('gpt-4o')).toBeNull();

    fireEvent.click(within(fresh).getByRole('button', { name: '全选' }));
    fireEvent.change(screen.getByLabelText('能力 gpt-4o'), { target: { value: 'image' } });
    fireEvent.change(screen.getByPlaceholderText('手动输入模型 ID'), { target: { value: 'my-model' } });
    fireEvent.click(screen.getByRole('button', { name: '手动增加' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));

    expect(onConfirm).toHaveBeenCalledWith([
      { id: 'gpt-4o', name: 'gpt-4o', capability: 'image' },
      { id: 'my-model', name: 'my-model' },
      { id: 'kling-v2', name: 'kling-v2', capability: 'video' },
    ]);
  });

  it('returns the snapshot taken on open when cancelled', () => {
    const onClose = vi.fn();
    const { rerender } = render(<ChannelModelPicker existing={existing} fetched={[]} fetching={false} fetchError={null} canFetch onFetch={() => undefined} onConfirm={() => undefined} onClose={onClose} />);
    rerender(<ChannelModelPicker existing={[{ id: 'replaced', name: 'replaced' }]} fetched={[]} fetching={false} fetchError={null} canFetch onFetch={() => undefined} onConfirm={() => undefined} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalledWith(existing);
  });
});
