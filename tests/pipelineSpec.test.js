// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyPatch, clipsForFindings, diffSpecs, emptySpec, lockedClipsUnchanged, validateSpec } from '../tools/flovart/pipeline/spec.js';
import { alignLines, alignTokens, fixtureWords, tokenize } from '../tools/flovart/pipeline/voice.js';
import { findingsSignature, validateFindings } from '../tools/flovart/pipeline/review.js';
import { buildFfmpegCommand } from '../tools/flovart/pipeline/render.js';

const base = () => applyPatch(emptySpec({ width: 1080, height: 1920 }), [
  { op: 'add', track: 'visual', clip: { id: 'a', kind: 'image', artifactId: 'art_a', startMs: 0, durationMs: 4000 } },
  { op: 'add', track: 'visual', clip: { id: 'card', kind: 'color', color: 'yellow', startMs: 3000, durationMs: 500 } },
  { op: 'add', track: 'captions', clip: { id: 'cap', displayText: '字幕', startMs: 200, durationMs: 1800 } },
  { op: 'add', track: 'audio', clip: { id: 'vo', role: 'voice', artifactId: 'art_vo', startMs: 200, durationMs: 1900 } },
], { lockAfter: ['a', 'cap', 'vo'] }).spec;

describe('pipeline composition spec V2', () => {
  it('computes duration from content and validates', () => {
    const spec = base();
    expect(spec.output.durationMs).toBe(4000);
    expect(validateSpec(spec)).toEqual([]);
    expect(validateSpec({ ...spec, output: { ...spec.output, width: 1081 } })).toContain('output 宽高必须是偶数（h264 要求）');
  });

  it('refuses to change locked clips without an explicit unlock reason', () => {
    const spec = base();
    expect(() => applyPatch(spec, [{ op: 'update', id: 'cap', set: { displayText: 'x' } }])).toThrow(/已锁定/);
    expect(() => applyPatch(spec, [{ op: 'unlock', id: 'cap' }, { op: 'update', id: 'cap', set: { displayText: 'x' } }])).toThrow(/reason/);
    const { diff } = applyPatch(spec, [{ op: 'unlock', id: 'cap', reason: '用户改字幕' }, { op: 'update', id: 'cap', set: { displayText: 'x' } }]);
    expect(diff.unlocked).toEqual({ cap: '用户改字幕' });
  });

  it('limits a review-driven patch to clips the findings point at', () => {
    const spec = base();
    const scope = clipsForFindings(spec, [{ atSec: 3.2, layer: 'visual' }]);
    expect([...scope].sort()).toEqual(['a', 'card']);
    expect(() => applyPatch(spec, [{ op: 'remove', id: 'cap' }], { scope: new Set(['card']) })).toThrow();
    const { spec: next, diff } = applyPatch(spec, [{ op: 'update', id: 'card', set: { durationMs: 1200 } }], { scope });
    expect(diff.changed).toEqual([{ track: 'visual', id: 'card', fields: ['durationMs'] }]);
    expect(lockedClipsUnchanged(spec, next)).toEqual([]);
    expect(diffSpecs(spec, next).added).toEqual([]);
  });
});

describe('pipeline voice alignment', () => {
  it('tokenizes CJK per character and latin per word', () => {
    expect(tokenize('把截图丢给 Flovart，提问').map(token => token.normalized)).toEqual(['把', '截', '图', '丢', '给', 'flovart', '提', '问']);
  });

  it('aligns script lines to evidence and times action words on the timeline', () => {
    const words = fixtureWords('点开结果配音字幕都对好', 3000);
    const { timings, matched } = alignTokens(tokenize('点开结果配音字幕都对好'), words);
    expect(matched).toBe(timings.length);
    const aligned = alignLines([{ id: 'L1', speechText: '点开结果配音字幕都对好', actions: ['点开', '字幕'] }], [{ lineId: 'L1', offsetMs: 5000, durationMs: 3000, words }]);
    expect(aligned.lines[0].actions.every(action => action.found && action.atMs >= 5000)).toBe(true);
    expect(aligned.lines[0].actions[0].atMs).toBeLessThan(aligned.lines[0].actions[1].atMs);
  });

  it('interpolates tokens the evidence missed', () => {
    const words = [{ text: '截图', startMs: 0, endMs: 400 }, { text: '出来', startMs: 1200, endMs: 1600 }];
    const { timings, matched } = alignTokens(tokenize('截图进去出来'), words);
    expect(matched).toBe(4);
    expect(timings[2].measured).toBe(false);
    expect(timings[2].startMs).toBeGreaterThanOrEqual(400);
    expect(timings[3].endMs).toBeLessThanOrEqual(1200);
  });
});

describe('pipeline review rules', () => {
  it('rejects vague findings and requires a location and a fix', () => {
    expect(validateFindings([{ layer: 'visual', severity: 'major', issue: '整体不好', fix: 'x' }], { verdict: 'revise', durationMs: 10000 }).length).toBeGreaterThan(0);
    expect(validateFindings([{ atSec: 8, layer: 'visual', severity: 'major', issue: '第 8 秒结果停留不足 0.8 秒' }], { verdict: 'revise', durationMs: 10000 })).toEqual(['findings[0]: revise 的 finding 需要写 fix（修法）']);
    expect(validateFindings([{ atSec: 8, layer: 'visual', severity: 'major', issue: '第 8 秒结果停留不足 0.8 秒', fix: '延长到 1.2 秒' }], { verdict: 'revise', durationMs: 10000 })).toEqual([]);
    expect(validateFindings([], { verdict: 'revise' })).toContain('verdict=revise 至少需要一条 finding');
  });

  it('detects repeated findings across rounds', () => {
    const finding = { atSec: 8, layer: 'visual', issue: '第 8 秒切太快' };
    expect(findingsSignature([finding])).toBe(findingsSignature([{ ...finding, fix: 'other' }]));
  });
});

describe('pipeline ffmpeg compiler', () => {
  it('compiles every track into one controlled ffmpeg graph with voice ducking music', () => {
    const spec = applyPatch(base(), [
      { op: 'add', track: 'text', clip: { id: 't', text: '截图进去', startMs: 0, durationMs: 1000 } },
      { op: 'add', track: 'audio', clip: { id: 'm', role: 'music', artifactId: 'art_m', startMs: 0, durationMs: 4000, duck: true } },
    ]).spec;
    const { args, width, height } = buildFfmpegCommand(spec, {
      preset: 'draft', outPath: 'out.mp4', fontFile: '/fonts/x.ttf',
      resolveArtifact: id => ({ path: `/a/${id}` }), writeText: text => `/t/${text.length}.txt`,
    });
    const graph = args[args.indexOf('-filter_complex') + 1];
    expect([width, height]).toEqual([540, 960]);
    expect(graph).toContain('sidechaincompress');
    expect(graph).toContain('drawtext');
    expect(graph).toContain("between(t,3.000,3.499)");
    expect(args).not.toContain('-shell');
  });
});
