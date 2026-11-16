// 三档弹簧的 JS 镜像（与 styles/motion.css 的 --spring-* 同值，DESIGN.md §14.3）。
// WAAPI / View Transitions 动画用 easing + duration；motion 组件用 visualDuration + bounce。
export const SPRING = {
  snappy: {
    visualDuration: 0.22,
    bounce: 0,
    duration: 330,
    easing: 'linear(0, 0.121, 0.331, 0.528, 0.681, 0.791, 0.866, 0.915, 0.946, 0.967, 0.98, 0.988, 0.992, 0.995, 0.997, 0.998, 1)',
  },
  smooth: {
    visualDuration: 0.35,
    bounce: 0,
    duration: 520,
    easing: 'linear(0, 0.119, 0.328, 0.522, 0.676, 0.787, 0.863, 0.914, 0.946, 0.966, 0.979, 0.987, 0.992, 0.995, 0.997, 0.998, 1)',
  },
  expressive: {
    visualDuration: 0.42,
    bounce: 0.2,
    duration: 565,
    easing: 'linear(0, 0.108, 0.317, 0.534, 0.713, 0.841, 0.926, 0.976, 1.002, 1.012, 1.015, 1.013, 1.01, 1.007, 1.004, 1.002, 1)',
  },
} as const;

/** 老内核不认 linear()：退回无过冲的 --ease-emphasis。 */
export function springEasing(name: keyof typeof SPRING): string {
  const easing = SPRING[name].easing;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && !CSS.supports('transition-timing-function', easing)) {
    return 'cubic-bezier(0.16, 1, 0.3, 1)';
  }
  return easing;
}
