import { ChevronRight, Layers, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkflowNode } from '../workflow/types';
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';
import { GenerationPlanCard } from '../GenerationPlanCard';
import { translations } from '../../utils/translations';
import { describeAgentConfirmation } from './agentConfirmCopy';
import { buildRunPlanView, type RunPlanDecision, type RunPlanView } from './agentRunPlan';

interface AgentRunPlanCardProps {
  request: AgentConfirmRequest;
  nodes: readonly WorkflowNode[];
  language: 'en' | 'zho';
  /** 已做的选择；未决定时显示三个按钮。 */
  decision?: RunPlanDecision;
  decidedAt?: number;
  blocked?: boolean;
  /** 可开启本会话付费授权（Spend Mandate）：勾选后「创建并自动生成」同时开启上限内自动运行。 */
  offerMandate?: boolean;
  planMandateNote?: string;
  mandateTasks?: number;
  onMandateTasksChange?: (value: number) => void;
  onDecide?: (decision: RunPlanDecision, options: { session: boolean }) => void;
  onFocusNode?: (nodeId: string) => void;
}

function statusText(view: RunPlanView, copy: typeof translations['zho']['agentPanel']) {
  switch (view.phase) {
    case 'running': return copy.planStatusRunning(view.done, view.total);
    case 'done': return copy.planStatusDone;
    case 'failed': return copy.planStatusFailed(view.failed);
    case 'manual': return copy.planStatusManual;
    case 'adjust': return copy.planStatusAdjust;
    default: return copy.planStatusPending;
  }
}

/**
 * 生成计划卡（参考 RunningHub）：本批模型 → 标题 + 状态 → 资产列表（展开为现有计划明细）→ 编组 → 画布工作流节点 chips
 * → 三个选择 → 一行说明。审批仍走同一个确认请求，只是把「允许 / 拒绝」换成三个更具体的选择。
 */
export function AgentRunPlanCard({
  request, nodes, language, decision, decidedAt, blocked, offerMandate, planMandateNote, mandateTasks = 10, onMandateTasksChange, onDecide, onFocusNode,
}: AgentRunPlanCardProps) {
  const copy = translations[language].agentPanel;
  const view = buildRunPlanView({ request, nodes, decision, decidedAt });
  const summary = describeAgentConfirmation(request, nodes, language);
  const gates = request.gates || [];
  const pending = !decision;
  const [expanded, setExpanded] = useState(Boolean(blocked));
  const [session, setSession] = useState(false);
  const root = useRef<HTMLElement>(null);
  // 待确认时拿到焦点：Esc 等于「调整后再创建」（不运行）；不自动聚焦主按钮，避免误按回车批准。
  useEffect(() => { if (pending) root.current?.focus({ preventScroll: true }); }, [pending]);
  const title = view.groupName || copy.planBatchTitle(view.total);
  const note = decision === 'manual' ? copy.planManualNote : decision === 'adjust' ? copy.planAdjustNote : summary.detail;

  return (
    <div className="agent-plan-wrap" data-testid="agent-run-plan">
      <section
        ref={root}
        className={`agent-plan agent-plan--${view.phase}`}
        role={pending ? 'alertdialog' : 'group'}
        aria-label={copy.planCardAria}
        tabIndex={pending ? -1 : undefined}
        onKeyDown={event => {
          if (!pending || event.key !== 'Escape') return;
          event.preventDefault();
          onDecide?.('adjust', { session: false });
        }}
      >
        {view.model && <p className="agent-plan__model">{copy.planModel}<span>{view.model}</span></p>}
        <div className="agent-plan__head">
          <strong className="agent-plan__title">{title}</strong>
          <span className={`agent-plan__status agent-plan__status--${view.phase}`} role="status">{statusText(view, copy)}</span>
        </div>
        {gates.length > 0 && (
          <div className="agent-plan__assets">
            <button type="button" className="agent-plan__row agent-plan__row--toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
              <strong>{copy.planAssets}</strong>
              <span>{expanded ? copy.planCollapse : copy.planExpand}<ChevronRight size={13} aria-hidden="true" className={expanded ? 'is-open' : undefined} /></span>
            </button>
            {expanded && <GenerationPlanCard plan={{ items: [...gates], mandate: planMandateNote }} />}
          </div>
        )}
        {view.groupName && (
          <p className="agent-plan__row agent-plan__group"><span>{copy.planGroup}</span><span className="agent-plan__group-name"><Layers size={12} aria-hidden="true" />{view.groupName}</span></p>
        )}
        {view.total > 0 && (
          <div className="agent-plan__workflow">
            <span className="agent-plan__label">{copy.planWorkflow(view.total)}</span>
            <div className="agent-plan__chips">
              {view.items.map(item => (
                <button
                  key={item.nodeId}
                  type="button"
                  className={`agent-plan__chip agent-plan__chip--${item.status}`}
                  title={onFocusNode ? copy.planFocusNode : undefined}
                  disabled={!onFocusNode}
                  onClick={() => onFocusNode?.(item.nodeId)}
                >
                  <Square size={10} aria-hidden="true" />
                  <span>{item.title || copy.planUntitledNode}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {pending && blocked && <p className="agent-plan__blocked">{copy.planBlocked}</p>}
        {pending && offerMandate && (
          <label className="agent-plan__mandate">
            <input type="checkbox" checked={session} onChange={event => setSession(event.target.checked)} />
            <span>{copy.planMandate}</span>
            <input
              type="number"
              min={1}
              value={mandateTasks}
              onChange={event => onMandateTasksChange?.(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
              aria-label={copy.planMandateAria}
            />
            <span>{copy.planMandateTasks}</span>
          </label>
        )}
        {pending ? (
          <div className="agent-plan__actions">
            <button type="button" className="agent-plan__primary" disabled={blocked} onClick={() => onDecide?.('auto', { session: Boolean(offerMandate && session) })}>{copy.planAutoRun}</button>
            <div className="agent-plan__secondary">
              <button type="button" onClick={() => onDecide?.('manual', { session: false })}>{copy.planManualRun}</button>
              <button type="button" title={copy.planAdjustHint} onClick={() => onDecide?.('adjust', { session: false })}>{copy.planAdjust}</button>
            </div>
          </div>
        ) : decision === 'auto' ? (
          <div className={`agent-plan__progress agent-plan__progress--${view.phase}`}><i aria-hidden="true" />{statusText(view, copy)}</div>
        ) : null}
      </section>
      {note && <p className="agent-plan__note">{note}</p>}
    </div>
  );
}
