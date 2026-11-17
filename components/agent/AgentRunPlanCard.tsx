import { AudioLines, ChevronRight, Clapperboard, Crosshair, Image as ImageIcon, Layers, Play, Square, Type } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowNode } from '../workflow/types';
import type { AgentConfirmRequest } from '../../services/agentSpendMandate';
import { GenerationPlanCard } from '../GenerationPlanCard';
import { translations } from '../../utils/translations';
import { describeAgentConfirmation } from './agentConfirmCopy';
import { buildRunPlanView, type RunPlanDecision, type RunPlanItemStatus, type RunPlanView } from './agentRunPlan';
import { PlanSteps, type PlanStatusLine, type PlanStep, type PlanStepStatus, type PlanTone } from './plan/PlanSteps';

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

type PanelCopy = typeof translations['zho']['agentPanel'];

function statusText(view: RunPlanView, copy: PanelCopy) {
  switch (view.phase) {
    case 'running': return copy.planStatusRunning(view.done, view.total);
    case 'done': return copy.planStatusDone;
    case 'failed': return copy.planStatusFailed(view.failed);
    case 'manual': return copy.planStatusManual;
    case 'adjust': return copy.planStatusAdjust;
    default: return copy.planStatusPending;
  }
}

function phaseTone(view: RunPlanView): PlanTone {
  if (view.phase === 'running') return 'running';
  if (view.phase === 'done') return 'done';
  if (view.phase === 'failed') return 'failed';
  return 'idle';
}

const STEP_STATUS: Record<RunPlanItemStatus, PlanStepStatus> = { idle: 'pending', running: 'running', done: 'done', error: 'failed' };

function nodeIcon(kind: string | undefined) {
  if (kind === 'video') return <Clapperboard />;
  if (kind === 'audio') return <AudioLines />;
  if (kind === 'text' || kind === 'script') return <Type />;
  if (kind === 'image') return <ImageIcon />;
  return <Square />;
}

/**
 * 生成计划卡：生成前 / 生成中给出「这一批要建 / 要跑哪些节点」。外观是共用的 PlanSteps（Agent Plan + RAG Pipeline 版式），
 * 每个节点一步：类型图标、标题、状态胶囊；展开一行看提示词、模型和「定位节点」。
 * 行为不变：三个选择（自动 / 手动 / 调整）、付费授权勾选与上限、blocked 禁用自动运行、Esc = 调整、待确认时 alertdialog 抢焦点；
 * 门禁明细（GenerationPlanCard）收在「资产列表」里展开。
 */
export function AgentRunPlanCard({
  request, nodes, language, decision, decidedAt, blocked, offerMandate, planMandateNote, mandateTasks = 10, onMandateTasksChange, onDecide, onFocusNode,
}: AgentRunPlanCardProps) {
  const copy = translations[language].agentPanel;
  const planCopy = translations[language].planSteps;
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
  const byId = useMemo(() => new Map(nodes.map(node => [node.id, node])), [nodes]);

  const steps: PlanStep[] = view.items.map((item, index) => {
    const node = byId.get(item.nodeId);
    const gate = gates.length === view.items.length ? gates[index] : undefined;
    const prompt = typeof node?.metadata?.prompt === 'string' ? node.metadata.prompt.trim() : '';
    const model = gate?.modelLabel?.trim() || node?.metadata?.config?.modelId || undefined;
    return {
      id: item.nodeId,
      title: item.title || copy.planUntitledNode,
      status: STEP_STATUS[item.status],
      icon: nodeIcon(node?.type ?? item.mediaType),
      description: prompt || planCopy.runNoPrompt,
      chip: model,
      actions: onFocusNode ? (
        <button type="button" className="flv-plan__mini-btn" title={copy.planFocusNode} onClick={() => onFocusNode(item.nodeId)}>
          <Crosshair size={12} aria-hidden="true" />{planCopy.runLocate}
        </button>
      ) : undefined,
    };
  });
  const runningIndex = view.items.findIndex(item => item.status === 'running');
  const status: PlanStatusLine = { text: statusText(view, copy), tone: phaseTone(view) };
  const footStatus: PlanStatusLine = pending
    ? { text: blocked ? copy.planBlocked : planCopy.runFootPending, tone: blocked ? 'blocked' : 'idle' }
    : view.phase === 'running'
      ? { text: planCopy.runFootRunning(Math.min(view.total, (runningIndex >= 0 ? runningIndex : view.done) + 1), view.total), tone: 'running' }
      : view.phase === 'done'
        ? { text: planCopy.runFootDone(view.total), tone: 'done' }
        : view.phase === 'failed'
          ? { text: copy.planStatusFailed(view.failed), tone: 'failed' }
          : { text: statusText(view, copy), tone: 'idle' };

  const footActions = pending ? (
    <>
      <button type="button" className="flv-plan__text-btn" onClick={() => onDecide?.('manual', { session: false })}>{copy.planManualRun}</button>
      <button type="button" className="flv-plan__text-btn" title={copy.planAdjustHint} onClick={() => onDecide?.('adjust', { session: false })}>{copy.planAdjust}</button>
      <button type="button" className="flv-plan__primary agent-plan__primary" disabled={blocked} onClick={() => onDecide?.('auto', { session: Boolean(offerMandate && session) })}>
        <Play aria-hidden="true" />{copy.planAutoRun}
      </button>
    </>
  ) : decision === 'auto' ? (
    <span className="flv-plan__badge agent-plan__progress" data-tone={view.phase === 'running' ? 'running' : view.phase === 'failed' ? 'failed' : 'done'}>
      {view.phase === 'running' && <span className="flv-plan__badge-spin" aria-hidden="true" />}
      {view.phase === 'running' ? planCopy.runInProgress : statusText(view, copy)}
    </span>
  ) : null;

  const meta = (view.model || view.groupName) ? (
    <>
      {view.model && <span className="agent-plan__model">{copy.planModel}<span className="flv-machine">{view.model}</span></span>}
      {view.groupName && <span className="agent-plan__group"><span>{copy.planGroup}</span><Layers size={12} aria-hidden="true" /><span className="agent-plan__group-name">{view.groupName}</span></span>}
    </>
  ) : undefined;

  const extra = (
    <>
      {gates.length > 0 && (
        <div className="agent-plan__assets">
          <button type="button" className="agent-plan__toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            <strong>{copy.planAssets}</strong>
            <span>{expanded ? copy.planCollapse : copy.planExpand}<ChevronRight size={13} aria-hidden="true" className={expanded ? 'is-open' : undefined} /></span>
          </button>
          {expanded && <GenerationPlanCard plan={{ items: [...gates], mandate: planMandateNote }} />}
        </div>
      )}
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
    </>
  );

  return (
    <div className="agent-plan-wrap" data-testid="agent-run-plan">
      <PlanSteps
        ref={root}
        className={`agent-plan agent-card-on-shell agent-plan--${view.phase}`}
        role={pending ? 'alertdialog' : 'group'}
        aria-label={copy.planCardAria}
        tabIndex={pending ? -1 : undefined}
        onKeyDown={event => {
          if (!pending || event.key !== 'Escape') return;
          event.preventDefault();
          onDecide?.('adjust', { session: false });
        }}
        title={title}
        count={planCopy.runSteps(view.total)}
        status={status}
        meta={meta}
        steps={steps}
        statusLabels={planCopy.status}
        listLabel={copy.planWorkflow(view.total)}
        extra={extra}
        footer={{ status: footStatus, actions: footActions }}
      />
      {note && <p className="agent-plan__note">{note}</p>}
    </div>
  );
}
