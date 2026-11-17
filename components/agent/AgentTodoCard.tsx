import { useEffect, useState } from 'react';
import { translations } from '../../utils/translations';
import { todoProgress, type AgentTodoItem } from './agentTodo';
import { PlanSteps, type PlanStep, type PlanStepStatus, type PlanTone } from './plan/PlanSteps';

const STEP_STATUS: Record<AgentTodoItem['status'], PlanStepStatus> = { pending: 'pending', active: 'running', blocked: 'blocked', done: 'done' };

// 执行计划卡：外观是共用 PlanSteps（Inspora「Agent Plan」+「RAG Pipeline」@Jeet，登记见 docs/design/references.md）。
// 只展示 flovart_todo 的最新清单，不做逐步批准 / 跳过（后端没有这条路径）。颜色走 DESIGN §11 状态色。
// 方圆块里是步号；当前步（进行中 / 受阻）有说明时自动展开，其余有说明的行可以点开看。
export function AgentTodoCard({ items, language = 'zho' }: { items: readonly AgentTodoItem[]; language?: 'en' | 'zho' }) {
  const copy = translations[language].planSteps;
  const focus = items.find(item => item.status === 'blocked' && item.note) ?? items.find(item => item.status === 'active' && item.note);
  const [expandedId, setExpandedId] = useState<string | null>(focus?.id ?? null);
  // 当前步换了，就跟着展开新的当前步。
  useEffect(() => { setExpandedId(focus?.id ?? null); }, [focus?.id]);
  if (!items.length) return null;
  const { done, total } = todoProgress(items);
  const activeIndex = items.findIndex(item => item.status === 'active');
  const blockedIndex = items.findIndex(item => item.status === 'blocked');
  const phase: 'complete' | 'blocked' | 'running' | 'idle' = done === total ? 'complete' : blockedIndex >= 0 ? 'blocked' : activeIndex >= 0 ? 'running' : 'idle';
  const tone: PlanTone = phase === 'complete' ? 'done' : phase === 'blocked' ? 'blocked' : phase === 'running' ? 'running' : 'idle';
  const headStatus = phase === 'complete' ? copy.todoComplete : phase === 'blocked' ? copy.todoBlocked : phase === 'running' ? copy.todoRunning : copy.todoDone(done, total);
  const foot = phase === 'complete' ? copy.todoFootComplete(total)
    : phase === 'blocked' ? copy.todoFootBlocked(blockedIndex + 1)
    : phase === 'running' ? copy.todoFootRunning(activeIndex + 1, total)
    : copy.todoFootWaiting(total - done);
  const steps: PlanStep[] = items.map(item => ({
    id: item.id,
    title: item.content,
    status: STEP_STATUS[item.status],
    description: item.note || undefined,
  }));
  return (
    <PlanSteps
      className="agent-todo-card agent-plan-card agent-card-on-shell"
      data-phase={phase}
      aria-label={copy.todoTitle}
      title={copy.todoTitle}
      count={copy.count(total)}
      status={{ text: headStatus, tone }}
      steps={steps}
      statusLabels={{ pending: copy.todoStatus.pending, running: copy.todoStatus.active, blocked: copy.todoStatus.blocked, done: copy.todoStatus.done }}
      expandedId={expandedId}
      onExpandedChange={setExpandedId}
      footer={{ status: { text: <><span className="flv-machine flv-plan__foot-count">{done} / {total}</span>{foot}</>, tone } }}
    />
  );
}
