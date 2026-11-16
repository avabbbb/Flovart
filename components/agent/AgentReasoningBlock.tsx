// 助手消息上方的「思考过程」：流式时展开并实时计时（思考中… 12s），正文开始 / 转去调工具时
// 自动收起为「已思考 12s」，点一下展开。弱化显示、内部可滚动，Markdown 照常渲染。
// 计时与完成标记都来自真实流事件（agentStreamMessages），不在这里猜测。
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AgentMarkdown } from '../workflow/AgentMarkdown';
import { formatElapsed } from './agentWorkingPhase';
import '../../styles/agentWorking.css';

export function reasoningSummary({ live, ms, language }: { live: boolean; ms?: number; language: 'en' | 'zho' }): string {
  const en = language === 'en';
  const time = ms === undefined ? '' : formatElapsed(ms);
  if (live) return en ? `Thinking… ${time}`.trim() : `思考中… ${time}`.trim();
  if (!time) return en ? 'Thought' : '已思考';
  return en ? `Thought for ${time}` : `已思考 ${time}`;
}

export function AgentReasoningBlock({ text, live, startedAt, ms, language = 'zho' }: {
  text: string;
  /** 本轮仍在思考（未见正文 / 工具调用 / 回合结束）。 */
  live: boolean;
  startedAt?: number;
  /** 已定格的思考用时；恢复的旧会话可能没有。 */
  ms?: number;
  language?: 'en' | 'zho';
}) {
  const [now, setNow] = useState(() => Date.now());
  // null = 跟随状态（思考中展开、完成后收起）；用户点过后按用户的选择。
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const bodyId = useId();
  const open = userOpen ?? live;

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  // 思考中跟随最新内容滚到底；用户上滚后不抢滚动（离底 > 24px 视为用户在看前文）。
  useEffect(() => {
    const body = bodyRef.current;
    if (body && live && open && stickRef.current) body.scrollTop = body.scrollHeight;
  }, [text, live, open]);

  const elapsed = live ? (startedAt === undefined ? undefined : Math.max(0, now - startedAt)) : ms;
  const summary = reasoningSummary({ live, ms: elapsed, language });

  return (
    <div className="agent-reasoning" data-live={live ? '' : undefined} data-open={open ? '' : undefined} data-testid="agent-reasoning">
      <button type="button" className="agent-reasoning__toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setUserOpen(!open)}>
        <ChevronRight size={12} className="agent-reasoning__chevron" aria-hidden="true" />
        <span className="agent-reasoning__summary">{summary}</span>
      </button>
      {open && (
        <div
          ref={bodyRef}
          id={bodyId}
          className="agent-reasoning__body"
          onScroll={event => { const el = event.currentTarget; stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        >
          <AgentMarkdown text={text} language={language} />
        </div>
      )}
    </div>
  );
}
