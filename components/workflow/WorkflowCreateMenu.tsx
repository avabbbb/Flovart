import { ChevronRight, FileText, Image, Music2, StickyNote, Video, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WorkflowNodeType, WorkflowPoint } from './types';

export interface WorkflowCreateMenuState {
  world: WorkflowPoint;
  anchor: WorkflowPoint;
  sourceId?: string;
  targetId?: string;
}

const OPTIONS: Array<{ type: WorkflowNodeType; title: string; titleEn: string; description: string; descriptionEn: string; icon: typeof StickyNote }> = [
  { type: 'image', title: '图片生成', titleEn: 'Image', description: '创建图片生成节点', descriptionEn: 'Create an image generation node', icon: Image },
  { type: 'video', title: '视频生成', titleEn: 'Video', description: '创建视频生成节点', descriptionEn: 'Create a video generation node', icon: Video },
  { type: 'text', title: '备注', titleEn: 'Note', description: '脚本、备注和说明，不参与生成', descriptionEn: 'Scripts, notes and briefs; never sent to generation', icon: StickyNote },
  { type: 'script', title: '脚本节点', titleEn: 'Script', description: '剧本拆解、分镜编排和批量生成', descriptionEn: 'Break down scripts, plan shots, batch generate', icon: FileText },
  { type: 'audio', title: '音频参考', titleEn: 'Audio reference', description: '添加音频参考输入', descriptionEn: 'Add an audio reference input', icon: Music2 },
];

/** Panel width when there is room for the rail + preview; below 420px the CSS container query drops the preview. */
const MENU_WIDTH = 540;
const MENU_EDGE = 8;

/* ── Preview schematics: a node card with its ports, drawn in currentColor/CSS vars. ── */
function Port({ x, y, filled = true }: { x: number; y: number; filled?: boolean }) {
  return <circle className={filled ? 'wcm-port' : 'wcm-port wcm-port--ghost'} cx={x} cy={y} r={4.5} />;
}

function NodeSchematic({ type }: { type: WorkflowNodeType }) {
  const card = (w = 132, h = 92, x = 74, y = 24) => <rect className="wcm-card" x={x} y={y} width={w} height={h} rx={12} />;
  switch (type) {
    case 'image':
      return (
        <svg viewBox="0 0 280 140" aria-hidden="true">
          <path className="wcm-wire" d="M18 70 H74" /><path className="wcm-wire" d="M206 70 H262" />
          {card()}
          <rect className="wcm-fill-soft" x={86} y={36} width={108} height={56} rx={7} />
          <circle className="wcm-accent" cx={172} cy={52} r={7} />
          <path className="wcm-accent-soft" d="M90 88 L118 60 L138 78 L152 66 L190 88 Z" />
          <rect className="wcm-line" x={86} y={100} width={64} height={6} rx={3} />
          <Port x={74} y={70} /><Port x={206} y={70} />
        </svg>
      );
    case 'video':
      return (
        <svg viewBox="0 0 280 140" aria-hidden="true">
          <path className="wcm-wire" d="M18 70 H74" /><path className="wcm-wire" d="M206 70 H262" />
          {card()}
          <rect className="wcm-fill-soft" x={86} y={36} width={108} height={52} rx={7} />
          <path className="wcm-accent" d="M133 50 L151 62 L133 74 Z" />
          <rect className="wcm-line" x={86} y={98} width={108} height={5} rx={2.5} />
          <rect className="wcm-accent" x={86} y={98} width={46} height={5} rx={2.5} />
          <Port x={74} y={70} /><Port x={206} y={70} />
        </svg>
      );
    case 'text':
      return (
        <svg viewBox="0 0 280 140" aria-hidden="true">
          <path className="wcm-card wcm-card--note" d="M84 20 H184 L200 36 V120 H84 Z" />
          <path className="wcm-fold" d="M184 20 V36 H200" />
          <rect className="wcm-line" x={98} y={44} width={84} height={6} rx={3} />
          <rect className="wcm-line" x={98} y={60} width={70} height={6} rx={3} />
          <rect className="wcm-line" x={98} y={76} width={78} height={6} rx={3} />
          <rect className="wcm-line" x={98} y={92} width={44} height={6} rx={3} />
          <Port x={200} y={70} filled={false} />
        </svg>
      );
    case 'script':
      return (
        <svg viewBox="0 0 280 140" aria-hidden="true">
          <path className="wcm-wire" d="M14 70 H40" />
          <path className="wcm-wire" d="M150 70 C 180 70, 180 30, 204 30" />
          <path className="wcm-wire" d="M150 70 H204" />
          <path className="wcm-wire" d="M150 70 C 180 70, 180 110, 204 110" />
          {card(110, 96, 40, 22)}
          {[38, 56, 74, 92].map((y, i) => (
            <g key={y}>
              <rect className={i === 0 ? 'wcm-accent' : 'wcm-fill-soft'} x={52} y={y} width={12} height={10} rx={3} />
              <rect className="wcm-line" x={70} y={y + 2} width={i % 2 ? 56 : 68} height={6} rx={3} />
            </g>
          ))}
          {[30, 70, 110].map(y => <rect key={y} className="wcm-card wcm-card--mini" x={204} y={y - 12} width={56} height={24} rx={7} />)}
          <Port x={40} y={70} /><Port x={150} y={70} />
        </svg>
      );
    case 'audio':
    default:
      return (
        <svg viewBox="0 0 280 140" aria-hidden="true">
          <path className="wcm-wire" d="M206 70 H262" />
          {card()}
          {[10, 22, 34, 18, 40, 28, 14, 30, 20, 36, 12, 24, 16].map((h, i) => (
            <rect key={i} className={i < 6 ? 'wcm-accent' : 'wcm-line'} x={88 + i * 8} y={68 - h / 2} width={4} height={h} rx={2} />
          ))}
          <Port x={206} y={70} />
        </svg>
      );
  }
}

export function WorkflowCreateMenu({ state, onCreate, onClose, language = 'zho' }: {
  state: WorkflowCreateMenuState;
  onCreate: (type: WorkflowNodeType) => void;
  onClose: () => void;
  language?: 'en' | 'zho';
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const en = language === 'en';
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number }>({ left: state.anchor.x, top: state.anchor.y, width: MENU_WIDTH });

  // Fit inside the positioned canvas: width shrinks with the container (which collapses the layout via
  // the container query), and the anchor is clamped so the wider panel never spills off-screen.
  useLayoutEffect(() => {
    const el = rootRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent) return;
    const place = () => {
      const pw = parent.clientWidth;
      const ph = parent.clientHeight;
      const width = Math.max(200, Math.min(MENU_WIDTH, pw - MENU_EDGE * 2));
      const height = el.offsetHeight;
      setBox({
        width,
        left: Math.max(MENU_EDGE, Math.min(state.anchor.x, pw - width - MENU_EDGE)),
        top: Math.max(MENU_EDGE, Math.min(state.anchor.y, ph - height - MENU_EDGE)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(parent);
    observer.observe(el);
    return () => observer.disconnect();
  }, [state.anchor.x, state.anchor.y]);

  useEffect(() => {
    const first = listRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    first?.focus();
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
    const focusedIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = focusedIndex < 0 ? 0 : (focusedIndex + 1) % items.length;
    if (event.key === 'ArrowUp') nextIndex = focusedIndex < 0 ? 0 : (focusedIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && focusedIndex >= 0) {
      event.preventDefault();
      items[focusedIndex].click();
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  const active = OPTIONS[activeIndex] ?? OPTIONS[0];
  const ActiveIcon = active.icon;
  const pillSpring = reduceMotion ? { duration: 0 } : { type: 'spring' as const, stiffness: 520, damping: 40, mass: 0.6 };
  const previewVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: reduceMotion ? { duration: 0 } : { duration: 0.16, staggerChildren: 0.04 } },
    exit: { opacity: 0, transition: { duration: reduceMotion ? 0 : 0.09 } },
  };
  const rise = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 8 },
    show: { opacity: 1, y: 0, transition: reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const } },
  };

  return (
    <motion.div
      ref={rootRef}
      role="menu"
      aria-label={en ? 'New node' : '新建节点'}
      data-workflow-overlay
      data-workflow-create-menu
      className="workflow-create-menu"
      style={{ position: 'absolute', left: box.left, top: box.top, width: box.width }}
      initial={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduceMotion ? 0 : -8 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      onPointerDown={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div className="workflow-create-menu__layout">
        <div className="workflow-create-menu__rail">
          <div className="workflow-create-menu__header">
            <span>{state.sourceId ? (en ? 'Generate from this node' : '引用该节点生成') : state.targetId ? (en ? 'Create upstream for this node' : '为此节点创建上游') : (en ? 'New node' : '新建节点')}</span>
            <button type="button" aria-label={en ? 'Close new node menu' : '关闭新建节点'} onClick={onClose}><X size={15} /></button>
          </div>
          <div ref={listRef} className="workflow-create-menu__list">
            {OPTIONS.map((option, index) => {
              const Icon = option.icon;
              const isActive = index === activeIndex;
              return (
                <motion.button
                  key={option.type}
                  type="button"
                  role="menuitem"
                  className="workflow-create-menu__item"
                  data-active={isActive || undefined}
                  onClick={() => onCreate(option.type)}
                  onPointerEnter={event => { setActiveIndex(index); event.currentTarget.focus({ preventScroll: true }); }}
                  onFocus={() => setActiveIndex(index)}
                  initial={{ opacity: 0, x: reduceMotion ? 0 : -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 34, mass: 0.5, delay: 0.02 * index }}
                >
                  {isActive && <motion.span layoutId="workflow-create-menu-pill" className="workflow-create-menu__pill" transition={pillSpring} />}
                  <span className="workflow-create-menu__item-icon"><Icon size={16} /></span>
                  <span className="workflow-create-menu__item-text">
                    <span className="workflow-create-menu__item-title">{en ? option.titleEn : option.title}</span>
                    <span className="workflow-create-menu__item-desc">{en ? option.descriptionEn : option.description}</span>
                  </span>
                  <motion.span
                    className="workflow-create-menu__item-arrow"
                    aria-hidden="true"
                    initial={false}
                    animate={{ opacity: isActive ? 1 : 0, x: isActive || reduceMotion ? 0 : -6 }}
                    transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 34 }}
                  >
                    <ChevronRight size={15} />
                  </motion.span>
                </motion.button>
              );
            })}
          </div>
        </div>
        <div className="workflow-create-menu__preview" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={active.type} className="workflow-create-menu__preview-inner" variants={previewVariants} initial="hidden" animate="show" exit="exit">
              <motion.div className="workflow-create-menu__visual" variants={rise}>
                <NodeSchematic type={active.type} />
              </motion.div>
              <motion.div className="workflow-create-menu__preview-title" variants={rise}>
                <span className="workflow-create-menu__preview-icon"><ActiveIcon size={14} /></span>
                {en ? active.titleEn : active.title}
              </motion.div>
              <motion.p className="workflow-create-menu__preview-desc" variants={rise}>{en ? active.descriptionEn : active.description}</motion.p>
              <motion.div className="workflow-create-menu__preview-hint" variants={rise}>
                <kbd>↵</kbd>{en ? 'Create' : '创建'}<kbd>↑↓</kbd>{en ? 'Move' : '切换'}<kbd>Esc</kbd>{en ? 'Close' : '关闭'}
              </motion.div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
