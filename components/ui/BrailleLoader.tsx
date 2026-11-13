import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';
import '../../styles/tags.css';

/**
 * 盲文点阵 loader：一个 2×4 盲文格，点按帧淡入淡出、逐点“生长再收回”，
 * 用于异步创建等短等待。帧直接写成 Unicode 盲文字符，按码位解出 8 个点。
 * 减弱动态时停在满格的静态字形，不跑定时器。
 */
const FRAMES = ['⠁', '⠃', '⠇', '⡇', '⣇', '⣧', '⣷', '⣿', '⣾', '⣼', '⣸', '⢸', '⠸', '⠘', '⠈', '⠀'];
// 盲文位序 → 网格 (列, 行)：点1-3 左列上中下，点4-6 右列，点7/8 第四行左右。
const BIT_TO_CELL: Array<[number, number]> = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]];

function frameBits(glyph: string): boolean[] {
  const mask = (glyph.codePointAt(0) ?? 0x2800) - 0x2800;
  return BIT_TO_CELL.map((_, bit) => Boolean(mask & (1 << bit)));
}

export function BrailleLoader({ size = 14, interval = 90, label, className }: {
  /** 整个点阵的高度（px），宽度按点径和间距推出。 */
  size?: number;
  interval?: number;
  /** 读屏文字，如“正在创建”。 */
  label?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [frame, setFrame] = useState(7);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setFrame(f => (f + 1) % FRAMES.length), interval);
    return () => window.clearInterval(id);
  }, [interval, reduce]);

  const bits = frameBits(FRAMES[reduce ? 7 : frame]);
  // 4 行点 + 3 道间隙 = size；列间距与行间距相同，宽度由点径推出。
  const dot = Math.max(2, Math.round(size / 6));
  const gap = Math.max(1, (size - dot * 4) / 3);
  return (
    <span
      role="status"
      aria-label={label}
      className={'flv-braille' + (className ? ' ' + className : '')}
      style={{ height: size, width: dot * 2 + gap * 1.2, gap: `${gap}px ${gap * 1.2}px`, ['--braille-dot' as string]: `${dot}px` }}
    >
      {BIT_TO_CELL.map(([col, row], bit) => (
        <motion.i
          key={bit}
          style={{ gridColumn: col + 1, gridRow: row + 1 }}
          initial={false}
          animate={{ opacity: bits[bit] ? 1 : 0.16, scale: bits[bit] ? 1 : 0.55 }}
          transition={reduce ? { duration: 0 } : { duration: 0.15, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}
