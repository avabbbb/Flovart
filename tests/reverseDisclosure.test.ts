import { describe, expect, it } from 'vitest';
import { currentStep, initialOpen, newlyUnlocked, reverseSteps, type ReverseStepFacts } from '../services/reverse/disclosure';

const base: ReverseStepFacts = { references: 0, shots: 0, hasTarget: false, axes: 0, hasFrame: false };

describe('reverse step disclosure', () => {
  it('fresh project: only reference and analysis are unlocked and open', () => {
    const steps = reverseSteps(base);
    expect(steps.filter((s) => s.unlocked).map((s) => s.id)).toEqual(['reference', 'analysis']);
    expect(currentStep(steps)).toBe('reference');
    expect(initialOpen(steps)).toEqual({ reference: true, analysis: true, target: false, variants: false, canvas: false });
  });

  it('shots unlock target, variants and canvas; finished analysis folds on entry', () => {
    const steps = reverseSteps({ ...base, references: 1, shots: 3 });
    expect(currentStep(steps)).toBe('target');
    expect(initialOpen(steps)).toEqual({ reference: false, analysis: false, target: true, variants: true, canvas: true });
  });

  it('an optional step left empty stays open before the current step', () => {
    const steps = reverseSteps({ ...base, shots: 3 });
    expect(currentStep(steps)).toBe('reference');
    expect(initialOpen(steps).reference).toBe(true);
    expect(initialOpen(steps).analysis).toBe(true);
  });

  it('everything done: only the last step is open', () => {
    const steps = reverseSteps({ references: 1, shots: 3, hasTarget: true, axes: 1, hasFrame: true });
    expect(steps.every((s) => s.complete)).toBe(true);
    expect(currentStep(steps)).toBe('canvas');
    expect(initialOpen(steps)).toEqual({ reference: false, analysis: false, target: false, variants: false, canvas: true });
  });

  it('a locked step is never complete', () => {
    const steps = reverseSteps({ ...base, hasTarget: true, axes: 2, hasFrame: true });
    expect(steps.find((s) => s.id === 'canvas')).toEqual({ id: 'canvas', unlocked: false, complete: false });
  });

  it('reports steps unlocked since the previous render', () => {
    const prev = new Set(['reference', 'analysis'] as const);
    expect(newlyUnlocked(prev, reverseSteps({ ...base, shots: 2 }))).toEqual(['target', 'variants', 'canvas']);
    expect(newlyUnlocked(prev, reverseSteps(base))).toEqual([]);
  });
});
