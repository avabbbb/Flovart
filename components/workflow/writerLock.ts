import { useSyncExternalStore } from 'react';

// 多标签页写入者选举：同一浏览器 profile 内只有一个标签页可以落盘工作流、清理媒体、处理中断节点。
// 其余标签页只读，写入者落盘后通过 BroadcastChannel 通知它们从存储重新水合。
// 不支持 Web Locks 的环境（旧浏览器、单测）退化为单标签页行为：直接成为写入者。

export type WorkflowWriterState = 'pending' | 'writer' | 'reader';

export interface WorkflowWriterHooks {
  /** 从只读转为写入者、或收到写入者落盘通知时，从存储重新水合。 */
  reloadFromStorage: () => Promise<void>;
  /** 交出写入权前把防抖中的修改落盘。 */
  flush: () => Promise<void>;
  /** 有生成任务在跑时拒绝交出，避免新写入者把它们判为中断。 */
  canHandOff: () => boolean;
}

type SyncMessage =
  | { type: 'persisted'; from: string }
  | { type: 'handoff-request'; from: string }
  | { type: 'handoff-ready'; to: string }
  | { type: 'handoff-refused'; to: string };

const LOCK_NAME = 'flovart:workflow:writer';
const CHANNEL_NAME = 'flovart:workflow:sync';
const HANDOFF_TIMEOUT_MS = 3000;
const tabId = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

let state: WorkflowWriterState = 'pending';
let handoffRefused = false;
let holding = false;
let started = false;
let hooks: WorkflowWriterHooks | null = null;
let channel: BroadcastChannel | null = null;
let queueAbort: AbortController | null = null;
let decidedWaiters: Array<() => void> = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach(listener => {
    try {
      listener();
    } catch (error) {
      console.error('[Workflow] Writer listener failed.', error);
    }
  });
}

function setState(next: WorkflowWriterState) {
  if (state === next) return;
  state = next;
  if (next !== 'pending') {
    const waiters = decidedWaiters;
    decidedWaiters = [];
    waiters.forEach(resolve => resolve());
  }
  emit();
}

export const getWorkflowWriterState = () => state;
export const isWorkflowWriter = () => state === 'writer';
export const isWorkflowHandoffRefused = () => handoffRefused;

export function whenWorkflowWriterDecided(): Promise<void> {
  return state === 'pending' ? new Promise(resolve => decidedWaiters.push(resolve)) : Promise.resolve();
}

export function subscribeWorkflowWriter(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWorkflowWriterState(): WorkflowWriterState {
  return useSyncExternalStore(subscribeWorkflowWriter, getWorkflowWriterState, () => 'writer');
}

function post(message: SyncMessage) {
  try {
    channel?.postMessage(message);
  } catch (error) {
    console.warn('[Workflow] Failed to broadcast sync message.', error);
  }
}

const locksAvailable = () => typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

async function becomeWriter() {
  if (state === 'reader' && hooks) {
    try {
      await hooks.reloadFromStorage();
    } catch (error) {
      console.warn('[Workflow] Failed to reload projects before taking the writer role.', error);
    }
  }
  handoffRefused = false;
  setState('writer');
}

// 持有锁直到标签页关闭或被接管（steal）。
function holdLock(): Promise<void> {
  holding = true;
  void becomeWriter();
  return new Promise<void>(() => undefined);
}

function onLockLost() {
  holding = false;
  setState('reader');
  queueForLock();
}

function queueForLock() {
  const controller = new AbortController();
  queueAbort = controller;
  navigator.locks.request(LOCK_NAME, { signal: controller.signal }, holdLock).catch(() => {
    // 自己撤销排队（改为接管）时不重新排队；持有后被其它标签页接管则转只读并重新排队。
    if (controller.signal.aborted && !holding) return;
    onLockLost();
  });
}

function takeOver() {
  queueAbort?.abort();
  queueAbort = null;
  navigator.locks.request(LOCK_NAME, { steal: true }, holdLock).catch(onLockLost);
}

async function onMessage(message: SyncMessage) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'persisted') {
    if (state === 'reader') await hooks?.reloadFromStorage().catch(error => console.warn('[Workflow] Failed to sync projects from the writer tab.', error));
    return;
  }
  if (message.type === 'handoff-request') {
    if (state !== 'writer') return;
    if (hooks && !hooks.canHandOff()) {
      post({ type: 'handoff-refused', to: message.from });
      return;
    }
    try {
      await hooks?.flush();
    } catch (error) {
      console.warn('[Workflow] Flush before handoff failed.', error);
    }
    // 先停止写入，锁留给请求方 steal；请求方超时未接管则恢复写入，避免无人落盘。
    setState('reader');
    post({ type: 'handoff-ready', to: message.from });
    setTimeout(() => {
      if (holding && state === 'reader') void becomeWriter();
    }, HANDOFF_TIMEOUT_MS);
    return;
  }
  if (message.type === 'handoff-ready') {
    if (message.to === tabId && state === 'reader') takeOver();
    return;
  }
  if (message.type === 'handoff-refused' && message.to === tabId) {
    handoffRefused = true;
    emit();
  }
}

/** 只读标签页请求接管编辑。写入者先落盘再交出；有生成任务在跑时会拒绝。 */
export function requestWorkflowWriterHandoff() {
  if (state !== 'reader' || !locksAvailable()) return;
  handoffRefused = false;
  emit();
  if (!channel) {
    takeOver();
    return;
  }
  post({ type: 'handoff-request', from: tabId });
}

export function notifyWorkflowPersisted() {
  if (state === 'writer') post({ type: 'persisted', from: tabId });
}

export function startWorkflowWriterElection(nextHooks: WorkflowWriterHooks) {
  hooks = nextHooks;
  if (started) return;
  started = true;
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = event => { void onMessage(event.data as SyncMessage); };
    // Node 的 BroadcastChannel 会拖住进程退出（单测）。
    (channel as unknown as { unref?: () => void }).unref?.();
  }
  if (!locksAvailable()) {
    setState('writer');
    return;
  }
  navigator.locks.request(LOCK_NAME, { ifAvailable: true }, lock => {
    if (!lock) {
      setState('reader');
      queueForLock();
      return undefined;
    }
    return holdLock();
  }).catch(onLockLost);
}
