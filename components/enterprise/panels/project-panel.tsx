// 项目镜像面板
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, FolderGit2, RefreshCw } from 'lucide-react';
import { projectApi, type Project } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

export default function ProjectPanel({ org, perms, toast }: PanelProps) {
  const canManage = perms.includes('org:manage');
  const [projects, setProjects] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

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

  return (
    <PanelCard>
      <PageHeader
        title="项目列表"
        subtitle={`共 ${total} 个项目`}
        action={
          <button type="button" onClick={fetch}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <RefreshCw size={14} /><span className="text-xs font-semibold">刷新</span>
          </button>
        }
      />
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
