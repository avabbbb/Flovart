import { Check, ChevronDown, Minus, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { forwardRef, useId, useState, type HTMLAttributes, type ReactNode } from 'react';

import '../../../styles/planSteps.css';

/**
 * 共用「计划」组件：Skill 详情、生成计划卡（AgentRunPlanCard）、执行计划卡（AgentTodoCard）都是一份计划，用同一套外观。
 *
 * 版式参照（登记见 docs/design/references.md）：
 * - 头 / 行 / 尾的结构：Inspora「Agent Plan」@Jeet —— 标题 + 等宽步数胶囊 + 右侧带点状态；
 *   行 = 图标 + 标题 + 右侧状态胶囊；一次只展开一行（说明 + 工具 / 模型芯片 + 行内操作）；尾 = 状态点 + 文案 / 操作 + 深色药丸主按钮。
 * - 竖向结构：Inspora「RAG Pipeline」@Jeet —— 每步一个方圆图标块，1px 连接线串起来；运行中的块和它下面的线填强调色；
 *   完成的块换成勾，右侧可带等宽耗时；待执行为灰。
 * 颜色只用 DESIGN §11 状态色（--state-*），不搬原作的绿 / 琥珀。
 */

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'blocked';
export type PlanTone = 'idle' | 'running' | 'done' | 'failed' | 'blocked';

export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
  /** 方圆图标块里的图标；运行中 / 完成 / 失败会被状态图标替换（运行中保留原图标，填强调色）。 */
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
  title: ReactNode;
  /** 等宽步数胶囊，例如「4 个步骤」。 */
  count?: ReactNode;
  status?: PlanStatusLine;
  /** 标题下的一行补充（模型、编组等）。 */
  meta?: ReactNode;
  steps: readonly PlanStep[];
  /** 状态胶囊文案；不传时不画胶囊（例如 Skill 详情只讲做什么）。 */
  statusLabels?: Partial<Record<PlanStepStatus, string>>;
  /** 列表的无障碍名称（也作为隐藏标题渲染，读屏可以跳到）。 */
  listLabel?: string;
  /** 受控展开；不传则内部维护，初值为 defaultExpandedId。 */
  expandedId?: string | null;
  defaultExpandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
  /** 列表下、尾部上的额外内容（明细、授权勾选、阻塞说明）。 */
  extra?: ReactNode;
  footer?: { status?: PlanStatusLine; actions?: ReactNode } | null;
  /** 紧凑：嵌在别的容器里（Skill 详情），不画外壳阴影。 */
  compact?: boolean;
}

function StepTile({ step, index }: { step: PlanStep; index: number }) {
  let glyph: ReactNode = step.icon ?? <span className="flv-plan__tile-num flv-machine">{index + 1}</span>;
  if (step.status === 'done') glyph = <Check size={15} strokeWidth={2.6} />;
  else if (step.status === 'failed') glyph = <X size={15} strokeWidth={2.6} />;
  else if (step.status === 'skipped') glyph = <Minus size={15} strokeWidth={2.4} />;
  else if (step.status === 'blocked') glyph = <span className="flv-plan__tile-bang">!</span>;
  return (
    <span className="flv-plan__tile" data-status={step.status} aria-hidden="true">
      {glyph}
      {step.status === 'running' && <span className="flv-plan__tile-spin" />}
    </span>
  );
}

export const PlanSteps = forwardRef<HTMLElement, PlanStepsProps>(function PlanSteps({
  title, count, status, meta, steps, statusLabels, listLabel, expandedId, defaultExpandedId = null, onExpandedChange,
  extra, footer, compact, className, ...rest
}, ref) {
  const reduce = useReducedMotion();
  const [innerExpanded, setInnerExpanded] = useState<string | null>(defaultExpandedId);
  const open = expandedId !== undefined ? expandedId : innerExpanded;
  const baseId = useId();
  const listHeadingId = `${baseId}-list`;
  const toggle = (id: string) => {
    const next = open === id ? null : id;
    if (expandedId === undefined) setInnerExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <section ref={ref} className={`flv-plan${compact ? ' flv-plan--compact' : ''}${className ? ` ${className}` : ''}`} data-tone={status?.tone ?? 'idle'} {...rest}>
      <header className="flv-plan__head">
        <strong className="flv-plan__title">{title}</strong>
        {count !== undefined && <span className="flv-plan__count flv-machine">{count}</span>}
        {status && (
          <span className="flv-plan__status" data-tone={status.tone} role="status">
            <span className="flv-plan__dot" aria-hidden="true" />
            <span className="flv-plan__status-text">{status.text}</span>
          </span>
        )}
      </header>
      {meta && <div className="flv-plan__meta">{meta}</div>}
      <div className="flv-plan__panel">
        {listLabel && <h4 id={listHeadingId} className="flv-plan__sr">{listLabel}</h4>}
        <ol className="flv-plan__list" aria-labelledby={listLabel ? listHeadingId : undefined}>
          {steps.map((step, index) => {
            const expandable = Boolean(step.description || step.chip || step.actions);
            const isOpen = expandable && open === step.id;
            const detailId = `${baseId}-d${index}`;
            const label = statusLabels?.[step.status];
            const filledLine = step.status === 'running';
            const head = (
              <>
                <StepTile step={step} index={index} />
                <span className="flv-plan__step-title">{step.title}</span>
                {step.status === 'done' && step.timing && <span className="flv-plan__timing flv-machine">{step.timing}</span>}
                {label && (
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={step.status}
                      className="flv-plan__pill"
                      data-status={step.status}
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      transition={reduce ? { duration: 0.1 } : { type: 'spring', visualDuration: 0.2, bounce: 0.2 }}
                    >{label}</motion.span>
                  </AnimatePresence>
                )}
                {expandable && <ChevronDown size={14} className="flv-plan__chev" aria-hidden="true" />}
              </>
            );
            return (
              <li key={step.id} className="flv-plan__step" data-status={step.status} data-open={isOpen ? 'true' : undefined} data-line={filledLine ? 'filled' : undefined}>
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
                      transition={reduce ? { duration: 0.1 } : { type: 'spring', visualDuration: 0.26, bounce: 0 }}
                    >
                      <div className="flv-plan__detail-inner">
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
              </li>
            );
          })}
        </ol>
      </div>
      {extra}
      {footer && (footer.status || footer.actions) && (
        <footer className="flv-plan__foot">
          {footer.status && (
            <span className="flv-plan__foot-status" data-tone={footer.status.tone}>
              <span className="flv-plan__dot" aria-hidden="true" />
              <span>{footer.status.text}</span>
            </span>
          )}
          {footer.actions && <div className="flv-plan__foot-actions">{footer.actions}</div>}
        </footer>
      )}
    </section>
  );
});
