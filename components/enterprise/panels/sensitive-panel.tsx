// 敏感词管理面板
import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, Trash2, ShieldAlert, Search } from 'lucide-react';
import { sensitiveApi, type SensitiveWord } from '../../../services/enterpriseApi';
import { ApiError } from '../../../services/hubClient';
import { FormInput, PanelCard, EmptyState, PageHeader, type PanelProps } from '../shared';

export default function SensitivePanel({ org, perms, toast }: PanelProps) {
  const canManage = perms.includes('org:manage');
  const [words, setWords] = useState<SensitiveWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [word, setWord] = useState('');
  const [category, setCategory] = useState('general');
  const [action, setAction] = useState('block');
  const [submitting, setSubmitting] = useState(false);
  const [checkText, setCheckText] = useState('');
  const [checkResult, setCheckResult] = useState<{ blocked: string[]; warned: string[]; hasBlock: boolean } | null>(null);
  const [checking, setChecking] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      setWords((await sensitiveApi.list(org.id)) || []);
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
      await sensitiveApi.create(org.id, { word, category: category || undefined, action: action || undefined });
      toast.show('敏感词已添加', 'success');
      setWord(''); setShowCreate(false);
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '添加失败', 'error');
    } finally {
      setSubmitting(false);
    }
  }, [org.id, word, category, action, fetch, toast]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('确认删除此敏感词？')) return;
    try {
      await sensitiveApi.delete(org.id, id);
      toast.show('已删除', 'success');
      await fetch();
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '删除失败', 'error');
    }
  }, [org.id, fetch, toast]);

  const check = useCallback(async () => {
    if (!checkText.trim()) return;
    setChecking(true);
    try {
      const result = await sensitiveApi.check(org.id, checkText);
      setCheckResult(result);
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : '检测失败', 'error');
    } finally {
      setChecking(false);
    }
  }, [org.id, checkText, toast]);

  const inputStyle = { background: 'var(--isl-surface-sunk)', border: '1.5px solid var(--isl-border)', color: 'var(--isl-ink)' } as const;

  return (
    <div className="space-y-4">
      <PanelCard>
        <PageHeader
          title="敏感词库"
          subtitle={`共 ${words.length} 条`}
          action={canManage && (
            <button type="button" onClick={() => setShowCreate((v) => !v)}
              className="isl-icon-btn flex h-8 items-center gap-1.5 px-3"
              style={{ background: 'var(--isl-mint-bg)', border: '1.5px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
              <Plus size={14} /><span className="text-xs font-semibold">添加</span>
            </button>
          )}
        />
        {showCreate && canManage && (
          <form onSubmit={create} className="mb-4 flex flex-wrap gap-2 rounded-lg p-3" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)' }}>
            <FormInput value={word} onChange={setWord} placeholder="敏感词" autoFocus />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg px-3 py-2.5 text-xs" style={inputStyle}>
              <option value="general">general</option>
              <option value="politics">politics</option>
              <option value="violence">violence</option>
              <option value="adult">adult</option>
              <option value="spam">spam</option>
            </select>
            <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-lg px-3 py-2.5 text-xs" style={inputStyle}>
              <option value="block">block（阻断）</option>
              <option value="warn">warn（警告）</option>
              <option value="review">review（人工审核）</option>
            </select>
            <button type="submit" disabled={submitting}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--isl-mint-deep)' }}>
              {submitting ? '...' : '添加'}
            </button>
          </form>
        )}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin" size={16} style={{ color: 'var(--isl-ink-ghost)' }} /></div>
        ) : words.length === 0 ? (
          <EmptyState icon={<ShieldAlert size={24} style={{ color: 'var(--isl-ink-ghost)' }} />} text="尚未添加敏感词" />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {words.map((w) => (
              <span key={w.id} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]"
                style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)', color: 'var(--isl-ink)' }}>
                <span className="font-semibold">{w.word}</span>
                <span className="text-[9px]" style={{ color: w.action === 'block' ? 'var(--isl-coral-deep)' : 'var(--isl-ink-ghost)' }}>{w.action}</span>
                {canManage && <button type="button" onClick={() => remove(w.id)} className="ml-0.5" title="删除"><Trash2 size={10} style={{ color: 'var(--isl-ink-ghost)' }} /></button>}
              </span>
            ))}
          </div>
        )}
      </PanelCard>

      <PanelCard>
        <PageHeader title="文本检测" subtitle="输入文本测试敏感词命中" />
        <div className="flex gap-2">
          <textarea
            value={checkText}
            onChange={(e) => setCheckText(e.target.value)}
            placeholder="输入要检测的文本..."
            rows={3}
            className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-sm"
            style={inputStyle}
          />
          <button type="button" onClick={check} disabled={checking || !checkText.trim()}
            className="self-start rounded-lg px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
            style={{ background: 'var(--isl-mint-deep)' }}>
            {checking ? <Loader2 className="animate-spin" size={14} /> : <Search size={14} />}
          </button>
        </div>
        {checkResult && (
          <div className="mt-3 space-y-2">
            {checkResult.hasBlock ? (
              <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(232,97,90,0.10)', border: '1px solid var(--isl-coral)', color: 'var(--isl-coral-deep)' }}>
                文本包含阻断词：{checkResult.blocked.join(', ')}
              </div>
            ) : (
              <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--isl-mint-bg)', border: '1px solid var(--isl-mint)', color: 'var(--isl-mint-deep)' }}>
                未命中阻断词
              </div>
            )}
            {checkResult.warned.length > 0 && (
              <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--isl-surface-sunk)', border: '1px solid var(--isl-border)', color: 'var(--isl-ink-soft)' }}>
                警告词：{checkResult.warned.join(', ')}
              </div>
            )}
          </div>
        )}
      </PanelCard>
    </div>
  );
}
