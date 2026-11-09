import { useMemo, useRef, useState } from 'react';

/** 工具会话事务：记录发起时的项目/节点与历史帧，异步结果据此判定是否仍归属当前会话。 */
export type ToolTransaction<F> = { id: string; projectId: string; nodeId: string; frame: F };

/**
 * 工具会话状态机：
 * - closed：无会话；
 * - open：对话框已打开，等待确认；
 * - running：操作执行中（tool 为 null 表示无对话框的直接操作，如移除背景、截帧、音视频分离）；
 * - failed：操作失败，对话框保持可见并展示错误。
 */
export type ToolSessionState<T> =
  | { phase: 'closed' }
  | { phase: 'open'; tool: T; transactionId: string }
  | { phase: 'running'; tool: T | null; transactionId: string }
  | { phase: 'failed'; tool: T; transactionId: string; error: string };

export type ToolSessionAction<T> =
  | { type: 'open'; tool: T; transactionId: string }
  | { type: 'start'; transactionId: string }
  | { type: 'fail'; transactionId: string; error: string }
  | { type: 'settle'; transactionId: string }
  | { type: 'close'; transactionId: string }
  | { type: 'reset' };

const CLOSED_TOOL_SESSION: { phase: 'closed' } = { phase: 'closed' };

/** 纯转移函数：不属于当前事务或当前阶段不允许的动作原样返回 state。 */
export function toolSessionReducer<T>(state: ToolSessionState<T>, action: ToolSessionAction<T>): ToolSessionState<T> {
  if (action.type === 'reset') return state.phase === 'closed' ? state : CLOSED_TOOL_SESSION;
  if (action.type === 'open') return state.phase === 'closed' ? { phase: 'open', tool: action.tool, transactionId: action.transactionId } : state;
  if (action.type === 'start') {
    if (state.phase === 'closed') return { phase: 'running', tool: null, transactionId: action.transactionId };
    if (state.phase === 'running' || state.transactionId !== action.transactionId) return state;
    return { phase: 'running', tool: state.tool, transactionId: state.transactionId };
  }
  if (state.phase === 'closed' || state.transactionId !== action.transactionId) return state;
  if (action.type === 'close') return CLOSED_TOOL_SESSION;
  if (state.phase !== 'running') return state;
  if (action.type === 'fail') {
    return state.tool !== null ? { phase: 'failed', tool: state.tool, transactionId: state.transactionId, error: action.error } : CLOSED_TOOL_SESSION;
  }
  return state.tool !== null ? { phase: 'open', tool: state.tool, transactionId: state.transactionId } : CLOSED_TOOL_SESSION;
}

export function deriveToolSession<T>(state: ToolSessionState<T>) {
  return {
    tool: state.phase === 'closed' ? null : state.tool,
    busy: state.phase === 'running',
    error: state.phase === 'failed' ? state.error : null,
    active: state.phase !== 'closed',
  };
}

export type ToolSessionControls<T, F> = {
  current: () => ToolTransaction<F> | null;
  owns: (transaction: ToolTransaction<F>) => boolean;
  isLocked: () => boolean;
  isBusy: () => boolean;
  /** 打开对话框会话；已有会话时返回 false。 */
  open: (tool: T, transaction: ToolTransaction<F>) => boolean;
  /** 无对话框的直接操作：独占会话并进入 running；已有会话时返回 false。 */
  begin: (transaction: ToolTransaction<F>) => boolean;
  start: (transaction: ToolTransaction<F>) => boolean;
  fail: (transaction: ToolTransaction<F>, error: string) => boolean;
  /** finally 收尾：仅在仍持有事务时解除 busy，对话框会话回到 open，直接操作关闭。 */
  settle: (transaction: ToolTransaction<F>) => boolean;
  close: (transaction: ToolTransaction<F>) => boolean;
  reset: () => void;
};

/** 每类工具（图片/视频/音频）一个会话：统一持有 busy、error、事务与同步 ref 镜像。 */
export function useToolSession<T, F>() {
  const [state, setState] = useState<ToolSessionState<T>>(CLOSED_TOOL_SESSION);
  const stateRef = useRef<ToolSessionState<T>>(state);
  const transactionRef = useRef<ToolTransaction<F> | null>(null);
  const controls = useMemo<ToolSessionControls<T, F>>(() => {
    const apply = (action: ToolSessionAction<T>) => {
      const next = toolSessionReducer(stateRef.current, action);
      if (next === stateRef.current) return false;
      stateRef.current = next;
      setState(next);
      return true;
    };
    const owns = (transaction: ToolTransaction<F>) => {
      const current = transactionRef.current;
      return current?.id === transaction.id && current.projectId === transaction.projectId && current.nodeId === transaction.nodeId;
    };
    const isLocked = () => transactionRef.current !== null || stateRef.current.phase !== 'closed';
    const releaseIfClosed = () => { if (stateRef.current.phase === 'closed') transactionRef.current = null; };
    return {
      current: () => transactionRef.current,
      owns,
      isLocked,
      isBusy: () => stateRef.current.phase === 'running',
      open: (tool, transaction) => {
        if (isLocked()) return false;
        transactionRef.current = transaction;
        return apply({ type: 'open', tool, transactionId: transaction.id });
      },
      begin: transaction => {
        if (isLocked()) return false;
        transactionRef.current = transaction;
        return apply({ type: 'start', transactionId: transaction.id });
      },
      start: transaction => owns(transaction) && apply({ type: 'start', transactionId: transaction.id }),
      fail: (transaction, error) => {
        if (!owns(transaction)) return false;
        const changed = apply({ type: 'fail', transactionId: transaction.id, error });
        releaseIfClosed();
        return changed;
      },
      settle: transaction => {
        if (!owns(transaction)) return false;
        const changed = apply({ type: 'settle', transactionId: transaction.id });
        releaseIfClosed();
        return changed;
      },
      close: transaction => {
        if (!owns(transaction)) return false;
        transactionRef.current = null;
        apply({ type: 'close', transactionId: transaction.id });
        return true;
      },
      reset: () => {
        transactionRef.current = null;
        apply({ type: 'reset' });
      },
    };
  }, []);
  return { state, ...deriveToolSession(state), controls };
}
