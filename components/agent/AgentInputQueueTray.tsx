import { ArrowUp, ChevronDown, CornerDownRight, Trash2 } from 'lucide-react';
import { useId } from 'react';
import type { PendingInputKind } from './agentInputQueue';

export interface InputQueueTrayItem {
  id: string;
  kind: PendingInputKind;
  text: string;
}

/**
 * 输入框正上方的「N 条待发送」磨砂托盘（照 openai/codex 的 pending input preview）：
 * 标题 + 折叠箭头；每行 ↳ + 单行省略文本（全文在 title）；排队行带「↑ 立即发送」与「删除」，
 * 插话行显示「下一步工具结束后送达」。只有存在排队消息时才显示取回编辑的提示。
 */
export function AgentInputQueueTray({ items, collapsed, onToggle, onSendNow, onRemove, copy }: {
  items: InputQueueTrayItem[];
  collapsed: boolean;
  onToggle: () => void;
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
  copy: {
    title: string;
    collapse: string;
    expand: string;
    steerMeta: string;
    sendNow: string;
    remove: string;
    editHint: string;
  };
}) {
  const listId = useId();
  if (!items.length) return null;
  const hasQueued = items.some(item => item.kind === 'queued');
  return (
    <section className="agent-input-queue flv-frost" data-testid="agent-input-queue" aria-label={copy.title} data-collapsed={collapsed || undefined}>
      <button
        type="button"
        className="agent-input-queue__head"
        aria-expanded={!collapsed}
        aria-controls={listId}
        title={collapsed ? copy.expand : copy.collapse}
        onClick={onToggle}
      >
        <span className="agent-input-queue__title">{copy.title}</span>
        <ChevronDown size={14} aria-hidden="true" className="agent-input-queue__chevron" />
      </button>
      {!collapsed && <>
        <ul className="agent-input-queue__list" id={listId}>
          {items.map(item => (
            <li key={item.id} className="agent-input-queue__row" data-kind={item.kind} data-testid="agent-input-queue-row">
              <CornerDownRight size={13} aria-hidden="true" className="agent-input-queue__glyph" />
              <span className="agent-input-queue__body">
                <span className="agent-input-queue__text" title={item.text}>{item.text}</span>
                {item.kind === 'steer' && <span className="agent-input-queue__meta">{copy.steerMeta}</span>}
              </span>
              <span className="agent-input-queue__actions">
                {item.kind === 'queued' && (
                  <button type="button" className="agent-input-queue__action" aria-label={`${copy.sendNow} ${item.text}`} title={copy.sendNow} onClick={() => onSendNow(item.id)}>
                    <ArrowUp size={13} aria-hidden="true" />
                  </button>
                )}
                <button type="button" className="agent-input-queue__action" aria-label={`${copy.remove} ${item.text}`} title={copy.remove} onClick={() => onRemove(item.id)}>
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
        {hasQueued && <p className="agent-input-queue__hint">{copy.editHint}</p>}
      </>}
    </section>
  );
}
