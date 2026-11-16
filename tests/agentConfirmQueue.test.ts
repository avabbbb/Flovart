import { describe, expect, it, vi } from 'vitest';

import { advanceConfirmation, enqueueConfirmation, rejectAllConfirmations, type ConfirmationQueue } from '../components/agent/agentPanelState';

type Item = { id: string; resolve: ReturnType<typeof vi.fn<(approved: boolean) => void>> };
const item = (id: string): Item => ({ id, resolve: vi.fn<(approved: boolean) => void>() });

describe('parallel tool-call confirmations queue instead of superseding', () => {
  it('shows the first, queues the second, and never auto-denies the first', () => {
    const queue: ConfirmationQueue<Item> = { current: undefined, waiting: [] };
    const a = item('a');
    const b = item('b');
    expect(enqueueConfirmation(queue, a)).toBe(true);
    expect(enqueueConfirmation(queue, b)).toBe(false);
    expect(a.resolve).not.toHaveBeenCalled();
    a.resolve(true);
    expect(advanceConfirmation(queue)).toBe(b);
    expect(queue.current).toBe(b);
    expect(advanceConfirmation(queue)).toBeUndefined();
  });

  it('a just-granted session grant auto-approves queued calls of the same tool', () => {
    const queue: ConfirmationQueue<Item> = { current: undefined, waiting: [] };
    const [a, b, c] = [item('a'), item('b'), item('c')];
    [a, b, c].forEach(entry => enqueueConfirmation(queue, entry));
    expect(advanceConfirmation(queue, entry => entry.id === 'b')).toBe(c);
    expect(b.resolve).toHaveBeenCalledWith(true);
  });

  it('stop / project switch rejects the current and every queued confirmation', () => {
    const queue: ConfirmationQueue<Item> = { current: undefined, waiting: [] };
    const [a, b] = [item('a'), item('b')];
    enqueueConfirmation(queue, a);
    enqueueConfirmation(queue, b);
    rejectAllConfirmations(queue);
    expect(a.resolve).toHaveBeenCalledWith(false);
    expect(b.resolve).toHaveBeenCalledWith(false);
    expect(queue).toEqual({ current: undefined, waiting: [] });
  });
});
