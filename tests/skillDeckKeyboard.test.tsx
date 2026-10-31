import { act, render, screen, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ProductionSkillDeck } from '../components/agent/ProductionSkillDeck';

describe('ProductionSkillDeck keyboard selection from the composer', () => {
  it('↓ enters the list, ↑ past the first row returns to the input, Enter picks the highlighted Skill', async () => {
    const keyboardRef: { current: ((key: string) => boolean) | null } = { current: null };
    const onChange = vi.fn();
    const dropTargetRef = createRef<HTMLDivElement>();
    render(<div ref={dropTargetRef}><ProductionSkillDeck onChange={onChange} dropTargetRef={dropTargetRef} open onOpenChange={vi.fn()} searchQuery="" keyboardRef={keyboardRef} /></div>);

    await waitFor(() => expect(keyboardRef.current).toBeTypeOf('function'));
    const rows = await screen.findAllByRole('group');
    expect(rows.length).toBeGreaterThan(0);

    // 未进入列表：↑ 不消费（输入框光标正常移动），Enter 被吞掉但不选中
    expect(keyboardRef.current!('ArrowUp')).toBe(false);
    act(() => { expect(keyboardRef.current!('Enter')).toBe(true); });
    expect(onChange).not.toHaveBeenCalled();

    act(() => { expect(keyboardRef.current!('ArrowDown')).toBe(true); });
    expect(rows[0]).toHaveAttribute('data-highlighted', 'true');

    act(() => { expect(keyboardRef.current!('ArrowUp')).toBe(true); });
    expect(rows[0]).not.toHaveAttribute('data-highlighted');

    act(() => { keyboardRef.current!('ArrowDown'); });
    await act(async () => { keyboardRef.current!('Enter'); });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) })));
  });
});
