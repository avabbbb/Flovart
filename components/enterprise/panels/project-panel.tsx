// 项目镜像面板
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, FolderGit2, RefreshCw, Upload } from 'lucide-react';
import { projectApi, type Project } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { FormInput, PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

export default function ProjectPanel({ org, perms, userId, toast }: PanelProps) {
  const canManage = perms.includes('org:manage');
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showSync, setShowSync] = useState(false);
  const [syncId, setSyncId] = useState('');
  const [syncTitle, setSyncTitle] = useState('');
  const [syncOwnerId, setSyncOwnerId] = useState(userId);
  const [syncNodeCount, setSyncNodeCount] = useState('');
  const [syncConnectionCount, setSyncConnectionCount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await projectApi.list(org.id, page, 20);
      setProjects(data?.list || []);
      setTotal(data?.total || 0);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, page, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const sync = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!syncId.trim() || !syncTitle.trim()) return;
    setSubmitting(true);
    try {
      await projectApi.sync(org.id, {
        id: syncId,
        orgId: org.id,
        ownerId: syncOwnerId || userId,
        title: syncTitle,
        nodeCount: syncNodeCount ? parseInt(syncNodeCount, 10) : undefined,
        connectionCount: syncConnectionCount ? parseInt(syncConnectionCount, 10) : undefined,
      });
      toast.show('项目已同步', 'success');
      setSyncId(''); setSyncTitle(''); setSyncNodeCount(''); setSyncConnectionCount(''); setShowSync(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '同步失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, syncId, syncTitle, syncOwnerId, userId, syncNodeCount, syncConnectionCount, fetch, toast]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('确认删除此项目镜像？')) return;
    try {
      await projectApi.delete(org.id, id);
      toast.show('已删除', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const inputStyle = { background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' } as const;

  return (
    <PanelCard>
      <PageHeader
        title="项目列表"
        subtitle={`共 ${total} 个项目`}
        action={
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowSync((v) => !v)}
              className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
              style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
              <Upload size={14} /><span className="text-xs font-semibold">同步项目</span>
            </button>
            <button type="button" onClick={fetch}
              className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
              style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink-soft)' }}>
              <RefreshCw size={14} /><span className="text-xs font-semibold">刷新</span>
            </button>
          </div>
        }
      />
      {showSync && (
        <form onSubmit={sync} className="mb-4 grid gap-2 rounded-lg p-3 sm:grid-cols-2" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <FormInput value={syncId} onChange={setSyncId} placeholder="项目 ID（必填）" autoFocus />
          <FormInput value={syncTitle} onChange={setSyncTitle} placeholder="项目标题（必填）" />
          <FormInput value={syncOwnerId} onChange={setSyncOwnerId} placeholder="所有者 ID" />
          <div className="flex gap-2">
            <input value={syncNodeCount} onChange={(e) => setSyncNodeCount(e.target.value)} placeholder="节点数" type="number"
              className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} />
            <input value={syncConnectionCount} onChange={(e) => setSyncConnectionCount(e.target.value)} placeholder="连接数" type="number"
              className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle} />
          </div>
          <button type="submit" disabled={submitting || !syncId.trim() || !syncTitle.trim()}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60 sm:col-span-2"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '同步中...' : '同步'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : projects.length === 0 ? (
        <EmptyState icon={<FolderGit2 size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无项目镜像" />
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
              <FolderGit2 size={14} style={{ color: 'var(--isl-ink-soft)' }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{p.title}</div>
                <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                  {p.nodeCount} 节点 · {p.connectionCount} 连接
                  {p.lastSyncedAt && ` · 同步于 ${new Date(p.lastSyncedAt).toLocaleString()}`}
                </div>
              </div>
              {canManage && (
                <button type="button" onClick={() => remove(p.id)} className="isl-icon-btn h-7 w-7" title="删除"><Trash2 size={12} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {total > 20 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="isl-icon-btn h-7 px-3 text-[11px] disabled:opacity-40">上一页</button>
          <span className="text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>{page} / {Math.ceil(total / 20)}</span>
          <button type="button" disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)} className="isl-icon-btn h-7 px-3 text-[11px] disabled:opacity-40">下一页</button>
        </div>
      )}
    </PanelCard>
  );
}
