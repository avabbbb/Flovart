/**
 * Non-blocking in-app confirmation.
 *
 * Replaces window.confirm, which freezes the whole renderer (and in some
 * desktop WebViews never shows at all, so the caller waits forever).
 * Guarantees: every request settles. It resolves on Allow/Cancel, on Esc,
 * when a newer request replaces it (false), or after `timeoutMs` (false).
 * If no host is mounted it resolves false immediately instead of hanging.
 */
import { useSyncExternalStore } from 'react';

export interface UiConfirmRequest {
  id: number;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: 'default' | 'danger';
  expiresAt: number | null;
}

export interface UiConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Auto-cancel after this many ms. Default 120s; pass 0 to wait for the user. */
  timeoutMs?: number;
  /** Called when the request closes without a user answer, so callers can tell the user nothing was submitted. */
  onDismissed?: (reason: 'timeout' | 'replaced' | 'unmounted') => void;
}

type Pending = { request: UiConfirmRequest; resolve: (value: boolean) => void; timer?: number; onDismissed?: UiConfirmOptions['onDismissed'] };

const DEFAULT_TIMEOUT_MS = 120_000;
let nextId = 1;
let pending: Pending | null = null;
let hostCount = 0;
const listeners = new Set<() => void>();

function emit() { listeners.forEach(listener => listener()); }

function settle(id: number, value: boolean, dismissedBy?: 'timeout' | 'replaced' | 'unmounted') {
  if (!pending || pending.request.id !== id) return;
  const current = pending;
  pending = null;
  clearTimeout(current.timer);
  emit();
  current.resolve(value);
  if (dismissedBy) current.onDismissed?.(dismissedBy);
}

export function requestUiConfirm(options: UiConfirmOptions): Promise<boolean> {
  if (hostCount === 0) return Promise.resolve(false);
  if (pending) settle(pending.request.id, false, 'replaced');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request: UiConfirmRequest = {
    id: nextId++,
    title: options.title,
    body: options.body,
    confirmLabel: options.confirmLabel || '确定',
    cancelLabel: options.cancelLabel || '取消',
    tone: options.tone || 'default',
    expiresAt: timeoutMs > 0 ? Date.now() + timeoutMs : null,
  };
  return new Promise<boolean>(resolve => {
    pending = { request, resolve, onDismissed: options.onDismissed };
    if (timeoutMs > 0) pending.timer = window.setTimeout(() => settle(request.id, false, 'timeout'), timeoutMs);
    emit();
  });
}

export function answerUiConfirm(id: number, value: boolean) { settle(id, value); }

export function registerUiConfirmHost(): () => void {
  hostCount += 1;
  return () => {
    hostCount = Math.max(0, hostCount - 1);
    if (hostCount === 0 && pending) settle(pending.request.id, false, 'unmounted');
  };
}

function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function snapshot() { return pending?.request ?? null; }

export function useUiConfirmRequest(): UiConfirmRequest | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Current pending request, if any (non-React callers and tests). */
export function getPendingUiConfirm(): UiConfirmRequest | null { return snapshot(); }

/** Test helper. */
export function resetUiConfirmForTests() {
  clearTimeout(pending?.timer);
  pending = null; hostCount = 0; listeners.clear();
}
