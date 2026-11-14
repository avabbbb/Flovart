import { describe, expect, it } from 'vitest';
import { toProductionSpecV1 } from '../tools/flovart/pipeline/render.js';
import { validateProductionSpec, type ProductionSpecV1 } from '../services/reverse/productionSpec';
import { dbToLinearVolume, overlayLayout, voiceActiveAt } from '../services/reverse/remotionAdapter';

const specV2 = {
  output: { width: 1080, height: 1920, fps: 30, durationMs: 4000 },
  tracks: {
    visual: [{ id: 'v1', artifactId: 'img', startMs: 0, durationMs: 4000, locked: true }],
    text: [{ id: 't1', text: '截图进去，宣传片出来', startMs: 500, durationMs: 1500, position: 'top', size: 72, locked: false }],
    captions: [{ id: 'c1', lineId: 'L1', displayText: '一句话字幕', startMs: 1000, durationMs: 2000, locked: false }],
    audio: [
      { id: 'a1', role: 'voice', artifactId: 'vo', startMs: 1000, durationMs: 2000, gainDb: 0, locked: false },
      { id: 'a2', role: 'music', artifactId: 'bed', startMs: 0, gainDb: -6, locked: false },
    ],
  },
};

describe('Remotion engine: spec V2 → ProductionSpec V1 with text / captions / audio', () => {
  it('carries every track in frames with static asset refs', () => {
    const spec = toProductionSpecV1(specV2, 'run_1', (id: string) => `static:${id}.bin`) as unknown as ProductionSpecV1;
    expect(spec.output).toEqual({ width: 1080, height: 1920, fps: 30, durationFrames: 120 });
    expect(spec.shots[0]).toMatchObject({ shotId: 'v1', startFrame: 0, durationFrames: 120, assetRef: 'static:img.bin', locked: true });
    expect(spec.texts).toEqual([{ id: 't1', text: '截图进去，宣传片出来', startFrame: 15, durationFrames: 45, position: 'top', size: 72 }]);
    expect(spec.captions).toEqual([{ id: 'c1', text: '一句话字幕', startFrame: 30, durationFrames: 60 }]);
    expect(spec.audio).toEqual([
      { id: 'a1', role: 'voice', src: 'static:vo.bin', startFrame: 30, durationFrames: 60, gainDb: 0 },
      { id: 'a2', role: 'music', src: 'static:bed.bin', startFrame: 0, gainDb: -6, duck: true },
    ]);
    expect(validateProductionSpec(spec)).toEqual([]);
  });

  it('rejects malformed overlay tracks', () => {
    const spec = toProductionSpecV1(specV2, 'run_1', (id: string) => `static:${id}`) as unknown as Required<ProductionSpecV1>;
    // @ts-expect-error -- deliberately invalid position
    spec.texts[0].position = 'left';
    spec.captions[0].durationFrames = 0;
    spec.audio[0].src = '';
    expect(validateProductionSpec(spec)).toEqual([
      'text t1: position 无效',
      'caption c1: durationFrames 必须是正整数',
      'audio a1: src 不能为空',
    ]);
  });

  it('ducks music only while a voice clip is audible and caps gain at unity', () => {
    const audio = [{ role: 'voice', startFrame: 30, durationFrames: 60 }, { role: 'music', startFrame: 0 }];
    expect(voiceActiveAt(29, audio, 120)).toBe(false);
    expect(voiceActiveAt(30, audio, 120)).toBe(true);
    expect(voiceActiveAt(90, audio, 120)).toBe(false);
    expect(dbToLinearVolume(-6)).toBeCloseTo(0.501, 3);
    expect(dbToLinearVolume(6)).toBe(1);
  });

  it('lays text out on the same proportions as the ffmpeg engine', () => {
    expect(overlayLayout('top', 1920)).toEqual({ top: 192 });
    expect(overlayLayout('bottom', 1920)).toEqual({ bottom: 422 });
    expect(overlayLayout('center', 1920)).toEqual({ top: '50%', transform: 'translateY(-50%)' });
  });
});
