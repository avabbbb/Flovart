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

const TODO_COPY = {
  zho: {
    title: '执行计划',
    steps: (n: number) => `${n} 步`,
    done: (d: number, t: number) => `已完成 ${d} / ${t}`,
    running: '执行中',
    blocked: '等你处理',
    complete: '计划完成',
    status: { pending: '待执行', active: '进行中', blocked: '受阻', done: '完成' },
    footRunning: (n: number, t: number) => `正在执行第 ${n} 步，共 ${t} 步`,
    footBlocked: (n: number) => `第 ${n} 步受阻`,
    footWaiting: (n: number) => `还有 ${n} 步待执行`,
    footComplete: (t: number) => `${t} 步全部完成`,
  },
  en: {
    title: 'Agent plan',
    steps: (n: number) => `${n} steps`,
    done: (d: number, t: number) => `${d} of ${t} done`,
    running: 'Running plan',
    blocked: 'Needs you',
    complete: 'Plan complete',
    status: { pending: 'Planned', active: 'Running', blocked: 'Blocked', done: 'Done' },
    footRunning: (n: number, t: number) => `Running step ${n} of ${t}`,
    footBlocked: (n: number) => `Step ${n} is blocked`,
    footWaiting: (n: number) => `${n} steps to go`,
    footComplete: (t: number) => `All ${t} steps done`,
  },
} as const;

// 执行计划卡：版式参照 Inspora「Agent Plan」（Jeet，https://www.inspora.design/posts/agent-plan）——
// 外层灰壳 + 内层白卡、虚线分隔、右侧状态胶囊、等宽步数胶囊；当前步展开显示说明。
// 只展示 flovart_todo 的最新清单，不做逐步批准 / 跳过（后端没有这条路径）。颜色走 DESIGN §11 状态色。
export function AgentTodoCard({ items, language = 'zho' }: { items: readonly AgentTodoItem[]; language?: 'en' | 'zho' }) {
  const reduce = useReducedMotion();
  if (!items.length) return null;
  const copy = TODO_COPY[language];
  const { done, total } = todoProgress(items);
  const activeIndex = items.findIndex(item => item.status === 'active');
  const blockedIndex = items.findIndex(item => item.status === 'blocked');
  const phase: 'complete' | 'blocked' | 'running' | 'idle' = done === total ? 'complete' : blockedIndex >= 0 ? 'blocked' : activeIndex >= 0 ? 'running' : 'idle';
  const headStatus = phase === 'complete' ? copy.complete : phase === 'blocked' ? copy.blocked : phase === 'running' ? copy.running : copy.done(done, total);
  const foot = phase === 'complete' ? copy.footComplete(total)
    : phase === 'blocked' ? copy.footBlocked(blockedIndex + 1)
    : phase === 'running' ? copy.footRunning(activeIndex + 1, total)
    : copy.footWaiting(total - done);
  return (
    <section className='agent-todo-card agent-plan-card agent-card-on-shell' data-phase={phase} aria-label={copy.title}>
      <header className='agent-plan-card__head'>
        <ListChecks size={14} aria-hidden='true' />
        <strong>{copy.title}</strong>
        <span className='agent-plan-card__pill flv-machine'>{copy.steps(total)}</span>
        <span className='agent-plan-card__status' role='status'>
          {phase !== 'idle' && <span className='agent-plan-card__dot' aria-hidden='true' />}
          {headStatus}
        </span>
      </header>
      <ol className='agent-plan-card__list'>
        {items.map(item => {
          const expanded = Boolean(item.note) && (item.status === 'active' || item.status === 'blocked');
          return (
            <li key={item.id} data-status={item.status}>
              <div className='agent-plan-card__row'>
                <TodoIcon status={item.status} />
                <span className='agent-todo-card__text'>{item.content}</span>
                <AnimatePresence mode='popLayout' initial={false}>
                  <motion.span
                    key={item.status}
                    className='agent-plan-card__state'
                    data-status={item.status}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={reduce ? { duration: 0.1 } : { type: 'spring', visualDuration: 0.2, bounce: 0.2 }}
                  >{copy.status[item.status]}</motion.span>
                </AnimatePresence>
              </div>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    key='note'
                    className='agent-plan-card__detail'
                    initial={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={reduce ? { duration: 0.1 } : { type: 'spring', visualDuration: 0.26, bounce: 0 }}
                  >
                    <span className='agent-todo-card__note'>{item.note}</span>
                  </motion.div>
                )}
              </AnimatePresence>
              {!expanded && item.note && item.status !== 'done' ? <span className='agent-todo-card__note is-quiet'>{item.note}</span> : null}
            </li>
          );
        })}
      </ol>
      <footer className='agent-plan-card__foot'>
        <span className='flv-machine'>{done} / {total}</span>
        <span>{foot}</span>
      </footer>
    </section>
  );
}
