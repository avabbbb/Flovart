// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { beatGridCuts, STILL_MOTION_TYPES, stillMotionFrame } from '../services/reverse/stillMotion';
import { MOTION_TYPES, validateSpec } from '../tools/flovart/pipeline/spec.js';
import { toProductionSpecV1 } from '../tools/flovart/pipeline/render.js';

const noEdge = (state: ReturnType<typeof stillMotionFrame>) => {
  const room = ((state.scale - 1) / 2) * 100 + 1e-9;
  return Math.abs(state.x) <= room && Math.abs(state.y) <= room && state.scale >= 1;
};

describe('still motion', () => {
  it('keeps the JS pipeline list in sync with the renderer', () => {
    expect([...MOTION_TYPES]).toEqual([...STILL_MOTION_TYPES]);
  });

  it('push grows, pull shrinks, pans travel edge to edge without showing the border', () => {
    expect(stillMotionFrame({ type: 'push' }, 0, 30).scale).toBe(1);
    expect(stillMotionFrame({ type: 'push' }, 29, 30).scale).toBeCloseTo(1.12);
    expect(stillMotionFrame({ type: 'pull' }, 29, 30).scale).toBeCloseTo(1);
    const start = stillMotionFrame({ type: 'pan-left' }, 0, 30);
    const end = stillMotionFrame({ type: 'pan-left' }, 29, 30);
    expect(start.x).toBeGreaterThan(0);
    expect(end.x).toBeCloseTo(-start.x);
    for (const type of STILL_MOTION_TYPES) {
      for (let frame = 0; frame < 24; frame += 1) expect(noEdge(stillMotionFrame({ type }, frame, 24))).toBe(true);
    }
  });

  it('shake and impact are deterministic, impact flashes on the hit', () => {
    expect(stillMotionFrame({ type: 'shake' }, 5, 20)).toEqual(stillMotionFrame({ type: 'shake' }, 5, 20));
    expect(stillMotionFrame({ type: 'impact' }, 0, 20).flash).toBe(1);
    expect(stillMotionFrame({ type: 'impact' }, 10, 20).flash).toBe(0);
    expect(stillMotionFrame({ type: 'none', flash: true }, 1, 20).flash).toBeCloseTo(0.75);
  });

  it('cuts shots on the beat grid', () => {
    const cuts = beatGridCuts({ bpm: 120, durationMs: 4000, beatsPerShot: [2, 1, 1] });
    expect(cuts).toEqual([
      { startMs: 0, durationMs: 1000 }, { startMs: 1000, durationMs: 500 }, { startMs: 1500, durationMs: 500 },
      { startMs: 2000, durationMs: 1000 }, { startMs: 3000, durationMs: 500 }, { startMs: 3500, durationMs: 500 },
    ]);
    expect(beatGridCuts({ bpm: 120, offsetMs: 250, durationMs: 1250, beatsPerShot: 2 })).toEqual([
      { startMs: 0, durationMs: 250 }, { startMs: 250, durationMs: 1000 },
    ]);
  });

  it('validates motion in the pipeline spec and passes it to the Remotion shot', () => {
    const spec = {
      schemaVersion: 2,
      output: { width: 1280, height: 720, fps: 30, durationMs: 1000 },
      tracks: {
        visual: [{ id: 's1', kind: 'image', artifactId: 'a1', startMs: 0, durationMs: 1000, locked: false, motion: { type: 'impact', amount: 0.1 } }],
        text: [], captions: [], audio: [],
      },
    };
    expect(validateSpec(spec)).toEqual([]);
    expect(validateSpec({ ...spec, tracks: { ...spec.tracks, visual: [{ ...spec.tracks.visual[0], motion: { type: 'spin' } }] } })[0]).toMatch(/motion.type/);
    const v1 = toProductionSpecV1(spec, 'run-1', (id: string) => `static:${id}.png`);
    expect(v1.shots[0].motion).toEqual({ type: 'impact', amount: 0.1 });
  });
});

describe('still-mad skill package', () => {
  it('ships an example spec that validates and never repeats a move on adjacent shots', async () => {
    const { readFile } = await import('node:fs/promises');
    const spec = JSON.parse(await readFile('.agents/skills/still-mad/examples/pipeline-spec.json', 'utf8'));
    expect(validateSpec(spec)).toEqual([]);
    const visual = spec.tracks.visual as Array<{ startMs: number; durationMs: number; motion: { type: string } }>;
    visual.slice(1).forEach((clip, index) => {
      expect(clip.motion.type).not.toBe(visual[index].motion.type);
      expect(clip.startMs).toBe(visual[index].startMs + visual[index].durationMs);
    });
    expect(spec.tracks.audio[0]).toMatchObject({ role: 'music', duck: false });
  });

  it('passes skill.validate', async () => {
    const { runSkillCommand } = await import('../tools/flovart/skill-commands.js');
    const result = await runSkillCommand('skill.validate', { fromDir: '.agents/skills/still-mad' });
    expect(result).toMatchObject({ ok: true, manifest: { id: 'community.still-mad' } });
  });
});
