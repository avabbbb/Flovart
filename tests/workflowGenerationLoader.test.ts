import { describe, expect, it } from 'vitest';
import {
  SUBMITTED_MESSAGE,
  TRANSCODE_MESSAGE,
  deriveGenerationPhase,
  formatGenerationElapsed,
  gridDivisions,
  lastGenerationRun,
  phaseGridLevel,
  seededRandom,
  trackGenerationRun,
} from '../components/workflow/generationLoader';

describe('deriveGenerationPhase', () => {
  it('maps only real generation signals to phases', () => {
    expect(deriveGenerationPhase({ status: 'loading', progress: 0 })).toBe('prepare');
    expect(deriveGenerationPhase({ status: 'loading', generationMessage: TRANSCODE_MESSAGE })).toBe('transcode');
    expect(deriveGenerationPhase({ status: 'loading', generationTransfer: { phase: 'upload', loaded: 10 } })).toBe('upload');
    expect(deriveGenerationPhase({ status: 'loading', generationMessage: SUBMITTED_MESSAGE })).toBe('queue');
    expect(deriveGenerationPhase({ status: 'loading', generationTransfer: { phase: 'queue', polls: 2 } })).toBe('queue');
    expect(deriveGenerationPhase({ status: 'loading', generationMessage: 'RUNNING (3)' })).toBe('generate');
    expect(deriveGenerationPhase({ status: 'loading', progress: 42 })).toBe('generate');
    expect(deriveGenerationPhase({ status: 'loading', generationTransfer: { phase: 'download', loaded: 1, total: 2 } })).toBe('download');
    expect(deriveGenerationPhase({ status: 'loading', progress: 100 })).toBe('write');
  });

  it('orders grid levels coarse to fine by phase', () => {
    expect(phaseGridLevel('prepare')).toBe(0);
    expect(phaseGridLevel('queue')).toBe(1);
    expect(phaseGridLevel('generate')).toBe(2);
    expect(phaseGridLevel('write')).toBe(3);
  });
});

describe('grid sizing', () => {
  it('drops subdivisions that would make cells smaller than 9px on small nodes', () => {
    expect(gridDivisions(3, 240)).toBe(12);
    expect(gridDivisions(3, 80)).toBe(8);
    expect(gridDivisions(3, 30)).toBe(2);
    expect(gridDivisions(0, 240)).toBe(2);
  });
});

describe('trackGenerationRun', () => {
  it('only moves the grid level forward within one run and resets for a new start', () => {
    expect(trackGenerationRun('n1', 1000, 'generate').level).toBe(2);
    expect(trackGenerationRun('n1', 1000, 'queue').level).toBe(2);
    expect(trackGenerationRun('n1', 1000, 'download').level).toBe(3);
    expect(trackGenerationRun('n1', 2000, 'prepare')).toEqual({ startedAt: 2000, level: 0 });
    expect(lastGenerationRun('n1')?.startedAt).toBe(2000);
  });
});

describe('helpers', () => {
  it('formats elapsed time and gives deterministic noise', () => {
    expect(formatGenerationElapsed(9400)).toBe('9.4s');
    expect(formatGenerationElapsed(65000)).toBe('1:05');
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a()]).toEqual([b(), b()]);
  });
});
