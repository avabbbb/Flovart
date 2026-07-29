// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { auditVoxProductionSpec } from '../tools/flovart/vox-director-quality.js';

const approvedVoxSpec = {
  schemaVersion: 'flovart.production-spec/1',
  delivery: { durationMs: 60_000 },
  narrative: {
    arc: 'how_it_works',
    beats: Array.from({ length: 6 }, (_, beatIndex) => ({
      id: `beat-${beatIndex + 1}`,
      narration: '一段完整的解释性旁白。',
      hook: beatIndex === 0 ? 'direct_question' : undefined,
      shots: [
        {
          id: `shot-${beatIndex + 1}a`,
          durationMs: 6_000,
          scene: '分层纸张剪影、报纸碎片和制度图解。',
        },
        {
          id: `shot-${beatIndex + 1}b`,
          durationMs: 4_000,
          scene: '关键细节的纸张拼贴特写。',
        },
      ],
    })),
  },
  audio: {
    narration: { voiceProfile: 'documentary' },
    music: { intent: 'rhythmic editorial instrumental', duckUnderNarration: true },
  },
  gates: [
    { id: 'approve-spec', type: 'spec', status: 'approved' },
    { id: 'approve-style', type: 'style-reference', status: 'approved' },
    { id: 'review-keyframes', type: 'keyframe-review', status: 'required' },
    { id: 'verify-ocr', type: 'ocr', status: 'required' },
  ],
  extensions: {
    'vox-director': {
      schemaVersion: '1',
      themeCandidates: ['american-retro', 'punk-zine', 'soviet-constructivist'],
      selectedTheme: 'american-retro',
      look: {
        idiom: 'mixed-media hand-cut paper collage',
        palette: ['warm-cream', 'deep-red', 'ink-black', 'cold-blue'],
        typeStyle: 'cut-out-headline',
        finish: ['torn-edge', 'halftone', 'newsprint', 'tape', 'print-grain'],
        motionStyle: 'punchy',
        constraints: 'strict',
      },
      shotDirectives: Object.fromEntries(Array.from({ length: 6 }, (_, beatIndex) => [
        [
          `shot-${beatIndex + 1}a`,
          {
            shotSize: 'WIDE',
            cameraMove: beatIndex % 3 === 0 ? 'push_in' : beatIndex % 3 === 1 ? 'pan' : 'parallax',
            elementMotion: '多层纸片滑入，箭头展开，半调网点脉动',
            headlineLocked: true,
          },
        ],
        [
          `shot-${beatIndex + 1}b`,
          {
            shotSize: 'CLOSE',
            cameraMove: beatIndex % 2 === 0 ? 'static' : 'pull_out',
            elementMotion: '一个关键纸片元素展开后稳定落位',
            headlineLocked: false,
          },
        ],
      ]).flat()),
    },
  },
};

describe('VOX Skill quality gate', () => {
  it('rejects a generic paper-cut plan that lost the Director extension', () => {
    const result = auditVoxProductionSpec({
      schemaVersion: '1',
      durationSec: 60,
      beats: Array.from({ length: 10 }, (_, index) => ({
        start: index * 6,
        end: index * 6 + 6,
        visual: index % 2 ? 'image' : 'video',
        message: '通用政治信息图',
      })),
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VOX_EXTENSION_MISSING' }),
      expect.objectContaining({ code: 'KEYFRAME_GATE_MISSING' }),
    ]));
  });

  it('accepts an approved VOX plan with rich collage look and two-shot beats', () => {
    const result = auditVoxProductionSpec(approvedVoxSpec);

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.metrics).toMatchObject({ beatCount: 6, shotCount: 12 });
  });
});
