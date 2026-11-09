import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { toolSessionReducer, useToolSession, type ToolSessionState, type ToolTransaction } from '../components/workflow/useToolSession';

type Tool = { kind: string; nodeId: string };
const closed: ToolSessionState<Tool> = { phase: 'closed' };
const tx = (id: string, projectId = 'project-a', nodeId = 'node-a'): ToolTransaction<null> => ({ id, projectId, nodeId, frame: null });

describe('toolSessionReducer', () => {
  it('walks open -> running -> open for a dialog session', () => {
    const opened = toolSessionReducer(closed, { type: 'open', tool: { kind: 'trim', nodeId: 'n' }, transactionId: 't1' });
    expect(opened).toEqual({ phase: 'open', tool: { kind: 'trim', nodeId: 'n' }, transactionId: 't1' });
    const running = toolSessionReducer(opened, { type: 'start', transactionId: 't1' });
    expect(running.phase).toBe('running');
    expect(toolSessionReducer(running, { type: 'settle', transactionId: 't1' })).toEqual(opened);
  });

  it('keeps the dialog visible with the error on failure and clears it on retry or close', () => {
    const running: ToolSessionState<Tool> = { phase: 'running', tool: { kind: 'trim', nodeId: 'n' }, transactionId: 't1' };
    const failed = toolSessionReducer(running, { type: 'fail', transactionId: 't1', error: 'boom' });
    expect(failed).toEqual({ phase: 'failed', tool: { kind: 'trim', nodeId: 'n' }, transactionId: 't1', error: 'boom' });
    expect(toolSessionReducer(failed, { type: 'settle', transactionId: 't1' })).toBe(failed);
    expect(toolSessionReducer(failed, { type: 'start', transactionId: 't1' })).toEqual(running);
    expect(toolSessionReducer(failed, { type: 'close', transactionId: 't1' })).toEqual(closed);
  });

  it('closes a direct operation (no dialog) when it settles or fails', () => {
    const running = toolSessionReducer(closed, { type: 'start', transactionId: 't1' });
    expect(running).toEqual({ phase: 'running', tool: null, transactionId: 't1' });
    expect(toolSessionReducer(running, { type: 'settle', transactionId: 't1' })).toEqual(closed);
    expect(toolSessionReducer(running, { type: 'fail', transactionId: 't1', error: 'x' })).toEqual(closed);
  });

  it('ignores actions from another transaction and opens only when closed', () => {
    const running: ToolSessionState<Tool> = { phase: 'running', tool: null, transactionId: 't2' };
    expect(toolSessionReducer(running, { type: 'settle', transactionId: 't1' })).toBe(running);
    expect(toolSessionReducer(running, { type: 'fail', transactionId: 't1', error: 'x' })).toBe(running);
    expect(toolSessionReducer(running, { type: 'close', transactionId: 't1' })).toBe(running);
    expect(toolSessionReducer(running, { type: 'open', tool: { kind: 'trim', nodeId: 'n' }, transactionId: 't3' })).toBe(running);
    expect(toolSessionReducer(running, { type: 'reset' })).toEqual(closed);
  });
});

describe('useToolSession', () => {
  it('video: a stale direct operation from the previous project does not clear the newer session busy state', () => {
    const { result } = renderHook(() => useToolSession<Tool, null>());
    const oldTx = tx('old', 'project-a', 'video-a');
    const newTx = tx('new', 'project-b', 'video-b');
    act(() => { expect(result.current.controls.begin(oldTx)).toBe(true); });
    expect(result.current.busy).toBe(true);
    // 项目切换
    act(() => { result.current.controls.reset(); });
    act(() => { expect(result.current.controls.begin(newTx)).toBe(true); });
    act(() => {
      expect(result.current.controls.owns(oldTx)).toBe(false);
      expect(result.current.controls.fail(oldTx, 'stale')).toBe(false);
      expect(result.current.controls.settle(oldTx)).toBe(false);
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.controls.isBusy()).toBe(true);
    expect(result.current.controls.current()).toBe(newTx);
    act(() => { result.current.controls.settle(newTx); });
    expect(result.current.state).toEqual({ phase: 'closed' });
    expect(result.current.controls.current()).toBeNull();
  });

  it('audio: a stale dialog confirmation does not close, fail or unbusy the newer dialog session', () => {
    const { result } = renderHook(() => useToolSession<Tool, null>());
    const oldTx = tx('old', 'project-a', 'audio-a');
    const newTx = tx('new', 'project-b', 'audio-b');
    act(() => { result.current.controls.open({ kind: 'trim', nodeId: 'audio-a' }, oldTx); });
    act(() => { result.current.controls.start(oldTx); });
    act(() => { result.current.controls.reset(); });
    act(() => { expect(result.current.controls.open({ kind: 'speed', nodeId: 'audio-b' }, newTx)).toBe(true); });
    act(() => { result.current.controls.start(newTx); });
    act(() => {
      expect(result.current.controls.fail(oldTx, '音频处理失败')).toBe(false);
      expect(result.current.controls.close(oldTx)).toBe(false);
      expect(result.current.controls.settle(oldTx)).toBe(false);
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.tool).toEqual({ kind: 'speed', nodeId: 'audio-b' });
  });

  it('locks while open, keeps the transaction after a failed run and releases it on close', () => {
    const { result } = renderHook(() => useToolSession<Tool, null>());
    const first = tx('first');
    act(() => { result.current.controls.open({ kind: 'trim', nodeId: 'node-a' }, first); });
    expect(result.current.controls.isLocked()).toBe(true);
    act(() => { expect(result.current.controls.begin(tx('second'))).toBe(false); });
    act(() => { result.current.controls.start(first); });
    act(() => { result.current.controls.fail(first, '视频处理失败'); });
    expect(result.current.error).toBe('视频处理失败');
    expect(result.current.busy).toBe(false);
    expect(result.current.tool).toEqual({ kind: 'trim', nodeId: 'node-a' });
    expect(result.current.controls.current()).toBe(first);
    act(() => { result.current.controls.close(first); });
    expect(result.current.active).toBe(false);
    expect(result.current.controls.isLocked()).toBe(false);
  });
});
