import { useEffect, useState } from 'react';
import { translations } from '../../utils/translations';
import { todoProgress, type AgentTodoItem } from './agentTodo';
import { AgentCardButton } from './AgentCardShell';
import { PlanSteps, type PlanStep, type PlanStepStatus, type PlanTone } from './plan/PlanSteps';

const STEP_STATUS: Record<AgentTodoItem['status'], PlanStepStatus> = { pending: 'pending', active: 'running', blocked: 'blocked', done: 'done' };

export interface BlockedTodoStep {
  /** 1 起的步号。 */
  index: number;
  title: string;
}

/**
 * 执行计划卡：外观是共用 PlanSteps（Inspora 1-37 Plan Overview @Kevin，登记见 docs/design/references.md）。
 * 展示 flovart_todo 的最新清单。某一步受阻时，那一行自动展开，尾部给出「拒绝 / 确认 ⏎」：
 * 面板据此批准 / 拒绝正在等待的确认请求，没有等待中的请求时发一句「确认，继续执行第 N 步」给 Agent。
 * ⏎ 只在「确认」按钮自身有焦点时生效（原生按钮行为），输入框里的回车不会触发。
 */
export function AgentTodoCard({ items, language = 'zho', onDecideBlocked }: {
  items: readonly AgentTodoItem[];
  language?: 'en' | 'zho';
  onDecideBlocked?: (approved: boolean, step: BlockedTodoStep) => void;
}) {
  const copy = translations[language].planSteps;
  const blocked = items.find(item => item.status === 'blocked');
  const focus = blocked ?? items.find(item => item.status === 'active' && item.note);
  const [expandedId, setExpandedId] = useState<string | null>(focus?.id ?? null);
  // 当前步换了，就跟着展开新的当前步。
  useEffect(() => { setExpandedId(focus?.id ?? null); }, [focus?.id]);
  // 同一个受阻步只回复一次；Agent 改了清单（受阻步变了）再放开。
  const [decidedFor, setDecidedFor] = useState<string | null>(null);
  useEffect(() => { setDecidedFor(null); }, [blocked?.id, blocked?.content]);
  if (!items.length) return null;
  const { done, total } = todoProgress(items);
  const activeIndex = items.findIndex(item => item.status === 'active');
  const blockedIndex = blocked ? items.indexOf(blocked) : -1;
  const phase: 'complete' | 'blocked' | 'running' | 'idle' = done === total ? 'complete' : blockedIndex >= 0 ? 'blocked' : activeIndex >= 0 ? 'running' : 'idle';
  const tone: PlanTone = phase === 'complete' ? 'done' : phase === 'blocked' ? 'blocked' : phase === 'running' ? 'running' : 'idle';
  const headStatus = phase === 'complete' ? copy.todoComplete : phase === 'blocked' ? copy.todoBlocked : phase === 'running' ? copy.todoRunning : copy.todoDone(done, total);
  const heading = phase === 'complete' ? copy.todoFootComplete(total)
    : phase === 'blocked' ? copy.todoBlockedHeading(blockedIndex + 1)
    : phase === 'running' ? copy.todoFootRunning(activeIndex + 1, total)
    : copy.todoFootWaiting(total - done);
  const steps: PlanStep[] = items.map(item => ({
    id: item.id,
    title: item.content,
    status: STEP_STATUS[item.status],
    description: item.note || (item.status === 'blocked' ? copy.todoBlockedFallback : undefined),
  }));
  const decided = Boolean(blocked && decidedFor === blocked.id);
  const decide = (approved: boolean) => {
    if (!blocked || !onDecideBlocked) return;
    setDecidedFor(blocked.id);
    onDecideBlocked(approved, { index: blockedIndex + 1, title: blocked.content });
  };
  const footer = phase === 'blocked' && blocked && onDecideBlocked
    ? {
      status: { text: decided ? copy.todoDecided : <span className="flv-machine flv-plan__foot-count">{done} / {total}</span>, tone: decided ? 'running' as const : 'blocked' as const },
      actions: decided ? undefined : (
        <>
          <AgentCardButton onClick={() => decide(false)}>{copy.todoReject}</AgentCardButton>
          <AgentCardButton variant="primary" enterHint onClick={() => decide(true)}>{copy.todoConfirm}</AgentCardButton>
        </>
      ),
    }
    : null;
  return (
    <PlanSteps
      className="agent-todo-card agent-plan-card agent-card-on-shell"
      data-phase={phase}
      aria-label={copy.todoTitle}
      language={language}
      label={copy.todoTitle}
      accent={phase === 'blocked' ? 'blocked' : 'plan'}
      heading={heading}
      summary={copy.todoDone(done, total)}
      status={{ text: headStatus, tone }}
      steps={steps}
      focusId={focus?.id ?? (activeIndex >= 0 ? items[activeIndex].id : null)}
      statusLabels={{ pending: copy.todoStatus.pending, running: copy.todoStatus.active, blocked: copy.todoStatus.blocked, done: copy.todoStatus.done }}
      expandedId={expandedId}
      onExpandedChange={setExpandedId}
      footer={footer}
    />
  );
}
