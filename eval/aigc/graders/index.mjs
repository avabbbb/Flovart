// Objective-track rule graders (eval/eval.md §4.1). Each grader is a pure
// function of (item, take, local files): it re-probes the media on every call,
// so running it N times is a real stability check, not a cache hit.
//
// verdict: pass | fail | na (constraint not set / not applicable) | error (the
// grader could not run, e.g. a remote URI or a missing ffprobe — never a pass).

import { frameDifferences, probe, resolveMediaUri, sha256File } from './media.mjs';

export const VIDEO_DOMAINS = new Set(['t2v', 'i2v', 'flf2v', 'r2v', 'v-edit', 'v-extend', 'digital-human']);
export const DEFAULT_AV_TOLERANCE_SEC = 0.2;
export const DEFAULT_DURATION_TOLERANCE_SEC = 0.5;
export const DEFAULT_ASPECT_TOLERANCE = 0.02;
/** Mean normalised frame difference below this is treated as a near-static (frozen) video. Heuristic; calibrate against human labels. */
export const DEFAULT_MIN_DYNAMIC_DEGREE = 0.002;

const round = (value, digits = 6) => (value === null || value === undefined ? value : Number(value.toFixed(digits)));

function parseAspect(text) {
  const [w, h] = String(text).split(':').map(Number);
  return w > 0 && h > 0 ? w / h : null;
}

function primaryVisual(take) {
  return take.outputs.video?.[0] ?? take.outputs.image?.[0] ?? null;
}

function locate(output, ctx) {
  return output ? resolveMediaUri(output.uri, ctx) : null;
}

/** Probe the primary video (or the audio-only output for tts). */
function probeTimeline(take, ctx) {
  const output = take.outputs.video?.[0] ?? take.outputs.audio?.[0];
  if (!output) return { na: true };
  const path = locate(output, ctx);
  if (!path) return { error: `cannot resolve ${output.uri} locally (remote media is not fetched)` };
  const info = probe(path);
  return info.ok ? { info } : { error: info.error };
}

export const GRADERS = [
  {
    id: 'file-valid',
    version: '1.0.0',
    describe: '每个输出都能在本地解析、非空、可被 ffprobe 读取；给了 sha256 时与文件一致',
    applies: () => true,
    run(item, take, ctx) {
      const outputs = Object.entries(take.outputs).flatMap(([role, list]) => list.map(output => ({ role, ...output })));
      const problems = [];
      for (const output of outputs) {
        const path = locate(output, ctx);
        if (!path) return { verdict: 'error', value: null, detail: `cannot resolve ${output.uri} locally` };
        const info = probe(path);
        if (!info.ok) { problems.push(`${output.role} ${output.uri}: ${info.error}`); continue; }
        const kind = output.mime.split('/')[0];
        if (kind === 'video' && !info.video) problems.push(`${output.uri}: no video stream`);
        if (kind === 'audio' && !info.audio) problems.push(`${output.uri}: no audio stream`);
        if (kind === 'image' && !info.video) problems.push(`${output.uri}: not a decodable image`);
        if (output.sha256 && sha256File(path) !== output.sha256) problems.push(`${output.uri}: sha256 mismatch`);
      }
      return { verdict: problems.length ? 'fail' : 'pass', value: outputs.length - problems.length, detail: problems.join('; ') || `${outputs.length} output(s) valid` };
    },
  },
  {
    id: 'aspect',
    version: '1.0.0',
    describe: '画面宽高比与 constraints.aspect 相差不超过 2%',
    applies: (item, take) => Boolean(item.constraints?.aspect) && Boolean(primaryVisual(take)),
    run(item, take, ctx) {
      const output = primaryVisual(take);
      const path = locate(output, ctx);
      if (!path) return { verdict: 'error', value: null, detail: `cannot resolve ${output.uri} locally` };
      const info = probe(path);
      if (!info.ok || !info.video?.width) return { verdict: 'error', value: null, detail: info.error ?? 'no frame size' };
      const actual = info.video.width / info.video.height;
      const target = parseAspect(item.constraints.aspect);
      const drift = Math.abs(actual / target - 1);
      return { verdict: drift <= DEFAULT_ASPECT_TOLERANCE ? 'pass' : 'fail', value: round(actual, 4), detail: `${info.video.width}x${info.video.height} vs ${item.constraints.aspect}` };
    },
  },
  {
    id: 'duration',
    version: '1.0.0',
    describe: '时长与 constraints.durationSec 相差不超过容差（默认 0.5 秒）',
    applies: (item, take) => Boolean(item.constraints?.durationSec) && Boolean(take.outputs.video?.length || take.outputs.audio?.length),
    run(item, take, ctx) {
      const probed = probeTimeline(take, ctx);
      if (probed.error) return { verdict: 'error', value: null, detail: probed.error };
      const actual = probed.info.durationSec;
      if (actual === null) return { verdict: 'error', value: null, detail: 'no duration' };
      const tolerance = item.constraints.durationToleranceSec ?? DEFAULT_DURATION_TOLERANCE_SEC;
      const ok = Math.abs(actual - item.constraints.durationSec) <= tolerance;
      return { verdict: ok ? 'pass' : 'fail', value: round(actual, 3), detail: `${round(actual, 3)}s vs ${item.constraints.durationSec}s ±${tolerance}s` };
    },
  },
  {
    id: 'has-audio',
    version: '1.0.0',
    describe: 'constraints.audio.required 时，视频带音轨或另有音频输出',
    applies: item => Boolean(item.constraints?.audio?.required) && VIDEO_DOMAINS.has(item.domain),
    run(item, take, ctx) {
      if (take.outputs.audio?.length) {
        const path = locate(take.outputs.audio[0], ctx);
        const info = path ? probe(path) : { ok: false, error: 'unresolved' };
        return info.ok && info.audio ? { verdict: 'pass', value: 1, detail: 'separate audio output' } : { verdict: 'fail', value: 0, detail: `audio output unreadable: ${info.error ?? 'no audio stream'}` };
      }
      const probed = probeTimeline(take, ctx);
      if (probed.na) return { verdict: 'fail', value: 0, detail: 'no video or audio output' };
      if (probed.error) return { verdict: 'error', value: null, detail: probed.error };
      return probed.info.audio ? { verdict: 'pass', value: 1, detail: `audio ${probed.info.audio.codec}` } : { verdict: 'fail', value: 0, detail: 'video has no audio stream' };
    },
  },
  {
    id: 'av-duration-match',
    version: '1.0.0',
    describe: '有音轨的视频，音频与视频时长相差不超过容差（默认 0.2 秒，与 DH-HONEST-01 一致）',
    applies: (item, take) => VIDEO_DOMAINS.has(item.domain) && Boolean(take.outputs.video?.length),
    run(item, take, ctx) {
      const probed = probeTimeline(take, ctx);
      if (probed.error) return { verdict: 'error', value: null, detail: probed.error };
      let audio = probed.info.audio;
      let audioDuration = audio?.durationSec ?? null;
      if (take.outputs.audio?.length) {
        const path = locate(take.outputs.audio[0], ctx);
        const info = path ? probe(path) : null;
        if (!info?.ok) return { verdict: 'error', value: null, detail: 'audio output unreadable' };
        audio = info.audio;
        audioDuration = info.audio?.durationSec ?? info.durationSec;
      }
      if (!audio) return item.constraints?.audio?.required
        ? { verdict: 'fail', value: null, detail: 'audio required but missing' }
        : { verdict: 'na', value: null, detail: 'silent video' };
      const videoDuration = probed.info.video?.durationSec ?? probed.info.durationSec;
      if (videoDuration === null || audioDuration === null) return { verdict: 'error', value: null, detail: 'stream duration missing' };
      const gap = Math.abs(videoDuration - audioDuration);
      const tolerance = item.constraints?.audio?.syncToleranceSec ?? DEFAULT_AV_TOLERANCE_SEC;
      return { verdict: gap <= tolerance ? 'pass' : 'fail', value: round(gap, 3), detail: `video ${round(videoDuration, 3)}s, audio ${round(audioDuration, 3)}s` };
    },
  },
  {
    id: 'dynamic-degree',
    version: '1.0.0',
    describe: '相邻帧平均差异（4 fps、32×18 灰度）不低于阈值，防止近乎静止的视频拿到画质分（VBench dynamic degree 的轻量替代）',
    applies: (item, take) => VIDEO_DOMAINS.has(item.domain) && Boolean(take.outputs.video?.length),
    run(item, take, ctx) {
      const output = take.outputs.video[0];
      const path = locate(output, ctx);
      if (!path) return { verdict: 'error', value: null, detail: `cannot resolve ${output.uri} locally` };
      const result = frameDifferences(path);
      if (!result.ok) return { verdict: 'error', value: null, detail: result.error };
      const mean = result.diffs.reduce((sum, diff) => sum + diff, 0) / result.diffs.length;
      const frozen = result.diffs.filter(diff => diff < 0.0005).length / result.diffs.length;
      const threshold = item.constraints?.minDynamicDegree ?? DEFAULT_MIN_DYNAMIC_DEGREE;
      return {
        verdict: mean >= threshold ? 'pass' : 'fail',
        value: round(mean, 6),
        detail: `mean frame diff ${round(mean, 5)} (min ${threshold}), frozen pairs ${(frozen * 100).toFixed(0)}% over ${result.frames} frames`,
      };
    },
  },
];

export const GRADER_IDS = GRADERS.map(grader => grader.id);
export const graderKey = grader => `${grader.id}@${grader.version}`;
