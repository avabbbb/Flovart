// API 配置面板 — Key 池/模型定价/成员额度
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, Key, Tag, Gauge, Check } from 'lucide-react';
import { apiKeyApi, type OrgApiKey, type ModelPricing, type MemberQuota } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { FormInput, PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

type SubTab = 'keys' | 'pricing' | 'quotas';

export default function ApiKeyPanel({ org, perms, toast }: PanelProps) {
  const [sub, setSub] = useState<SubTab>('keys');
  const canManageKeys = perms.includes('apikey:manage');
  const canManagePricing = perms.includes('pricing:manage');
  const canManageQuota = perms.includes('quota:manage');

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'keys', label: 'API Key 池' },
    { key: 'pricing', label: '模型定价' },
    ...(canManageQuota ? [{ key: 'quotas' as SubTab, label: '成员额度' }] : []),
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
      {sub === 'keys' && <KeyTab org={org} canManage={canManageKeys} toast={toast} />}
      {sub === 'pricing' && <PricingTab org={org} canManage={canManagePricing} toast={toast} />}
      {sub === 'quotas' && <QuotaTab org={org} canManage={canManageQuota} toast={toast} />}
    </div>
  );
}

function KeyTab({ org, canManage, toast }: { org: PanelProps['org']; canManage: boolean; toast: PanelProps['toast'] }) {
  const [keys, setKeys] = useState<OrgApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [label, setLabel] = useState('');
  const [provider, setProvider] = useState('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setKeys((await apiKeyApi.list(org.id)) || []);
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
      await apiKeyApi.create(org.id, { label, provider, baseUrl: baseUrl || undefined, apiKey });
      toast.show('API Key 已添加', 'success');
      setLabel(''); setProvider('openai'); setBaseUrl(''); setApiKey(''); setShowCreate(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '添加失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, label, provider, baseUrl, apiKey, fetch, toast]);

  const toggle = useCallback(async (k: OrgApiKey) => {
    try {
      await apiKeyApi.toggle(org.id, k.id, !k.enabled);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '操作失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('确认删除此 API Key？')) return;
    try {
      await apiKeyApi.delete(org.id, id);
      toast.show('已删除', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org.id, fetch, toast]);

  return (
    <PanelCard>
      <PageHeader
        title="API Key 池"
        subtitle="组织统一管理的 AI 服务密钥，成员通过代理调用"
        action={canManage && (
          <button type="button" onClick={() => setShowCreate((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Plus size={14} /><span className="text-xs font-semibold">添加 Key</span>
          </button>
        )}
      />
      {showCreate && canManage && (
        <form onSubmit={create} className="mb-4 grid gap-2 rounded-lg p-3 sm:grid-cols-2" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <FormInput value={label} onChange={setLabel} placeholder="标签（如：生产环境-OpenAI）" autoFocus />
          <select value={provider} onChange={(e) => setProvider(e.target.value)}
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="google">google</option>
            <option value="stability">stability</option>
            <option value="other">other</option>
          </select>
          <FormInput value={baseUrl} onChange={setBaseUrl} placeholder="Base URL（可选，留空用默认）" />
          <FormInput value={apiKey} onChange={setApiKey} placeholder="API Key（明文，存储后不可查看）" type="password" />
          <button type="submit" disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60 sm:col-span-2"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '添加中...' : '添加'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : keys.length === 0 ? (
        <EmptyState icon={<Key size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="尚未添加 API Key" />
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
              <Key size={14} style={{ color: k.enabled ? 'var(--isl-mint-deep)' : 'var(--isl-ink-ghost)' }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold">{k.label}</div>
                <div className="truncate text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                  {k.provider} · {k.keyHint ? `***${k.keyHint}` : '***'}{k.baseUrl ? ` · ${k.baseUrl}` : ''}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => toggle(k)}
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={k.enabled
                      ? { background: 'var(--isl-mint-bg)', color: 'var(--isl-mint-deep)', border: '1px solid var(--isl-mint)' }
                      : { background: 'transparent', color: 'var(--isl-ink-ghost)', border: '1px solid var(--isl-border)' }}>
                    {k.enabled ? '启用' : '停用'}
                  </button>
                  <button type="button" onClick={() => remove(k.id)} className="isl-icon-btn h-7 w-7" title="删除"><Trash2 size={12} /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function PricingTab({ org, canManage, toast }: { org: PanelProps['org']; canManage: boolean; toast: PanelProps['toast'] }) {
  const [pricing, setPricing] = useState<ModelPricing[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('chat');
  const [cost, setCost] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setPricing((await apiKeyApi.listPricing(org.id)) || []);
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
      await apiKeyApi.createPricing(org.id, { provider, model, mode, costCredits: parseInt(cost, 10) });
      toast.show('定价规则已添加', 'success');
      setModel(''); setCost(''); setShowCreate(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '添加失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, provider, model, mode, cost, fetch, toast]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('确认删除此定价规则？')) return;
    try {
      await apiKeyApi.deletePricing(org.id, id);
      toast.show('已删除', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org.id, fetch, toast]);

  return (
    <PanelCard>
      <PageHeader
        title="模型定价"
        subtitle="按模型+模式配置每次调用的积分消耗"
        action={canManage && (
          <button type="button" onClick={() => setShowCreate((v) => !v)}
            className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
            style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
            <Plus size={14} /><span className="text-xs font-semibold">添加定价</span>
          </button>
        )}
      />
      {showCreate && canManage && (
        <form onSubmit={create} className="mb-4 grid gap-2 rounded-lg p-3 sm:grid-cols-2" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}>
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
            <option value="google">google</option>
            <option value="stability">stability</option>
            <option value="other">other</option>
          </select>
          <select value={mode} onChange={(e) => setMode(e.target.value)}
            className="rounded-lg px-3 py-2.5 text-sm"
            style={{ background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' }}>
            <option value="chat">chat</option>
            <option value="image">image</option>
            <option value="video">video</option>
            <option value="embed">embed</option>
          </select>
          <FormInput value={model} onChange={setModel} placeholder="模型名（如 gpt-4o）" autoFocus />
          <FormInput value={cost} onChange={setCost} placeholder="消耗积分" type="number" />
          <button type="submit" disabled={submitting}
            className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60 sm:col-span-2"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {submitting ? '添加中...' : '添加'}
          </button>
        </form>
      )}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : pricing.length === 0 ? (
        <EmptyState icon={<Tag size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="尚未配置定价规则" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left" style={{ color: 'var(--isl-ink-soft)', borderBottom: '1px solid var(--isl-border)' }}>
                <th className="py-2 pr-3 font-bold">服务商</th>
                <th className="py-2 pr-3 font-bold">模型</th>
                <th className="py-2 pr-3 font-bold">模式</th>
                <th className="py-2 pr-3 font-bold">消耗</th>
                <th className="py-2 pr-3 font-bold" />
              </tr>
            </thead>
            <tbody>
              {pricing.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--isl-border)' }}>
                  <td className="py-2 pr-3 font-mono">{p.provider}</td>
                  <td className="py-2 pr-3 font-semibold">{p.model}</td>
                  <td className="py-2 pr-3" style={{ color: 'var(--isl-ink-soft)' }}>{p.mode}</td>
                  <td className="py-2 pr-3 font-bold" style={{ color: 'var(--isl-coral-deep)' }}>{p.costCredits}</td>
                  <td className="py-2 pr-3">{canManage && <button type="button" onClick={() => remove(p.id)} className="isl-icon-btn h-7 w-7" title="删除"><Trash2 size={12} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelCard>
  );
}

function QuotaTab({ org, canManage, toast }: { org: PanelProps['org']; canManage: boolean; toast: PanelProps['toast'] }) {
  const [quotas, setQuotas] = useState<MemberQuota[]>([]);
  const [loading, setLoading] = useState(true);
  const [editLimit, setEditLimit] = useState<Record<string, string>>({});

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setQuotas((await apiKeyApi.listQuotas(org.id)) || []);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [org.id, toast]);

  useEffect(() => { fetch(); }, [fetch]);

  const save = useCallback(async (q: MemberQuota) => {
    const val = parseInt(editLimit[q.id] ?? String(q.monthlyLimit), 10);
    if (isNaN(val) || val < 0) { toast.show('请输入有效数字', 'error'); return; }
    try {
      await apiKeyApi.updateQuota(org.id, { userId: q.userId, monthlyLimit: val });
      toast.show('额度已更新', 'success');
      setEditLimit((d) => { const n = { ...d }; delete n[q.id]; return n; });
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '更新失败', 'error');
    }
  }, [org.id, editLimit, fetch, toast]);

  return (
    <PanelCard>
      <PageHeader title="成员额度" subtitle="按成员配置每月积分使用上限" />
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
      ) : quotas.length === 0 ? (
        <EmptyState icon={<Gauge size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="暂无成员额度记录" />
      ) : (
        <ul className="space-y-2">
          {quotas.map((q) => {
            const editing = editLimit[q.id] !== undefined;
            const pct = q.monthlyLimit > 0 ? Math.min(100, (q.usedThisMonth / q.monthlyLimit) * 100) : 0;
            return (
              <li key={q.id} className="rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
                <div className="flex items-center gap-3">
                  <Gauge size={14} style={{ color: 'var(--isl-ink-soft)' }} />
                  <span className="flex-1 truncate text-xs font-semibold">{q.userId}</span>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={editing ? editLimit[q.id] : String(q.monthlyLimit)}
                        onChange={(e) => setEditLimit((d) => ({ ...d, [q.id]: e.target.value }))}
                        disabled={!canManage}
                        className="w-24 rounded-lg px-2 py-1 text-xs"
                        style={{ background: 'var(--isl-surface)', border: '1px solid var(--isl-border)', color: 'var(--isl-ink)' }}
                      />
                      <button type="button" onClick={() => save(q)} className="isl-icon-btn h-7 w-7" title="保存"><Check size={12} /></button>
                    </div>
                  )}
                </div>
                <div className="mt-2">
                  <div className="mb-1 flex justify-between text-[10px]" style={{ color: 'var(--isl-ink-ghost)' }}>
                    <span>本月已用 {q.usedThisMonth} / {q.monthlyLimit}</span>
                    <span>{pct.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--isl-border)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--isl-coral)' : 'var(--isl-mint)' }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}
