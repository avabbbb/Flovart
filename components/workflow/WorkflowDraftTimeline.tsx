import { AnimatePresence, motion } from 'motion/react';
import { History, X } from 'lucide-react';
import { useState } from 'react';
import type { WorkflowDraftActor, WorkflowDraftChangeSet } from './types';

const ACTOR_LABEL: Record<WorkflowDraftActor, string> = {
  agent: 'Agent',
  ui: '你',
  cli: 'CLI',
  mcp: 'MCP',
};

const STATUS_LABEL: Record<WorkflowDraftChangeSet['status'], string> = {
  completed: '已应用',
  partial: '部分应用',
  failed: '失败',
  undone: '已撤销',
};

export function WorkflowDraftTimeline({ changeSets, rightInset = 12 }: { changeSets: WorkflowDraftChangeSet[]; rightInset?: number }) {
  const [open, setOpen] = useState(false);
  const items = [...changeSets].reverse().slice(0, 12);
  return <div data-workflow-overlay style={{ position: 'absolute', zIndex: 76, right: rightInset, top: 12, transition: 'right 180ms ease' }} onPointerDown={event => event.stopPropagation()}>
    <button
      type="button"
      aria-label={open ? '关闭 Draft 时间线' : '打开 Draft 时间线'}
      title="Draft 时间线"
      onClick={() => setOpen(value => !value)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 30, padding: '4px 8px', border: 0, borderRadius: 7, color: 'var(--wf-text-soft, var(--wf-text))', background: open ? 'var(--wf-panel)' : 'transparent', cursor: 'pointer', fontSize: 11 }}
    >
      <History size={14} />
      {changeSets.length ? changeSets.length : null}
    </button>
    <AnimatePresence>
      {open && <motion.section
        aria-label="Draft 时间线"
        initial={{ opacity: 0, y: -6, scale: .97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -4, scale: .98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        style={{ position: 'absolute', right: 0, top: 36, width: 292, maxHeight: 330, overflow: 'hidden', border: '1px solid var(--wf-border)', borderRadius: 10, color: 'var(--wf-text)', background: 'var(--wf-panel)', boxShadow: 'var(--isl-shadow)', transformOrigin: 'top right' }}
      >
        <header style={{ display: 'flex', alignItems: 'center', height: 38, padding: '0 8px 0 11px', borderBottom: '1px solid var(--wf-border)' }}>
          <strong style={{ flex: 1, fontSize: 11 }}>同一画布 · Draft v{items[0]?.resultDraftVersion || 1}</strong>
          <button type="button" className="isl-icon-btn h-6 w-6" aria-label="关闭 Draft 时间线" onClick={() => setOpen(false)}><X size={12} /></button>
        </header>
        <div style={{ maxHeight: 290, overflowY: 'auto', padding: 7 }}>
          {items.length ? items.map(changeSet => {
            const affected = changeSet.nodeChanges.length + changeSet.connectionChanges.length;
            return <div key={changeSet.id} style={{ display: 'grid', gridTemplateColumns: '42px minmax(0,1fr) auto', gap: 7, alignItems: 'start', padding: '7px 6px', borderBottom: '1px solid color-mix(in srgb,var(--wf-border) 60%,transparent)', opacity: changeSet.status === 'undone' ? .58 : 1 }}>
              <span style={{ color: changeSet.actor === 'agent' ? 'var(--wf-accent)' : 'var(--wf-muted)', fontSize: 10, fontWeight: 700 }}>{ACTOR_LABEL[changeSet.actor]}</span>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10, fontWeight: 600 }}>{changeSet.intent}</strong>
                <small style={{ color: 'var(--wf-muted)', fontSize: 9 }}>{STATUS_LABEL[changeSet.status]} · {affected} 个对象</small>
              </span>
              <span style={{ color: 'var(--wf-muted)', fontSize: 9 }}>v{changeSet.resultDraftVersion}</span>
            </div>;
          }) : <div style={{ padding: '28px 12px', color: 'var(--wf-muted)', textAlign: 'center', fontSize: 11 }}>你或 Agent 的可逆操作会显示在这里。</div>}
        </div>
      </motion.section>}
    </AnimatePresence>
  </div>;
}
