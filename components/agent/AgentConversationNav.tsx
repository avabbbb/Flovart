import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { translations } from '../../utils/translations';
import { activeTurnIndex, type ConversationTurn } from './agentConversationNav';

/** 消息区真正的滚动层可能是外层容器，也可能是 WorkflowAgentMessages 的根节点（取决于样式），两者都处理。 */
export function messageScrollers(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const inner = root.firstElementChild;
  return inner instanceof HTMLElement ? [root, inner] : [root];
}

/** 当前真正在滚的那一层：内层有可滚动内容时用内层，否则外层。 */
export function activeMessageScroller(root: HTMLElement | null): HTMLElement | null {
  const [outer, inner] = messageScrollers(root);
  if (inner && inner.scrollHeight > inner.clientHeight + 1) return inner;
  return outer ?? null;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 平滑滚动（尊重减弱动效；环境不支持 scrollTo 时直接定位）。 */
export function smoothScrollTo(element: HTMLElement, top: number) {
  if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  else element.scrollTop = top;
}

/** 元素相对滚动层内容顶部的偏移。 */
function offsetWithin(scroller: HTMLElement, element: HTMLElement) {
  return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

function turnElement(root: HTMLElement | null, index: number) {
  return root?.querySelector<HTMLElement>(`[data-turn-index="${index}"]`) ?? null;
}

/**
 * 对话轮次时间轴：消息区左缘每轮一道短刻度，当前可视轮高亮；悬停 / 聚焦弹出这一轮的预览，点击平滑滚回这一轮。
 * 少于两轮时不显示。
 */
export function AgentTurnTimeline({ rootRef, turns, language, onJump }: {
  rootRef: React.RefObject<HTMLElement | null>;
  turns: readonly ConversationTurn[];
  language: 'en' | 'zho';
  /** 跳转前通知面板：停止跟随底部。 */
  onJump?: () => void;
}) {
  const copy = translations[language].agentPanel;
  const [active, setActive] = useState(-1);
  const [preview, setPreview] = useState<number | null>(null);
  const count = turns.length;

  const measure = useCallback(() => {
    const root = rootRef.current;
    const scroller = activeMessageScroller(root);
    if (!scroller || !count) { setActive(-1); return; }
    const tops: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const element = turnElement(root, index);
      tops.push(element ? offsetWithin(scroller, element) : Number.POSITIVE_INFINITY);
    }
    setActive(activeTurnIndex(tops, scroller.scrollTop, scroller.clientHeight));
  }, [count, rootRef]);

  useEffect(() => {
    const scrollers = messageScrollers(rootRef.current);
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => { frame = 0; measure(); });
    };
    scrollers.forEach(element => element.addEventListener('scroll', onScroll, { passive: true }));
    measure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scrollers.forEach(element => element.removeEventListener('scroll', onScroll));
    };
  }, [measure, rootRef, turns]);

  if (count < 2) return null;

  const jump = (index: number) => {
    const root = rootRef.current;
    const scroller = activeMessageScroller(root);
    const element = turnElement(root, index);
    if (!scroller || !element) return;
    onJump?.();
    smoothScrollTo(scroller, Math.max(0, offsetWithin(scroller, element) - 8));
    setActive(index);
  };

  return (
    <nav className="agent-turn-rail" aria-label={copy.turnTimeline} onMouseLeave={() => setPreview(null)}>
      {turns.map(turn => (
        <div key={turn.userMessageId} className="agent-turn-rail__item">
          <button
            type="button"
            className={`agent-turn-rail__tick${turn.index === active ? ' is-active' : ''}`}
            aria-label={`${copy.turnLabel(turn.index + 1)}${turn.question ? '：' + turn.question : ''}`}
            aria-current={turn.index === active ? 'true' : undefined}
            onMouseEnter={() => setPreview(turn.index)}
            onFocus={() => setPreview(turn.index)}
            onBlur={() => setPreview(current => (current === turn.index ? null : current))}
            onClick={() => jump(turn.index)}
          />
          {preview === turn.index && (
            <div className="agent-turn-rail__preview" role="tooltip">
              {turn.question && <strong>{turn.question}</strong>}
              {turn.answer && <p>{turn.answer}</p>}
              <small>{copy.turnJumpHint}</small>
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

/** 「回到最新消息」：离开底部时在输入框上方居中出现的圆形向下按钮。 */
export function AgentScrollToLatest({ visible, language, onClick }: { visible: boolean; language: 'en' | 'zho'; onClick: () => void }) {
  const label = translations[language].agentPanel.scrollToLatest;
  if (!visible) return null;
  return (
    <div className="agent-scroll-latest">
      <button type="button" className="agent-scroll-latest__btn" aria-label={label} title={label} data-tip={label} onClick={onClick}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
