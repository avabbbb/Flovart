import { afterEach, describe, expect, it, vi } from 'vitest';
import { answerUiConfirm, getPendingUiConfirm, registerUiConfirmHost, requestUiConfirm, resetUiConfirmForTests } from '../services/uiConfirm';

describe('uiConfirm never leaves a caller waiting', () => {
  afterEach(() => { vi.useRealTimers(); resetUiConfirmForTests(); });

  it('resolves false at once when no host is mounted', async () => {
    await expect(requestUiConfirm({ title: 'x' })).resolves.toBe(false);
  });

  it('resolves with the user answer', async () => {
    registerUiConfirmHost();
    const promise = requestUiConfirm({ title: 'x' });
    answerUiConfirm(getPendingUiConfirm()!.id, true);
    await expect(promise).resolves.toBe(true);
    expect(getPendingUiConfirm()).toBeNull();
  });

  it('a newer request cancels the older one', async () => {
    registerUiConfirmHost();
    const first = requestUiConfirm({ title: 'a' });
    const second = requestUiConfirm({ title: 'b', timeoutMs: 0 });
    await expect(first).resolves.toBe(false);
    answerUiConfirm(getPendingUiConfirm()!.id, true);
    await expect(second).resolves.toBe(true);
  });

  it('times out to false', async () => {
    vi.useFakeTimers();
    registerUiConfirmHost();
    const promise = requestUiConfirm({ title: 'x', timeoutMs: 1000 });
    vi.advanceTimersByTime(1001);
    await expect(promise).resolves.toBe(false);
  });

  it('unmounting the last host cancels the pending request', async () => {
    const unregister = registerUiConfirmHost();
    const promise = requestUiConfirm({ title: 'x' });
    unregister();
    await expect(promise).resolves.toBe(false);
  });
});
