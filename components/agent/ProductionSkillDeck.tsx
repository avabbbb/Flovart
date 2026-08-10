import { Puzzle, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState, type RefObject } from 'react';

import {
  createProductionSkillAttachment,
  listBundledProductionSkills,
  type ProductionSkillAttachment,
} from '../../services/productionSkillCatalog';

export function ProductionSkillDeck({
  attachment,
  onChange,
  dropTargetRef,
}: {
  attachment?: ProductionSkillAttachment;
  onChange: (attachment?: ProductionSkillAttachment) => void;
  dropTargetRef: RefObject<HTMLElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const reduceMotion = useReducedMotion();

  const attach = async (id: string) => {
    const skill = listBundledProductionSkills().find(item => item.id === id);
    if (!skill || loading) return;
    setLoading(true);
    try {
      onChange(await createProductionSkillAttachment(skill));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const droppedInComposer = (point: { x: number; y: number }) => {
    const rect = dropTargetRef.current?.getBoundingClientRect();
    return Boolean(rect
      && point.x >= rect.left && point.x <= rect.right
      && point.y >= rect.top && point.y <= rect.bottom);
  };

  return (
    <div className="relative">
      {attachment ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold"
          style={{ background: 'var(--isl-mint-bg, color-mix(in srgb, var(--wf-accent) 14%, transparent))', color: 'var(--isl-mint-deep, var(--wf-accent))' }}
        >
          <Puzzle size={11} />{attachment.displayName}<span className="opacity-60">v{attachment.version}</span>
          <button type="button" aria-label={`移除 ${attachment.displayName}`} onClick={() => onChange(undefined)}><X size={11} /></button>
        </span>
      ) : (
        <button
          type="button"
          aria-label="选择制作 Skill"
          className="inline-flex items-center gap-1 px-1 text-[10px] font-semibold"
          style={{ color: 'var(--isl-ink-soft, var(--wf-text-soft, var(--wf-text)))' }}
          onClick={() => setOpen(value => !value)}
        >
          <Puzzle size={12} />Skill
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className="absolute bottom-full left-0 z-20 mb-2 w-60 rounded-xl p-2"
            style={{ background: 'var(--isl-surface, var(--wf-panel))', border: '1px solid var(--isl-line, var(--wf-border))' }}
          >
            {listBundledProductionSkills().map(skill => (
              <motion.button
                key={skill.id}
                type="button"
                aria-label={`添加 ${skill.displayName}`}
                disabled={loading}
                whileHover={reduceMotion ? undefined : { y: -2 }}
                whileTap={reduceMotion ? undefined : { scale: 0.97 }}
                whileDrag={reduceMotion ? undefined : { scale: 1.05, rotate: -2 }}
                drag
                dragElastic={0.14}
                dragSnapToOrigin
                onDragEnd={(_, info) => { if (droppedInComposer(info.point)) void attach(skill.id); }}
                transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                className="block w-full rounded-lg p-2 text-left"
                style={{ background: 'var(--isl-surface-2, var(--wf-panel))', color: 'var(--isl-ink, var(--wf-text))' }}
                onClick={() => void attach(skill.id)}
              >
                <strong className="block text-xs">{skill.displayName}</strong>
                <span className="mt-0.5 block text-[10px]" style={{ color: 'var(--isl-ink-soft, var(--wf-text-soft, var(--wf-text)))' }}>{skill.description}</span>
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
