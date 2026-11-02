import { useMemo } from 'react';
import { BookMarked } from 'lucide-react';
import { useAgentReceiptStore, type AgentReceipt } from '../../stores/useAgentReceiptStore';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';

type Lang = 'en' | 'zho';

const KIND_LABELS: Record<AgentReceipt['kind'], [string, string]> = {
  task: ['任务', 'Task'],
  artifact: ['产物', 'Artifact'],
  decision: ['决定', 'Decision'],
  note: ['备注', 'Note'],
};

const EMPTY: AgentReceipt[] = [];

function dateTimeOf(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Project-level shared context: read-only receipts that any connected Agent left for
 * this project. Not a merged memory; the canvas stays the source of truth.
 */
export function AgentReceiptsSection({ language = 'zho' }: { language?: Lang }) {
  const zh = language === 'zho';
  const projectId = useAgentConnectionStore(state => state.projectId);
  const receipts = useAgentReceiptStore(state => (projectId ? state.byProject[projectId] : undefined) || EMPTY);
  const visible = useMemo(() => [...receipts].reverse(), [receipts]);

  return (
    <div className="flex flex-col gap-2" data-testid="agent-receipts">
      <div className="flex items-center gap-2 text-xs">
        <BookMarked size={14} />
        <strong>{zh ? '项目共享回执' : 'Shared project receipts'}</strong>
        <span style={{ color: 'var(--isl-ink-ghost)' }}>
          {zh ? '各 Agent 留下的任务、产物和决定，只读，所有 Agent 都能看到' : 'Tasks, artifacts and decisions any agent left here; read-only and visible to every agent'}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="rounded-xl border p-4 text-center text-xs" style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink-soft)' }}>
          {zh ? '还没有回执。外部 Agent 可以通过本地服务的 /receipts 写入或导入历史记录。' : 'No receipts yet. External agents can add or import history through the local service /receipts endpoint.'}
        </p>
      ) : (
        <ol className="flex max-h-[320px] flex-col overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--isl-border)' }}>
          {visible.map(receipt => (
            <li key={receipt.id} className="flex items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0" style={{ borderColor: 'var(--isl-border)' }}>
              <span className="shrink-0 rounded px-1" style={{ background: 'var(--isl-surface-2)', color: 'var(--isl-ink-soft)' }}>
                {zh ? KIND_LABELS[receipt.kind][0] : KIND_LABELS[receipt.kind][1]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <strong>{receipt.title}</strong>
                  {receipt.agentIdentity ? <span style={{ color: 'var(--isl-ink-soft)' }}>{receipt.agentIdentity}</span> : null}
                </div>
                {receipt.summary ? <div style={{ color: 'var(--isl-ink-soft)' }}>{receipt.summary}</div> : null}
              </div>
              <time className="shrink-0 tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }} dateTime={receipt.at}>{dateTimeOf(receipt.at)}</time>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
