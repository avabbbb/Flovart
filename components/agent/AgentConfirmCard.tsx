import { ShieldCheck } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { WorkflowNode } from '../workflow/types';
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';
import { translations } from '../../utils/translations';
import { GenerationPlanCard } from '../GenerationPlanCard';
import { AgentCardButton, AgentCardFoot, AgentCardHead } from './AgentCardShell';
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
  /** 排在后面、尚未展示的确认数（并行工具调用）。 */
  queued?: number;
}

/**
 * Agent 请求确认（工具审批）。外壳同计划 / 提问卡（Inspora 1-37「AI Agent Approval Cards」@Kevin，登记见 docs/design/references.md）：
 * 一句话说清要做什么，计划明细、费用拆分与授权上限收进「详情」。
 * 卡片出现时拿焦点：Esc 即拒绝；不自动聚焦「本次允许」——回车只在主按钮自身有焦点时批准，输入框里误按的回车不会批准。
 * 不做原作的「N 秒后自动批准」倒计时。
 */
export function AgentConfirmCard({
  summary, request, offerMandate, blocked, nodes, language, planMandateNote, mandateTasks, onMandateTasksChange, onDecide, queued = 0,
}: AgentConfirmCardProps) {
  const t = translations[language].agentConfirm;
  const copy = describeAgentConfirmation(request, nodes, language, summary);
  const scopes = confirmScopesFor(request, { offerMandate });
  const root = useRef<HTMLElement>(null);
  const gates = request?.gates || [];
  const canGrantSession = scopes.includes('session');
  // 付费授权（Spend Mandate）是有上限的会话授权；普通工具是「本会话总是允许此工具」（同一工具、同一 tier）。
  const sessionLabel = offerMandate ? t.sessionMandate : t.sessionTool;

  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  return (
    <section
      ref={root}
      className="flv-card agent-confirm agent-card-on-shell"
      role="alertdialog"
      aria-label={t.aria}
      tabIndex={-1}
      data-testid="agent-confirm"
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        onDecide(false, 'once');
      }}
    >
      <AgentCardHead
        icon={<ShieldCheck />}
        accent={blocked ? 'blocked' : 'approve'}
        label={t.label}
        aside={queued > 0 ? <span className="agent-confirm__queue flv-machine">{t.queued(queued)}</span> : undefined}
      />
      <p className="flv-card__heading agent-confirm__title">{copy.title}</p>
      {copy.detail && <p className="flv-card__summary agent-confirm__detail">{copy.detail}</p>}
      {request?.reason && !copy.detail && <p className="flv-card__summary agent-confirm__detail">{request.reason}</p>}
      {blocked && <p className="agent-confirm__blocked">{t.blocked}</p>}
      {gates.length > 0 && (
        <details className="agent-confirm__more" open={blocked || undefined}>
          <summary>{t.details}</summary>
          <GenerationPlanCard plan={{ items: [...gates], mandate: planMandateNote }} />
        </details>
      )}
      {canGrantSession && offerMandate && (
        <label className="agent-confirm__cap">
          {t.capBefore}
          <input
            type="number"
            min={1}
            value={mandateTasks}
            onChange={event => onMandateTasksChange(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            aria-label={t.capAria}
          />
          {t.capAfter}
        </label>
      )}
      <AgentCardFoot>
        <AgentCardButton className="agent-confirm__deny" onClick={() => onDecide(false, 'once')}>{t.deny}</AgentCardButton>
        {canGrantSession && <AgentCardButton className="agent-confirm__allow--session" disabled={blocked} onClick={() => onDecide(true, 'session' satisfies AgentConfirmScope)}>{sessionLabel}</AgentCardButton>}
        <AgentCardButton variant="primary" enterHint className="agent-confirm__allow" disabled={blocked} onClick={() => onDecide(true, 'once')}>{t.allowOnce}</AgentCardButton>
      </AgentCardFoot>
    </section>
  );
}
