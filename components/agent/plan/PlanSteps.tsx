import { Check, ChevronDown, ListChecks, ListTodo, Minus, MoreHorizontal, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useId, useState, type HTMLAttributes, type ReactNode } from 'react';

import { translations } from '../../../utils/translations';
import { AgentCardFoot, AgentCardHead, type AgentCardAccent } from '../AgentCardShell';
import '../../../styles/planSteps.css';

/**
 * 共用「计划」组件：Skill 详情、生成计划卡（AgentRunPlanCard）、执行计划卡（AgentTodoCard）都是一份计划，用同一套外观。
 *
 * 版式参照 Inspora 1-37「AI Agent Approval Cards」@Kevin 的 Plan Overview（登记见 docs/design/references.md）：
 * 头 = 强调色图标方块 + 标签 + 幽灵折叠按钮；粗标题 + 灰色简介；内嵌「待办」面板（计数 + 状态圆环 + 单行省略标题）；
 * 默认只露 3 行（保证受阻 / 进行中那一行可见），其余收进「… 还有 N 项」，展开 / 收起有高度动画；
 * 尾 = 灰色次药丸 + 反色主药丸（带 ⏎）。原作的「N 秒后自动批准」倒计时不做（可能替用户批准付费生成）。
 * 颜色只用 DESIGN §11 状态色（--state-*）。
 */

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';
export type PlanTone = 'idle' | 'running' | 'done' | 'failed' | 'blocked';

export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
  /** 标题前的小类型图标（节点类型等）；可省。 */
  icon?: ReactNode;
  /** 展开后显示的说明。 */
  description?: ReactNode;
  /** 展开后的等宽芯片：工具 / 模型。 */
  chip?: string;
  /** 完成后右侧的等宽耗时，例如 "42 ms"；不知道就不传。 */
  timing?: string;
  /** 展开后的行内操作。 */
  actions?: ReactNode;
}

export interface PlanStatusLine {
  text: ReactNode;
  tone: PlanTone;
}

export interface PlanStepsProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** 头部标签，例如「执行计划」。 */
  label: ReactNode;
  icon?: ReactNode;
  accent?: AgentCardAccent;
  /** 粗标题。 */
  heading?: ReactNode;
  /** 标题下的灰色简介。 */
  summary?: ReactNode;
  /** 头部右侧的带点状态。 */
  status?: PlanStatusLine;
  /** 简介下的一行补充（模型、编组等）。 */
  meta?: ReactNode;
  /** 内嵌列表的标题，缺省「待办」。 */
  listTitle?: ReactNode;
  /** 列表标题右侧的计数，缺省为步数。 */
  count?: ReactNode;
  steps: readonly PlanStep[];
  /** 状态读屏文案；不传时只有圆环。 */
  statusLabels?: Partial<Record<PlanStepStatus, string>>;
  /** 列表的无障碍名称。 */
  listLabel?: string;
  /** 受控展开；不传则内部维护，初值为 defaultExpandedId。 */
  expandedId?: string | null;
  defaultExpandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  /** 收起时也必须露出的那一行；缺省取第一条受阻 / 运行中 / 失败。 */
  focusId?: string | null;
  /** 收起时露出几行，默认 3。 */
  visibleRows?: number;
  /** 列表下、尾部上的额外内容（明细、授权勾选、阻塞说明）。 */
  extra?: ReactNode;
  footer?: { status?: PlanStatusLine; actions?: ReactNode } | null;
  /** 紧凑：嵌在别的容器里（Skill 详情），不画外壳阴影、没有折叠按钮。 */
  compact?: boolean;
  language?: 'en' | 'zho';
}

function StatusRing({ status }: { status: PlanStepStatus }) {
  let glyph: ReactNode = null;
  if (status === 'done') glyph = <Check strokeWidth={3} />;
  else if (status === 'failed') glyph = <X strokeWidth={3} />;
  else if (status === 'skipped') glyph = <Minus strokeWidth={3} />;
  else if (status === 'blocked') glyph = <span className="flv-plan__ring-bang">!</span>;
  return (
    <span className="flv-plan__ring" data-status={status} aria-hidden="true">
      {glyph}
      {status === 'running' && <span className="flv-plan__ring-spin" />}
    </span>
  );
}

/** 收起时露出的窗口：focus 前留一行、后留一行，贴边时整体平移。 */
export function planWindow(total: number, focusIndex: number, rows: number): { start: number; end: number } {
  if (total <= rows + 1) return { start: 0, end: total };
  const start = focusIndex < 0 ? 0 : Math.min(Math.max(0, focusIndex - Math.max(0, rows - 2)), total - rows);
  return { start, end: start + rows };
}

export const PlanSteps = forwardRef<HTMLElement, PlanStepsProps>(function PlanSteps({
  label, icon, accent = 'plan', heading, summary, status, meta, listTitle, count, steps, statusLabels, listLabel,
  expandedId, defaultExpandedId = null, onExpandedChange, focusId, visibleRows = 3,
  extra, footer, compact, language = 'zho', className, ...rest
}, ref) {
  const copy = translations[language].planSteps;
  const reduce = useReducedMotion();
  const [innerExpanded, setInnerExpanded] = useState<string | null>(defaultExpandedId);
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const open = expandedId !== undefined ? expandedId : innerExpanded;
  const baseId = useId();
  const listHeadingId = `${baseId}-list`;
  const bodyId = `${baseId}-body`;
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    if (expandedId === undefined) setInnerExpanded(next);
    onExpandedChange?.(next);
  };
  const height = reduce ? { duration: 0.1 } : { type: 'spring' as const, visualDuration: 0.3, bounce: 0 };

  const autoFocus = steps.findIndex(step => step.status === 'blocked');
  const focusIndex = focusId !== undefined && focusId !== null
    ? steps.findIndex(step => step.id === focusId)
    : autoFocus >= 0 ? autoFocus : steps.findIndex(step => step.status === 'running' || step.status === 'failed');
  const win = planWindow(steps.length, focusIndex, visibleRows);
  const hidden = steps.length - (win.end - win.start);
  const canFold = hidden > 0;

  const body = (
    <>
      {heading && <h3 className="flv-card__heading flv-plan__heading">{heading}</h3>}
      {summary && <p className="flv-card__summary">{summary}</p>}
      {meta && <div className="flv-plan__meta">{meta}</div>}
      {steps.length > 0 && (
        <div className="flv-plan__panel">
          <div className="flv-plan__panel-head">
            <ListTodo size={13} aria-hidden="true" />
            <span id={listHeadingId} className="flv-plan__panel-title">{listTitle ?? copy.todoList}</span>
            <span className="flv-plan__panel-count flv-machine">{count ?? steps.length}</span>
          </div>
          <ol className="flv-plan__list" aria-label={listLabel} aria-labelledby={listLabel ? undefined : listHeadingId}>
            <AnimatePresence initial={false}>
              {steps.map((step, index) => {
                const inWindow = index >= win.start && index < win.end;
                if (!showAll && !inWindow) return null;
                const expandable = Boolean(step.description || step.chip || step.actions);
                const isOpen = expandable && open === step.id;
                const detailId = `${baseId}-d${index}`;
                const statusText = statusLabels?.[step.status];
                const head = (
                  <>
                    <StatusRing status={step.status} />
                    {step.icon && <span className="flv-plan__type" aria-hidden="true">{step.icon}</span>}
                    <span className="flv-plan__step-title" title={step.title}>{step.title}</span>
                    {statusText && <span className="flv-plan__sr">{statusText}</span>}
                    {step.status === 'done' && step.timing && <span className="flv-plan__timing flv-machine">{step.timing}</span>}
                    {expandable && <ChevronDown size={14} className="flv-plan__chev" aria-hidden="true" />}
                  </>
                );
                return (
                  <motion.li
                    key={step.id}
                    className="flv-plan__step"
                    data-status={step.status}
                    data-open={isOpen ? 'true' : undefined}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={height}
                  >
                    {expandable ? (
                      <button type="button" className="flv-plan__row" aria-expanded={isOpen} aria-controls={isOpen ? detailId : undefined} onClick={() => toggle(step.id)}>{head}</button>
                    ) : (
                      <div className="flv-plan__row">{head}</div>
                    )}
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="detail"
                          id={detailId}
                          className="flv-plan__detail"
                          initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                          transition={height}
                        >
                          <div className="flv-plan__detail-inner">
                            {step.title.length > 16 && <p className="flv-plan__full-title">{step.title}</p>}
                            {step.description && <div className="flv-plan__desc">{step.description}</div>}
                            {(step.chip || step.actions) && (
                              <div className="flv-plan__detail-foot">
                                {step.chip && <span className="flv-plan__chip flv-machine">{step.chip}</span>}
                                {step.actions && <span className="flv-plan__row-actions">{step.actions}</span>}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>
          {canFold && (
            <button type="button" className="flv-plan__more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
              <span className="flv-plan__more-icon" aria-hidden="true">{showAll ? <Minus size={13} /> : <MoreHorizontal size={13} />}</span>
              <span>{showAll ? copy.showLess : copy.showMore(hidden)}</span>
            </button>
          )}
        </div>
      )}
      {extra}
    </>
  );

  return (
    <section
      ref={ref}
      className={`flv-card flv-plan${compact ? ' flv-plan--compact' : ''}${className ? ` ${className}` : ''}`}
      data-tone={status?.tone ?? 'idle'}
      data-collapsed={collapsed ? 'true' : undefined}
      {...rest}
    >
      <AgentCardHead
        icon={icon ?? <ListChecks />}
        label={label}
        accent={accent}
        aside={status ? (
          <span className="flv-plan__status" data-tone={status.tone} role="status">
            <span className="flv-plan__dot" aria-hidden="true" />
            <span className="flv-plan__status-text">{status.text}</span>
          </span>
        ) : undefined}
        collapsed={collapsed}
        onToggleCollapsed={compact ? undefined : () => setCollapsed(value => !value)}
        collapseLabel={copy.collapseCard}
        expandLabel={copy.expandCard}
      />
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            id={bodyId}
            className="flv-plan__body"
            initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={height}
          >{body}</motion.div>
        )}
      </AnimatePresence>
      {footer && (footer.status || footer.actions) && (
        <AgentCardFoot
          start={footer.status ? (
            <span className="flv-plan__foot-status" data-tone={footer.status.tone}>
              <span className="flv-plan__dot" aria-hidden="true" />
              <span className="flv-plan__foot-text">{footer.status.text}</span>
            </span>
          ) : undefined}
        >{footer.actions}</AgentCardFoot>
      )}
    </section>
  );
});
