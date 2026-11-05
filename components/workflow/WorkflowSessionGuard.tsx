import { useEffect, useState } from 'react';
import { downloadWorkflowProjects } from './projectTransfer';
import {
  getWorkflowPersistenceError,
  retryWorkflowPersistence,
  subscribeWorkflowPersistenceError,
  useWorkflowStore,
  type WorkflowPersistenceError,
} from './store';
import { isWorkflowHandoffRefused, requestWorkflowWriterHandoff, subscribeWorkflowWriter, useWorkflowWriterState } from './writerLock';

function describeError(error: WorkflowPersistenceError, zh: boolean) {
  const cause = error.error as { name?: string; message?: string } | undefined;
  const quota = /quota/i.test((cause?.name || '') + ' ' + (cause?.message || ''));
  if (error.operation === 'read') {
    return zh ? '读取已保存的项目失败，当前显示的可能不是最新数据。' : 'Could not read saved projects; what you see may be out of date.';
  }
  if (error.operation === 'remove') {
    return zh ? '删除项目数据失败。' : 'Could not remove project data.';
  }
  if (quota) {
    return zh ? '保存失败：浏览器存储空间不足。请先导出项目，再删除不用的项目或媒体。' : 'Save failed: browser storage is full. Export your projects, then remove ones you no longer need.';
  }
  return zh ? '保存失败：最近的修改还没写入浏览器存储，关闭页面前请重试或导出项目。' : 'Save failed: recent edits are not in browser storage yet. Retry or export before closing this page.';
}

export function WorkflowSessionGuard({ language }: { language: string }) {
  const zh = language === 'zho';
  const writerState = useWorkflowWriterState();
  const [refused, setRefused] = useState(isWorkflowHandoffRefused);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<WorkflowPersistenceError | null>(getWorkflowPersistenceError);
  const [busy, setBusy] = useState<'retry' | 'export' | null>(null);
  const [exportFailed, setExportFailed] = useState(false);

  useEffect(() => subscribeWorkflowWriter(() => {
    setRefused(isWorkflowHandoffRefused());
    if (isWorkflowHandoffRefused()) setRequested(false);
  }), []);
  useEffect(() => {
    const unsubscribe = subscribeWorkflowPersistenceError(setError);
    return () => { unsubscribe(); };
  }, []);
  useEffect(() => {
    if (writerState !== 'reader') setRequested(false);
  }, [writerState]);

  const retry = async () => {
    setBusy('retry');
    try {
      await retryWorkflowPersistence();
    } finally {
      setBusy(null);
    }
  };
  const exportProjects = async () => {
    setBusy('export');
    setExportFailed(false);
    try {
      await downloadWorkflowProjects(useWorkflowStore.getState().projects, 'Flovart-Workflow-backup');
    } catch (exportError) {
      console.error('[Workflow] Backup export failed.', exportError);
      setExportFailed(true);
    } finally {
      setBusy(null);
    }
  };
  const takeOver = () => {
    setRequested(true);
    requestWorkflowWriterHandoff();
  };

  return (
    <>
      {writerState === 'reader' && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/30 px-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" data-testid="workflow-readonly-guard">
          <div className="w-full max-w-sm rounded-xl px-5 py-4 text-center shadow-xl" style={{ background: 'var(--isl-surface, #fff)', color: 'var(--isl-ink)' }}>
            <div className="text-sm font-bold">{zh ? 'Flovart 已在另一个标签页打开' : 'Flovart is open in another tab'}</div>
            <p className="mt-2 text-xs leading-5" style={{ color: 'var(--isl-ink-soft)' }}>
              {zh ? '为避免两个标签页互相覆盖项目和媒体，同一时间只有一个标签页可以编辑。' : 'Only one tab can edit at a time, so tabs never overwrite each other\'s projects or media.'}
            </p>
            {refused && (
              <p className="mt-2 text-xs leading-5 text-amber-600">{zh ? '另一个标签页还有生成任务在运行，完成后再接管。' : 'The other tab is still generating. Try again when it finishes.'}</p>
            )}
            <button
              type="button"
              className="mt-3 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
              style={{ background: 'var(--isl-ink)', color: 'var(--isl-surface, #fff)' }}
              disabled={requested}
              onClick={takeOver}
              data-testid="workflow-readonly-takeover"
            >
              {requested ? (zh ? '正在接管…' : 'Taking over…') : (zh ? '在此标签页编辑' : 'Edit in this tab')}
            </button>
          </div>
        </div>
      )}
      {writerState !== 'reader' && error && (
        <div
          className="fixed bottom-4 left-1/2 z-[75] flex w-[min(92vw,560px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-xs shadow-lg"
          style={{ background: '#fff4f2', color: '#8a1f11', border: '1px solid #f3c4bb' }}
          role="alert"
          data-testid="workflow-persistence-error"
        >
          <span className="min-w-0 flex-1 leading-5">
            {describeError(error, zh)}
            {exportFailed && (zh ? ' 导出也失败了。' : ' Export failed too.')}
          </span>
          <button type="button" className="rounded-md border border-current px-2 py-1 font-semibold disabled:opacity-60" disabled={busy !== null} onClick={() => { void retry(); }} data-testid="workflow-persistence-retry">
            {busy === 'retry' ? (zh ? '重试中…' : 'Retrying…') : (zh ? '重试' : 'Retry')}
          </button>
          <button type="button" className="rounded-md border border-current px-2 py-1 font-semibold disabled:opacity-60" disabled={busy !== null} onClick={() => { void exportProjects(); }} data-testid="workflow-persistence-export">
            {busy === 'export' ? (zh ? '导出中…' : 'Exporting…') : (zh ? '导出项目' : 'Export projects')}
          </button>
        </div>
      )}
    </>
  );
}
