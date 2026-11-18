import { ChevronDown, X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

import '../../styles/agentCardShell.css';

/**
 * Agent 卡片外壳：计划（PlanSteps）、提问（AgentAskCard）、审批（AgentConfirmCard）共用。
 * 版式参照 Inspora 1-37「AI Agent Approval Cards」@Kevin（kvnkld，登记见 docs/design/references.md）：
 * 头 = 强调色图标方块 + 标签 + 右侧幽灵按钮；尾 = 左侧状态 / 翻页，右侧灰色次按钮 + 反色主按钮（带 ⏎）。
 * 颜色只用 DESIGN §11 状态色（--state-*）与 --isl-* 墨色；卡面在面板里走 .agent-card-on-shell 的环境底。
 */

export type AgentCardAccent = 'plan' | 'ask' | 'approve' | 'blocked';

export interface AgentCardHeadProps {
  icon: ReactNode;
  label: ReactNode;
  accent?: AgentCardAccent;
  /** 头部右侧（状态文字、队列数等），在幽灵按钮之前。 */
  aside?: ReactNode;
  /** 给出时显示幽灵折叠按钮。 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  collapseLabel?: string;
  expandLabel?: string;
  /** 给出时显示幽灵关闭按钮（例如提问卡的「取消」）。 */
  onClose?: () => void;
  closeLabel?: string;
}

export function AgentCardHead({ icon, label, accent = 'plan', aside, collapsed, onToggleCollapsed, collapseLabel, expandLabel, onClose, closeLabel }: AgentCardHeadProps) {
  return (
    <header className="flv-card__head">
      <span className="flv-card__icon" data-accent={accent} aria-hidden="true">{icon}</span>
      <span className="flv-card__label">{label}</span>
      {aside && <span className="flv-card__aside">{aside}</span>}
      {onToggleCollapsed && (
        <button
          type="button"
          className="flv-card__ghost"
          aria-expanded={!collapsed}
          aria-label={collapsed ? expandLabel : collapseLabel}
          title={collapsed ? expandLabel : collapseLabel}
          onClick={onToggleCollapsed}
        >
          <ChevronDown size={15} aria-hidden="true" data-collapsed={collapsed ? 'true' : undefined} />
        </button>
      )}
      {onClose && (
        <button type="button" className="flv-card__ghost" aria-label={closeLabel} title={closeLabel} onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

/** 卡片尾部：左侧状态 / 翻页（可省），右侧按钮。窄宽度下按钮整行靠右换行，不裁切。 */
export function AgentCardFoot({ start, children }: { start?: ReactNode; children?: ReactNode }) {
  if (!start && !children) return null;
  return (
    <footer className="flv-card__foot">
      {start && <div className="flv-card__foot-start">{start}</div>}
      {children && <div className="flv-card__foot-actions">{children}</div>}
    </footer>
  );
}

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  /** 主按钮右侧的 ⏎ 提示（只在按钮自身有焦点时 Enter 生效，这是原生按钮行为）。 */
  enterHint?: boolean;
};

export const AgentCardButton = forwardRef<HTMLButtonElement, PillProps>(function AgentCardButton({ variant = 'secondary', enterHint, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={`flv-card__btn flv-card__btn--${variant}${className ? ` ${className}` : ''}`} {...rest}>
      <span className="flv-card__btn-text">{children}</span>
      {enterHint && <kbd className="flv-card__enter" aria-hidden="true">⏎</kbd>}
    </button>
  );
});

export const AgentCardShell = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' }>(function AgentCardShell({ className, as = 'section', ...rest }, ref) {
  const Tag = as as 'section';
  return <Tag ref={ref as never} className={`flv-card${className ? ` ${className}` : ''}`} {...rest} />;
});
