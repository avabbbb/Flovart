// 审批管理面板 — 审批流/审批记录
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, GitBranch, FileCheck, Check, X, ChevronDown, ChevronRight, Send } from 'lucide-react';
import { approvalApi, type ApprovalWorkflow, type ApprovalRecord, type ApprovalNode, type ApprovalStep } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { FormInput, PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

type SubTab = 'workflows' | 'records';

export default function ApprovalPanel({ org, perms, toast }: PanelProps) {
  const [sub, setSub] = useState<SubTab>('workflows');
  const canManage = perms.includes('asset:approve');

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'workflows', label: '审批流' },
    { key: 'records', label: '审批记录' },
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
      {sub === 'workflows' && <WorkflowTab org={org} canManage={canManage} toast={toast} />}
      {sub === 'records' && <RecordTab org={org} toast={toast} />}
    </div>
  );
}

function WorkflowTab({ org, canManage, toast }: { org: PanelProps['org']; canManage: boolean; toast: PanelProps['toast'] }) {
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState('resource');
  const [nodes, setNodes] = useState<{ nodeType: string; approverType: string; approverIds: string }[]>([{ nodeType: 'sequential', approverType: 'role', approverIds: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailNodes, setDetailNodes] = useState<ApprovalNode[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setWorkflows((await approvalApi.listWorkflows(org.id)) || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const toggleExpand = useCallback(async (wfId: string) => {
    if (expandedId === wfId) { setExpandedId(null); return; }
    setExpandedId(wfId);
    setLoadingDetail(true);
    try {
      const detail = await approvalApi.getWorkflow(org.id, wfId);
      setDetailNodes(detail?.nodes || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载详情失败', 'error');
    } finally {
      setLoadingDetail(false);
    }
  }, [org.id, expandedId, toast]);

  const create = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const processedNodes = nodes.map((n) => ({
        nodeType: n.nodeType,
        approverType: n.approverType,
        approverIds: n.approverIds.split(',').map((s) => s.trim()).filter(Boolean),
      }));
      await approvalApi.createWorkflow(org.id, { name, targetType, nodes: processedNodes });
      toast.show('审批流已创建', 'success');
      setName(''); setNodes([{ nodeType: 'sequential', approverType: 'role', approverIds: '' }]); setShowCreate(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, name, targetType, nodes, fetch, toast]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('确认删除此审批流？')) return;
    try {
      await approvalApi.deleteWorkflow(org.id, id);
      toast.show('已删除', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const updateNode = (idx: number, field: 'nodeType' | 'approverType' | 'approverIds', val: string) => {
    setNodes((ns) => ns.map((n, i) => i === idx ? { ...n, [field]: val } : n));
  };

  const inputStyle = { background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' } as const;

  return (
    <PanelCard>
      <PageHeader
        title="审批流"
        subtitle="配置多节点审批流程"
        action={canManage && (
          <button type="button" onClick={() => setShowCreate((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Plus size={14} /><span className="text-xs font-semibold">新建审批流</span>
          </button>
        )}
      />
      {showCreate && canManage && (
        <form onSubmit={create} className="mb-4 space-y-3 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <FormInput value={name} onChange={setName} placeholder="审批流名称（如：资源发布审批）" autoFocus />
          <select value={targetType} onChange={(e) => setTargetType(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-sm" style={inputStyle}>
            <option value="resource">resource</option>
            <option value="project">project</option>
            <option value="credit_recharge">credit_recharge</option>
          </select>
          <div className="space-y-2">
            <div className="text-[11px] font-bold" style={{ color: 'var(--isl-ink-soft)' }}>审批节点</div>
            {nodes.map((n, idx) => (
              <div key={idx} className="flex gap-2">
                <select value={n.nodeType} onChange={(e) => updateNode(idx, 'nodeType', e.target.value)} className="rounded-lg px-2 py-2 text-xs" style={inputStyle}>
                  <option value="sequential">顺序审批</option>
                  <option value="parallel">并行审批</option>
                  <option value="any">任一审批</option>
                </select>
                <select value={n.approverType} onChange={(e) => updateNode(idx, 'approverType', e.target.value)} className="rounded-lg px-2 py-2 text-xs" style={inputStyle}>
                  <option value="role">按角色</option>
                  <option value="user">按用户</option>
                </select>
                <input value={n.approverIds} onChange={(e) => updateNode(idx, 'approverIds', e.target.value)}
                  placeholder="ID 列表（逗号分隔）"
                  className="min-w-0 flex-1 rounded-lg px-2 py-2 text-xs" style={inputStyle} />
                {nodes.length > 1 && (
                  <button type="button" onClick={() => setNodes((ns) => ns.filter((_, i) => i !== idx))} className="isl-icon-btn h-8 w-8 shrink-0"><Trash2 size={12} /></button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => setNodes((ns) => [...ns, { nodeType: 'sequential', approverType: 'role', approverIds: '' }])}
              className="text-[11px] font-semibold" style={{ color: 'var(--isl-mint-deep)' }}>+ 添加节点</button>
          </div>
          <button type="submit" disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '创建中...' : '创建'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : workflows.length === 0 ? (
        <EmptyState icon={<GitBranch size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="尚未创建审批流" />
      ) : (
        <ul className="space-y-2">
          {workflows.map((wf) => (
            <li key={wf.id} className="rounded-lg" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
              <div className="flex items-center gap-3 p-3">
                <button type="button" onClick={() => toggleExpand(wf.id)} className="isl-icon-btn h-6 w-6 shrink-0">
                  {expandedId === wf.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <GitBranch size={14} style={{ color: wf.enabled ? 'var(--isl-mint-deep)' : 'var(--isl-ink-ghost)' }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold">{wf.name}</div>
                  <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>{wf.targetType} · {wf.enabled ? '启用' : '停用'}</div>
                </div>
                {canManage && <button type="button" onClick={() => remove(wf.id)} className="isl-icon-btn h-7 w-7" title="删除"><Trash2 size={12} /></button>}
              </div>
              {expandedId === wf.id && (
                <div className="border-t px-3 py-2" style={{ borderColor: 'var(--isl-border)' }}>
                  {loadingDetail ? (
                    <div className="flex justify-center py-2"><Loader2 className="animate-spin" size={12} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
                  ) : detailNodes.length === 0 ? (
                    <p className="py-1 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>无节点数据</p>
                  ) : (
                    <ol className="space-y-1">
                      {detailNodes.map((n, i) => (
                        <li key={n.id} className="flex items-center gap-2 text-[10px]">
                          <span className="flex h-4 w-4 items-center justify-center rounded-full font-bold" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>{i + 1}</span>
                          <span className="font-semibold">{n.nodeType === 'sequential' ? '顺序' : n.nodeType === 'parallel' ? '并行' : '任一'}</span>
                          <span style={{ color: 'var(--isl-ink-soft)' }}>{n.approverType === 'role' ? '按角色' : '按用户'}</span>
                          <span className="truncate" style={{ color: 'var(--isl-ink-ghost)' }}>{n.approverIds.join(', ')}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function RecordTab({ org, toast }: { org: PanelProps['org']; toast: PanelProps['toast'] }) {
  const [records, setRecords] = useState<ApprovalRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailSteps, setDetailSteps] = useState<ApprovalStep[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [submitTargetType, setSubmitTargetType] = useState('resource');
  const [submitTargetId, setSubmitTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await approvalApi.listRecords(org.id, page, 20);
      setRecords(data?.list || []);
      setTotal(data?.total || 0);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, page, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const act = useCallback(async (recId: string, action: 'approve' | 'reject') => {
    try {
      await approvalApi.act(org.id, recId, { action });
      toast.show(action === 'approve' ? '已通过' : '已拒绝', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '操作失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const toggleExpand = useCallback(async (recId: string) => {
    if (expandedId === recId) { setExpandedId(null); return; }
    setExpandedId(recId);
    setLoadingDetail(true);
    try {
      const detail = await approvalApi.getRecord(org.id, recId);
      setDetailSteps(detail?.steps || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载详情失败', 'error');
    } finally {
      setLoadingDetail(false);
    }
  }, [org.id, expandedId, toast]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!submitTargetId.trim()) return;
    setSubmitting(true);
    try {
      await approvalApi.submit(org.id, { targetType: submitTargetType, targetId: submitTargetId });
      toast.show('已提交审批', 'success');
      setSubmitTargetId(''); setShowSubmit(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '提交失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, submitTargetType, submitTargetId, fetch, toast]);

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; color: string }> = {
      pending: { label: '审批中', color: 'var(--isl-ink-soft)' },
      approved: { label: '已通过', color: 'var(--isl-mint-deep)' },
      rejected: { label: '已拒绝', color: 'var(--isl-coral-deep)' },
    };
    return map[s] || { label: s, color: 'var(--isl-ink)' };
  };

  const inputStyle = { background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' } as const;

  return (
    <PanelCard>
      <PageHeader
        title="审批记录"
        subtitle={`共 ${total} 条`}
        action={
          <button type="button" onClick={() => setShowSubmit((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Send size={14} /><span className="text-xs font-semibold">提交审批</span>
          </button>
        }
      />
      {showSubmit && (
        <form onSubmit={submit} className="mb-4 flex flex-wrap gap-2 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <select value={submitTargetType} onChange={(e) => setSubmitTargetType(e.target.value)} className="rounded-lg px-3 py-2.5 text-xs" style={inputStyle}>
            <option value="resource">resource</option>
            <option value="project">project</option>
            <option value="credit_recharge">credit_recharge</option>
          </select>
          <FormInput value={submitTargetId} onChange={setSubmitTargetId} placeholder="目标 ID" autoFocus />
          <button type="submit" disabled={submitting || !submitTargetId.trim()}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '提交中...' : '提交'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : records.length === 0 ? (
        <EmptyState icon={<FileCheck size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无审批记录" />
      ) : (
        <ul className="space-y-2">
          {records.map((r) => {
            const badge = statusBadge(r.status);
            return (
              <li key={r.id} className="rounded-lg" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
                <div className="flex items-center gap-3 p-3">
                  <button type="button" onClick={() => toggleExpand(r.id)} className="isl-icon-btn h-6 w-6 shrink-0">
                    {expandedId === r.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <FileCheck size={14} style={{ color: 'var(--isl-ink-soft)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">{r.targetType} · {r.targetId}</div>
                    <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                      节点 {r.currentNodeIndex} · {new Date(r.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: badge.color }}>{badge.label}</span>
                  {r.status === 'pending' && (
                    <div className="flex gap-1">
                      <button type="button" onClick={() => act(r.id, 'approve')} className="isl-icon-btn h-7 w-7" title="通过" style={{ color: 'var(--isl-mint-deep)' }}><Check size={13} /></button>
                      <button type="button" onClick={() => act(r.id, 'reject')} className="isl-icon-btn h-7 w-7" title="拒绝" style={{ color: 'var(--isl-coral-deep)' }}><X size={13} /></button>
                    </div>
                  )}
                </div>
                {expandedId === r.id && (
                  <div className="border-t px-3 py-2" style={{ borderColor: 'var(--isl-border)' }}>
                    {loadingDetail ? (
                      <div className="flex justify-center py-2"><Loader2 className="animate-spin" size={12} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
                    ) : detailSteps.length === 0 ? (
                      <p className="py-1 text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>尚无审批步骤</p>
                    ) : (
                      <ol className="space-y-1">
                        {detailSteps.map((s, i) => (
                          <li key={s.id} className="flex items-center gap-2 text-[10px]">
                            <span className="flex h-4 w-4 items-center justify-center rounded-full font-bold" style={{ background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)' }}>{i + 1}</span>
                            <span className="font-semibold" style={{ color: s.action === 'approve' ? 'var(--isl-mint-deep)' : s.action === 'reject' ? 'var(--isl-coral-deep)' : 'var(--isl-ink-soft)' }}>
                              {s.action === 'approve' ? '通过' : s.action === 'reject' ? '拒绝' : s.action}
                            </span>
                            <span style={{ color: 'var(--isl-ink-ghost)' }}>{s.approverId}</span>
                            {s.note && <span className="truncate" style={{ color: 'var(--isl-ink-soft)' }}>· {s.note}</span>}
                            <span className="ml-auto" style={{ color: 'var(--isl-ink-ghost)' }}>{s.actedAt ? new Date(s.actedAt).toLocaleString() : ''}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
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
