import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * 斜叠卡片（DESIGN.md §9.5）：多张图叠成一摞，后面两张左右斜出，悬停时散开。
 * 用于 Agent 对话里的多图附件；画布批次叠放（WorkflowBatchStack）沿用同一套角度和弹簧。
 */
export const FAN_SPRING = { type: 'spring', stiffness: 420, damping: 26, mass: 0.7 } as const;

/** 第 i 张后层（0 = 左，1 = 右）在静止 / 悬停时的姿态，单位：百分比位移 + 度。 */
export function fanPose(slot: number, hovered: boolean) {
  const side = slot % 2 === 0 ? -1 : 1;
  const depth = Math.floor(slot / 2) + 1;
  const spread = hovered ? 1.6 : 1;
  return {
    x: `${side * 11 * depth * spread}%`,
    y: `${(hovered ? -2 : 3) * depth}%`,
    rotate: side * (hovered ? 9 : 5.5) * depth,
    scale: 1 - depth * 0.07,
  };
}

export interface ImageFanItem { id: string; src: string; alt?: string }

export function ImageFan({ items, max = 3, onOpen, className, children }: {
  items: ImageFanItem[];
  max?: number;
  onOpen?: (index: number) => void;
  className?: string;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const shown = items.slice(0, max);
  const [front, ...back] = shown;
  if (!front) return null;
  return (
    <motion.div
      className={'image-fan' + (className ? ' ' + className : '')}
      initial="rest"
      animate="rest"
      whileHover={reduce ? undefined : 'hover'}
      whileFocus={reduce ? undefined : 'hover'}
      data-count={items.length}
    >
      {back.map((item, slot) => (
        <motion.button
          type="button"
          key={item.id}
          className="image-fan__card image-fan__card--back"
          style={{ zIndex: 1 + (back.length - slot) }}
          variants={{ rest: fanPose(slot, false), hover: fanPose(slot, true) }}
          transition={FAN_SPRING}
          onClick={() => onOpen?.(slot + 1)}
          aria-label={item.alt}
          tabIndex={-1}
        >
          <img src={item.src} alt="" draggable={false} />
        </motion.button>
      ))}
      <motion.button
        type="button"
        className="image-fan__card image-fan__card--front"
        style={{ zIndex: 10 }}
        variants={{ rest: { y: 0, scale: 1 }, hover: { y: '-3%', scale: 1.02 } }}
        transition={FAN_SPRING}
        onClick={() => onOpen?.(0)}
        aria-label={front.alt}
      >
        <img src={front.src} alt={front.alt ?? ''} draggable={false} />
        {items.length > 1 && <span className="image-fan__count">{items.length}</span>}
      </motion.button>
      {children}
    </motion.div>
  );
}
