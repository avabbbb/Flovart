// 积分管理面板 — 余额/流水/充值/用量
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, Wallet, TrendingUp, Receipt } from 'lucide-react';
import { creditApi, type OrgCredit, type CreditTransaction, type RechargeRequest, type UsageRecord } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { FormInput, PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

type SubTab = 'balance' | 'recharges' | 'usage';

export default function CreditPanel({ org, perms, toast }: PanelProps) {
  const [sub, setSub] = useState<SubTab>('balance');
  const canGrant = perms.includes('credit:grant');
  const canAdjust = perms.includes('credit:adjust');

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'balance', label: '余额与流水' },
    { key: 'recharges', label: '充值申请' },
    { key: 'usage', label: '用量记录' },
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
      {sub === 'balance' && <BalanceTab org={org} canAdjust={canAdjust} toast={toast} />}
      {sub === 'recharges' && <RechargeTab org={org} canGrant={canGrant} toast={toast} />}
      {sub === 'usage' && <UsageTab org={org} toast={toast} />}
    </div>
  );
}

function BalanceTab({ org, canAdjust, toast }: { org: PanelProps['org']; canAdjust: boolean; toast: PanelProps['toast'] }) {
  const [credit, setCredit] = useState<OrgCredit | null>(null);
  const [txs, setTxs] = useState<CreditTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, txData] = await Promise.all([
        creditApi.balance(org.id),
        creditApi.transactions(org.id, page, 20),
      ]);
      setCredit(bal);
      setTxs(txData?.list || []);
      setTotal(txData?.total || 0);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, page, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" size={18} style={{ color: 'var(--isl-ink-ghost)' }} /></div>;

  return (
    <div className="space-y-4">
      {credit && (
        <div className="grid gap-3 sm:grid-cols-3">
          <PanelCard>
            <div className="flex items-center gap-2">
              <Wallet size={16} style={{ color: 'var(--isl-mint-deep)' }} />
              <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--isl-ink-soft)' }}>当前余额</span>
            </div>
            <p className="mt-2 text-2xl font-black">{credit.balance.toLocaleString()}</p>
          </PanelCard>
          <PanelCard>
            <div className="flex items-center gap-2">
              <TrendingUp size={16} style={{ color: 'var(--isl-mint-deep)' }} />
              <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--isl-ink-soft)' }}>累计充值</span>
            </div>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--isl-mint-deep)' }}>+{credit.totalIn.toLocaleString()}</p>
          </PanelCard>
          <PanelCard>
            <div className="flex items-center gap-2">
              <Receipt size={16} style={{ color: 'var(--isl-coral-deep)' }} />
              <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--isl-ink-soft)' }}>累计消耗</span>
            </div>
            <p className="mt-2 text-2xl font-black" style={{ color: 'var(--isl-coral-deep)' }}>-{credit.totalOut.toLocaleString()}</p>
          </PanelCard>
        </div>
      )}

      <PanelCard>
        <PageHeader title="流水记录" subtitle={`共 ${total} 条`} />
        {txs.length === 0 ? (
          <EmptyState icon={<Receipt size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无流水" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--isl-ink-soft)', borderBottom: '1px solid var(--isl-border)' }}>
                  <th className="py-2 pr-3 font-bold">时间</th>
                  <th className="py-2 pr-3 font-bold">类型</th>
                  <th className="py-2 pr-3 font-bold">变动</th>
                  <th className="py-2 pr-3 font-bold">余额</th>
                  <th className="py-2 pr-3 font-bold">原因</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((tx) => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--isl-border)' }}>
                    <td className="py-2 pr-3 whitespace-nowrap" style={{ color: 'var(--isl-ink-ghost)' }}>{new Date(tx.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-semibold">{tx.kind}</td>
                    <td className="py-2 pr-3 font-bold" style={{ color: tx.amount >= 0 ? 'var(--isl-mint-deep)' : 'var(--isl-coral-deep)' }}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount}
                    </td>
                    <td className="py-2 pr-3">{tx.balanceAfter}</td>
                    <td className="py-2 pr-3 truncate" style={{ color: 'var(--isl-ink-ghost)' }}>{tx.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 20 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="isl-icon-btn h-7 px-3 text-[11px] disabled:opacity-40">上一页</button>
            <span className="text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>{page} / {Math.ceil(total / 20)}</span>
            <button type="button" disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)} className="isl-icon-btn h-7 px-3 text-[11px] disabled:opacity-40">下一页</button>
          </div>
        )}
      </PanelCard>
    </div>
  );
}

function RechargeTab({ org, canGrant, toast }: { org: PanelProps['org']; canGrant: boolean; toast: PanelProps['toast'] }) {
  const [recharges, setRecharges] = useState<RechargeRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await creditApi.listRecharges(org.id, page, 20);
      setRecharges(data?.list || []);
      setTotal(data?.total || 0);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, page, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await creditApi.createRecharge(org.id, { amount: parseInt(amount, 10), note: note || undefined });
      toast.show('充值申请已提交', 'success');
      setAmount(''); setNote(''); setShowCreate(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '创建失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, amount, note, fetch, toast]);

  const cancel = useCallback(async (id: string) => {
    if (!confirm('确认取消此充值申请？')) return;
    try {
      await creditApi.cancelRecharge(org.id, id);
      toast.show('已取消', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '取消失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const statusLabel = (s: string) => {
    const map: Record<string, { label: string; color: string }> = {
      pending: { label: '待审核', color: 'var(--isl-ink-soft)' },
      approved: { label: '已通过', color: 'var(--isl-mint-deep)' },
      rejected: { label: '已拒绝', color: 'var(--isl-coral-deep)' },
      cancelled: { label: '已取消', color: 'var(--isl-ink-ghost)' },
    };
    return map[s] || { label: s, color: 'var(--isl-ink)' };
  };

  return (
    <PanelCard>
      <PageHeader
        title="充值申请"
        subtitle={`共 ${total} 条`}
        action={canGrant && (
          <button type="button" onClick={() => setShowCreate((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Plus size={14} /><span className="text-xs font-semibold">申请充值</span>
          </button>
        )}
      />
      {showCreate && canGrant && (
        <form onSubmit={create} className="mb-4 space-y-2 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <FormInput value={amount} onChange={setAmount} placeholder="充值金额（积分数量）" type="number" autoFocus />
          <FormInput value={note} onChange={setNote} placeholder="备注（可选）" />
          <button type="submit" disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '提交中...' : '提交申请'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : recharges.length === 0 ? (
        <EmptyState icon={<Wallet size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无充值申请" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: 'var(--isl-ink-soft)', borderBottom: '1px solid var(--isl-border)' }}>
                <th className="py-2 pr-3 font-bold">时间</th>
                <th className="py-2 pr-3 font-bold">金额</th>
                <th className="py-2 pr-3 font-bold">状态</th>
                <th className="py-2 pr-3 font-bold">备注</th>
                <th className="py-2 pr-3 font-bold" />
              </tr>
            </thead>
            <tbody>
              {recharges.map((r) => {
                const st = statusLabel(r.status);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--isl-border)' }}>
                    <td className="py-2 pr-3 whitespace-nowrap" style={{ color: 'var(--isl-ink-ghost)' }}>{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="py-2 pr-3 font-bold">{r.amount.toLocaleString()}</td>
                    <td className="py-2 pr-3"><span className="font-semibold" style={{ color: st.color }}>{st.label}</span></td>
                    <td className="py-2 pr-3 truncate" style={{ color: 'var(--isl-ink-ghost)' }}>{r.note || '—'}</td>
                    <td className="py-2 pr-3">
                      {r.status === 'pending' && canGrant && (
                        <button type="button" onClick={() => cancel(r.id)} className="isl-icon-btn h-7 w-7" title="取消"><Trash2 size={12} /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

function UsageTab({ org, toast }: { org: PanelProps['org']; toast: PanelProps['toast'] }) {
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await creditApi.listUsage(org.id, page, 20);
      setRecords(data?.list || []);
      setTotal(data?.total || 0);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, page, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  return (
    <PanelCard>
      <PageHeader title="用量记录" subtitle={`共 ${total} 条`} />
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : records.length === 0 ? (
        <EmptyState icon={<Receipt size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无用量的记录" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: 'var(--isl-ink-soft)', borderBottom: '1px solid var(--isl-border)' }}>
                <th className="py-2 pr-3 font-bold">时间</th>
                <th className="py-2 pr-3 font-bold">模型</th>
                <th className="py-2 pr-3 font-bold">消耗</th>
                <th className="py-2 pr-3 font-bold">耗时</th>
                <th className="py-2 pr-3 font-bold">状态</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--isl-border)' }}>
                  <td className="py-2 pr-3 whitespace-nowrap" style={{ color: 'var(--isl-ink-ghost)' }}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="py-2 pr-3 font-mono">{r.model || r.provider || '—'}</td>
                  <td className="py-2 pr-3 font-bold" style={{ color: 'var(--isl-coral-deep)' }}>{r.costCredits}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--isl-ink-ghost)' }}>{r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="py-2 pr-3"><span className="font-semibold" style={{ color: r.status === 'success' ? 'var(--isl-mint-deep)' : 'var(--isl-coral-deep)' }}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
