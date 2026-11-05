// 逆向面板的分步披露：步骤按数据依赖解锁；展开状态是纯 UI 状态，不进持久化。
export type ReverseStepId = 'reference' | 'analysis' | 'target' | 'variants' | 'canvas';

export const REVERSE_STEPS: readonly ReverseStepId[] = ['reference', 'analysis', 'target', 'variants', 'canvas'];

export interface ReverseStepFacts {
  references: number;
  shots: number;
  hasTarget: boolean;
  axes: number;
  hasFrame: boolean;
}

export interface ReverseStepState {
  id: ReverseStepId;
  unlocked: boolean;
  complete: boolean;
}

export type ReverseStepOpen = Record<ReverseStepId, boolean>;

// 参考与拆解始终可用（可以直接贴转写稿）；目标稿 / 变体 / 画布都依赖镜头表。
export function reverseSteps(f: ReverseStepFacts): ReverseStepState[] {
  const hasShots = f.shots > 0;
  const facts: Record<ReverseStepId, readonly [boolean, boolean]> = {
    reference: [true, f.references > 0],
    analysis: [true, hasShots],
    target: [hasShots, f.hasTarget],
    variants: [hasShots, f.axes > 0],
    canvas: [hasShots, f.hasFrame],
  };
  return REVERSE_STEPS.map((id) => ({ id, unlocked: facts[id][0], complete: facts[id][0] && facts[id][1] }));
}

// 当前步骤：第一个已解锁但未完成的；全部完成时是最后一步。
export function currentStep(steps: readonly ReverseStepState[]): ReverseStepId {
  return (steps.find((s) => s.unlocked && !s.complete) ?? steps[steps.length - 1])?.id ?? 'reference';
}

// 进入面板时：当前步骤之前已完成的折叠成摘要，其余已解锁的展开，未解锁的只留标题。
export function initialOpen(steps: readonly ReverseStepState[]): ReverseStepOpen {
  const current = steps.findIndex((s) => s.id === currentStep(steps));
  const open = { reference: false, analysis: false, target: false, variants: false, canvas: false } as ReverseStepOpen;
  steps.forEach((s, i) => {
    open[s.id] = s.unlocked && !(s.complete && i < current);
  });
  return open;
}

// 编辑中新解锁的步骤自动展开；已展开的不会因完成而自动收起，避免内容在手下跳走。
export function newlyUnlocked(prev: ReadonlySet<ReverseStepId>, steps: readonly ReverseStepState[]): ReverseStepId[] {
  return steps.filter((s) => s.unlocked && !prev.has(s.id)).map((s) => s.id);
}
