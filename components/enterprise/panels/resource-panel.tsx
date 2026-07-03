// 资源管理面板 — 资源库/密级
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, Image, Layers, Check, X } from 'lucide-react';
import { resourceApi, type Resource, type ResourceLevel } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { FormInput, PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

type SubTab = 'library' | 'levels';

export default function ResourcePanel({ org, perms, toast }: PanelProps) {
  const [sub, setSub] = useState<SubTab>('library');
  const canApprove = perms.includes('asset:approve');
  const canPublish = perms.includes('asset:publish');

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'library', label: '资源库' },
    { key: 'levels', label: '资源密级' },
  ];

  return (
    <div className="space-y-4">
      <div className="isl-tabbar">
        {tabs.map((t) => (
          <button key={t.key} type="button" className={`isl-tab px-3 py-1.5 text-xs ${sub === t.key ? 'isl-tab--active' : ''}`} onClick={() => setSub(t.key)}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'library' && <LibraryTab org={org} canApprove={canApprove} canPublish={canPublish} toast={toast} />}
      {sub === 'levels' && <LevelsTab org={org} canManage={canPublish} toast={toast} />}
    </div>
  );
}

function LibraryTab({ org, canApprove, canPublish, toast }: { org: PanelProps['org']; canApprove: boolean; canPublish: boolean; toast: PanelProps['toast'] }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await resourceApi.list(org.id, page, 20, statusFilter || undefined);
      setResources(data?.list || []);
      setTotal(data?.total || 0);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, page, statusFilter, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const review = useCallback(async (r: Resource, action: 'approved' | 'rejected') => {
    try {
      await resourceApi.review(org.id, r.id, action);
      toast.show(action === 'approved' ? '已通过审核' : '已拒绝', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '操作失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const publish = useCallback(async (r: Resource) => {
    try {
      await resourceApi.publish(org.id, r.id);
      toast.show('已发布', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '发布失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; color: string; bg: string }> = {
      pending: { label: '待审核', color: 'var(--isl-ink-soft)', bg: 'var(--isl-surface-sunk)' },
      approved: { label: '已通过', color: 'var(--isl-mint-deep)', bg: 'var(--isl-mint-bg)' },
      rejected: { label: '已拒绝', color: 'var(--isl-coral-deep)', bg: 'rgba(232,97,90,0.10)' },
      published: { label: '已发布', color: 'var(--isl-mint-deep)', bg: 'var(--isl-mint-bg)' },
    };
    return map[s] || { label: s, color: 'var(--isl-ink)', bg: 'var(--isl-surface-sunk)' };
  };

  return (
    <PanelCard>
      <PageHeader title="资源库" subtitle={`共 ${total} 条`} />
      <div className="mb-3 flex items-center gap-2">
        {['', 'pending', 'approved', 'rejected', 'published'].map((s) => (
          <button key={s} type="button" onClick={() => { setPage(1); setStatusFilter(s); }}
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={statusFilter === s
              ? { background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)', border: '1px solid var(--isl-mint)' }
              : { background: 'transparent', color: 'var(--isl-ink-soft)', border: '1px solid var(--isl-border)' }}>
            {s === '' ? '全部' : statusBadge(s).label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : resources.length === 0 ? (
        <EmptyState icon={<Image size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无资源" />
      ) : (
        <ul className="space-y-2">
          {resources.map((r) => {
            const badge = statusBadge(r.status);
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
                {r.thumbnail ? (
                  <img src={r.thumbnail} alt="" className="h-12 w-12 rounded-md object-cover" style={{ border: '1px solid var(--isl-border)' }} />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-md" style={{ background: 'var(--isl-surface)', border: '1px solid var(--isl-border)' }}>
                    <Image size={16} style={{ color: 'var(--isl-ink-ghost)' }} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{r.title || r.href}</div>
                  <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                    {r.type} · {new Date(r.createdAt).toLocaleDateString()}{r.level ? ` · ${r.level.name}` : ''}
                  </div>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                {canApprove && r.status === 'pending' && (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => review(r, 'approved')} className="isl-icon-btn h-7 w-7" title="通过" style={{ color: 'var(--isl-mint-deep)' }}><Check size={13} /></button>
                    <button type="button" onClick={() => review(r, 'rejected')} className="isl-icon-btn h-7 w-7" title="拒绝" style={{ color: 'var(--isl-coral-deep)' }}><X size={13} /></button>
                  </div>
                )}
                {canPublish && r.status === 'approved' && (
                  <button type="button" onClick={() => publish(r)} className="rounded-lg px-2.5 py-1 text-[10px] font-semibold text-white" style={{ background: 'var(--isl-mint-deep)' }}>发布</button>
                )}
              </li>
            );
          })}
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

function LevelsTab({ org, canManage, toast }: { org: PanelProps['org']; canManage: boolean; toast: PanelProps['toast'] }) {
  const [levels, setLevels] = useState<ResourceLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [sort, setSort] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setLevels((await resourceApi.listLevels(org.id)) || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await resourceApi.createLevel(org.id, { name, sort: sort ? parseInt(sort, 10) : undefined });
      toast.show('密级已创建', 'success');
      setName(''); setSort(''); setShowCreate(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, name, sort, fetch, toast]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('确认删除此密级？')) return;
    try {
      await resourceApi.deleteLevel(org.id, id);
      toast.show('已删除', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org.id, fetch, toast]);

  return (
    <PanelCard>
      <PageHeader
        title="资源密级"
        subtitle="按密级分级管理组织资源可见性"
        action={canManage && (
          <button type="button" onClick={() => setShowCreate((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Plus size={14} /><span className="text-xs font-semibold">新建密级</span>
          </button>
        )}
      />
      {showCreate && canManage && (
        <form onSubmit={create} className="mb-4 flex gap-2 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <FormInput value={name} onChange={setName} placeholder="密级名称（如：公开/内部/机密）" autoFocus />
          <input value={sort} onChange={(e) => setSort(e.target.value)} placeholder="排序" type="number"
            className="w-24 rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }} />
          <button type="submit" disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '...' : '创建'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : levels.length === 0 ? (
        <EmptyState icon={<Layers size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="尚未创建密级" />
      ) : (
        <ul className="space-y-1.5">
          {levels.map((lv) => (
            <li key={lv.id} className="flex items-center gap-3 rounded-lg p-2.5" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
              <Layers size={14} style={{ color: 'var(--isl-ink-soft)' }} />
              <span className="flex-1 text-xs font-semibold">{lv.name}</span>
              <span className="text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>排序 {lv.sort}</span>
              {canManage && <button type="button" onClick={() => remove(lv.id)} className="isl-icon-btn h-7 w-7" title="删除"><Trash2 size={12} /></button>}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}
