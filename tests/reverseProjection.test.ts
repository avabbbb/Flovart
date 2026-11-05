import { describe, expect, it } from 'vitest';
import { buildShotsFromCuts, readReference } from '../services/reverse/video';
import { planTarget, projectBreakdown, segmentsFromNarrative } from '../services/reverse/target';
import type { ReverseVideoProject } from '../services/reverse/types';

function project(targetScript?: string): Pick<ReverseVideoProject, 'analysis' | 'references' | 'slots' | 'targetScript'> {
  const script = 'one two @{turn}three four@{/turn} five six';
  const reading = readReference(script, 6000);
  const shots = buildShotsFromCuts([2000, 4000], 6000);
  shots[1] = { ...shots[1]!, cue: { kind: 'selection', id: 'turn' }, slotIds: ['s1'] };
  return {
    references: [],
    slots: [{ id: 's1', kind: 'product', label: 'Bottle', original: 'red can', replacement: 'blue can' }],
    analysis: {
      durationMs: 6000, shots, script, words: reading.words, narrative: reading.narrative, alignment: reading.alignment,
      segments: segmentsFromNarrative(reading.narrative, reading.words), analyzedAt: 'fixture', source: 'manual',
    },
    ...(targetScript ? { targetScript } : {}),
  };
}

describe('projectBreakdown', () => {
  it('writes slot swaps into the action and keeps reference timing without a target', () => {
    const bd = projectBreakdown(project(), null);
    expect(bd.shots).toHaveLength(3);
    expect(bd.shots[1]!.action).toContain('Bottle: blue can');
    expect(bd.shots[0]!.durationSec).toBe(2);
  });

  it('uses target windows and target dialogue when a target script exists', () => {
    const p = project('a b c d e f g h @{turn}three four@{/turn} five six');
    const target = planTarget(p);
    expect(target).not.toBeNull();
    const bd = projectBreakdown(p, target);
    expect(bd.sourceText).toContain('a b c');
    const w = target!.windows.find((x) => x.shotId === p.analysis!.shots[1]!.id)!;
    expect(w.anchored).toBe(true);
    expect(bd.shots[1]!.dialogue).toContain('three');
  });

  it('keeps only the shots listed in include', () => {
    const p = project();
    const bd = projectBreakdown(p, null, new Set([p.analysis!.shots[2]!.id]));
    expect(bd.shots.map((s) => s.index)).toEqual([3]);
  });
});
