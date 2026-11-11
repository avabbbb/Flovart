import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowNode } from '../workflow/types';
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';
import { GenerationPlanCard } from '../GenerationPlanCard';
import { confirmScopesFor, describeAgentConfirmation, type AgentConfirmScope } from './agentConfirmCopy';

interface AgentConfirmCardProps {
  summary: string;
  request?: AgentConfirmRequest;
  offerMandate?: boolean;
  blocked?: boolean;
  nodes: readonly WorkflowNode[];
  language: 'en' | 'zho';
  /** 生成计划里关于授权上限的说明（超出上限时为什么又来问）。 */
  planMandateNote?: string;
  mandateTasks: number;
  onMandateTasksChange: (value: number) => void;
  onDecide: (approved: boolean, scope: AgentConfirmScope) => void;
}

/**
 * Agent 请求确认：一句话说清要做什么，一个主按钮。
 * 计划明细、费用拆分与授权上限都收进「详情」，窄侧栏里也不会挤成一团。
 */
export function AgentConfirmCard({
  summary, request, offerMandate, blocked, nodes, language, planMandateNote, mandateTasks, onMandateTasksChange, onDecide,
}: AgentConfirmCardProps) {
  const L = (zho: string, en: string) => (language === 'en' ? en : zho);
  const copy = describeAgentConfirmation(request, nodes, language, summary);
  const scopes = confirmScopesFor(request, { offerMandate });
  const [scope, setScope] = useState<AgentConfirmScope>('once');
  const root = useRef<HTMLElement>(null);
  const gates = request?.gates || [];
  const scopeLabel: Record<AgentConfirmScope, string> = {
    once: L('仅这次', 'Just this once'),
    session: L('本次对话', 'For this chat'),
    always: L('始终允许此类操作', 'Always allow this'),
  };

  // 卡片出现时拿到焦点：Esc 即拒绝；不自动聚焦「允许」，避免误按回车批准。
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  return (
    <section
      ref={root}
      className="agent-confirm"
      role="alertdialog"
      aria-label={L('Agent 请求确认', 'Agent needs approval')}
      tabIndex={-1}
      data-testid="agent-confirm"
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onDecide(false, 'once');
      }}
    >
      <div className="agent-confirm__eyebrow"><ShieldCheck size={13} aria-hidden="true" />{L('需要你确认', 'Needs your approval')}</div>
      <p className="agent-confirm__title">{copy.title}</p>
      {copy.detail && <p className="agent-confirm__detail">{copy.detail}</p>}
      {blocked && <p className="agent-confirm__blocked">{L('计划里有无法运行的项，展开详情查看原因。', 'Something in this plan cannot run. See details.')}</p>}
      {gates.length > 0 && (
        <details className="agent-confirm__more" open={blocked || undefined}>
          <summary>{L('详情', 'Details')}</summary>
          <GenerationPlanCard plan={{ items: [...gates], mandate: planMandateNote }} />
        </details>
      )}
      {scope === 'session' && offerMandate && (
        <label className="agent-confirm__cap">
          {L('本次对话最多自动运行', 'Auto-run up to')}
          <input
            type="number"
            min={1}
            value={mandateTasks}
            onChange={event => onMandateTasksChange(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            aria-label={L('自动运行任务上限', 'Auto-run task limit')}
          />
          {L('个任务，超出会再问；删除始终单独确认。', 'tasks in this chat. Deletes always ask.')}
        </label>
      )}
      <div className="agent-confirm__actions">
        {scopes.length > 1 ? (
          <select value={scope} onChange={event => setScope(event.target.value as AgentConfirmScope)} aria-label={L('授权范围', 'Approval scope')}>
            {scopes.map(item => <option key={item} value={item}>{scopeLabel[item]}</option>)}
          </select>
        ) : <span />}
        <button type="button" className="agent-confirm__deny" onClick={() => onDecide(false, 'once')}>{L('拒绝', 'Deny')}</button>
        <button type="button" className="agent-confirm__allow" disabled={blocked} onClick={() => onDecide(true, scope)}>{L('允许', 'Allow')}</button>
      </div>
    </section>
  );
}
