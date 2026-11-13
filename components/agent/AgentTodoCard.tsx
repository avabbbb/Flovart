import { Check, ListChecks } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { todoProgress, type AgentTodoItem } from './agentTodo';

// 状态 → 图标：空圈（待办）→ 转圈（进行中，思考色）→ 实心勾（完成，写入色）；阻塞为红色实心。
function TodoIcon({ status }: { status: AgentTodoItem['status'] }) {
  const reduce = useReducedMotion();
  const pop = reduce ? {} : { initial: { scale: 0.4, opacity: 0 }, animate: { scale: 1, opacity: 1 }, exit: { scale: 0.4, opacity: 0 }, transition: { type: 'spring' as const, stiffness: 520, damping: 28 } };
  return (
    <span className='agent-todo-icon' aria-hidden='true'>
      <AnimatePresence mode='wait' initial={false}>
        {status === 'done' && <motion.span key='done' className='agent-todo-icon__done' {...pop}><Check size={10} strokeWidth={3} /></motion.span>}
        {status === 'active' && <motion.span key='active' className='agent-todo-icon__spin' {...pop} />}
        {status === 'blocked' && <motion.span key='blocked' className='agent-todo-icon__blocked' {...pop}>!</motion.span>}
        {status === 'pending' && <motion.span key='pending' className='agent-todo-icon__ring' {...pop} />}
      </AnimatePresence>
    </span>
  );
}

// 制作任务清单：按模型最新提交的 flovart_todo 渲染，只读，不反向修改清单。
export function AgentTodoCard({ items, language = 'zho' }: { items: readonly AgentTodoItem[]; language?: 'en' | 'zho' }) {
  const reduce = useReducedMotion();
  if (!items.length) return null;
  const zh = language === 'zho';
  const { done, total } = todoProgress(items);
  const pct = total ? (done / total) * 100 : 0;
  return (
    <section className='agent-todo-card agent-card-on-shell' aria-label={zh ? '任务清单' : 'Task list'}>
      <div className='agent-todo-card__bar' aria-hidden='true'>
        <motion.span initial={false} animate={{ width: `${pct}%` }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 160, damping: 26 }} />
      </div>
      <header>
        <ListChecks size={14} />
        <span>{zh ? '任务清单' : 'Task list'}</span>
        <span className='flv-machine' aria-label={zh ? `已完成 ${done} / ${total}` : `${done} of ${total} done`}>{done} / {total}</span>
      </header>
      <ol>
        {items.map(item => (
          <li key={item.id} data-status={item.status}>
            <TodoIcon status={item.status} />
            <span>
              <span className='agent-todo-card__text'>{item.content}</span>
              {item.note ? <span className='agent-todo-card__note'>{item.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
