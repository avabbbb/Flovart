import { AlertTriangle, CheckCircle2, Circle, CircleDashed, ListChecks } from 'lucide-react';
import { todoProgress, type AgentTodoItem } from './agentTodo';

function TodoIcon({ status }: { status: AgentTodoItem['status'] }) {
  if (status === 'done') return <CheckCircle2 size={14} style={{ color: 'var(--isl-mint)' }} />;
  if (status === 'active') return <CircleDashed size={14} className='animate-spin' style={{ color: 'var(--isl-ink)' }} />;
  if (status === 'blocked') return <AlertTriangle size={14} style={{ color: '#e5484d' }} />;
  return <Circle size={14} style={{ color: 'var(--isl-ink-soft)' }} />;
}

// 制作任务清单：按模型最新提交的 flovart_todo 渲染，只读，不反向修改清单。
export function AgentTodoCard({ items, language = 'zho' }: { items: readonly AgentTodoItem[]; language?: 'en' | 'zho' }) {
  if (!items.length) return null;
  const zh = language === 'zho';
  const { done, total } = todoProgress(items);
  return (
    <section className='agent-todo-card' aria-label={zh ? '任务清单' : 'Task list'} style={{ border: '1px solid var(--isl-line, rgba(0,0,0,0.08))', borderRadius: 12, padding: '8px 10px', margin: '6px 0', fontSize: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 4 }}>
        <ListChecks size={14} />
        <span>{zh ? '任务清单' : 'Task list'}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--isl-ink-soft)' }}>{done}/{total}</span>
      </header>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {items.map(item => (
          <li key={item.id} data-status={item.status} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', opacity: item.status === 'done' ? 0.6 : 1 }}>
            <span style={{ marginTop: 1 }}><TodoIcon status={item.status} /></span>
            <span>
              <span style={{ textDecoration: item.status === 'done' ? 'line-through' : 'none', fontWeight: item.status === 'active' ? 600 : 400 }}>{item.content}</span>
              {item.note ? <span style={{ display: 'block', color: item.status === 'blocked' ? '#e5484d' : 'var(--isl-ink-soft)' }}>{item.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
