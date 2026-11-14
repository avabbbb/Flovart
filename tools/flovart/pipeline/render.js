// composition.render 的本机渲染引擎（docs/design/16-agent-video-pipeline.md C12 / C13 / C14 / C17）。
// - ffmpeg：spec V2 全轨道（画面 / 推镜 / 文字 / 字幕安全区 / 人声 + 音乐 + 音效、人声闪避音乐）。
// - remotion：调用 scripts/render-production.mjs，画面 / 文字 / 字幕 / 音频轨由 components/reverse/ProductionVideo.tsx 绘制；缺依赖时返回 CAPABILITY_UNAVAILABLE。
import { copyFileSync, existsSync, linkSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CapabilityError, ffmpegBin, filterPath, resolveFontInfo, runTool, specNeedsCjk } from './media.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export const RENDER_PRESETS = Object.freeze({
  still: { scale: 1 },
  draft: { scale: 0.5, crf: 30, preset: 'ultrafast', audioBitrate: '96k' },
  final: { scale: 1, crf: 20, preset: 'medium', audioBitrate: '192k' },
});

const sec = ms => (ms / 1000).toFixed(3);
const even = value => Math.max(2, Math.round(value / 2) * 2);

/**
 * 把 spec V2 编译成一条 ffmpeg 命令（纯函数，便于单测与审计）。
 * resolveArtifact(id) → { path }；writeText(text) → 文本文件路径（drawtext 用 textfile 避免转义问题）。
 */
export function buildFfmpegCommand(spec, { preset, atSec, outPath, resolveArtifact, writeText, fontFile }) {
  const config = RENDER_PRESETS[preset];
  if (!config) throw Object.assign(new Error(`未知 preset：${preset}`), { code: 'INVALID_ARGUMENT' });
  const { fps } = spec.output;
  const width = even(spec.output.width * config.scale);
  const height = even(spec.output.height * config.scale);
  const durationMs = Math.max(spec.output.durationMs, 100);
  const inputs = ['-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${sec(durationMs)}`];
  const filters = [];
  let inputIndex = 1;
  let last = '0:v';

  // 画面轨：按开始时间叠加；后开始的在上层。
  const visual = [...spec.tracks.visual].sort((left, right) => left.startMs - right.startMs);
  visual.forEach((clip, index) => {
    const label = `v${index}`;
    const d = sec(clip.durationMs);
    if (clip.kind === 'color') {
      inputs.push('-f', 'lavfi', '-i', `color=c=${clip.color || 'black'}:s=${width}x${height}:r=${fps}:d=${d}`);
    } else if (clip.kind === 'image') {
      inputs.push('-loop', '1', '-framerate', String(fps), '-t', d, '-i', resolveArtifact(clip.artifactId).path);
    } else {
      inputs.push('-ss', sec(clip.inMs ?? 0), '-t', d, '-i', resolveArtifact(clip.artifactId).path);
    }
    const chain = [];
    if (clip.fit === 'contain') {
      chain.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`, `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`);
    } else {
      chain.push(`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`);
    }
    const amount = clip.motion?.type === 'push' ? Number(clip.motion.amount ?? 0.08) : 0;
    if (amount > 0) {
      // 推镜：逐帧放大后居中裁回画幅。
      chain.push(`scale=w='${width}*(1+${amount}*t/${d})':h=-2:eval=frame`, `crop=${width}:${height}`);
    }
    chain.push('setsar=1', `fps=${fps}`, 'format=yuv420p', `setpts=PTS-STARTPTS+${sec(clip.startMs)}/TB`);
    filters.push(`[${inputIndex}:v]${chain.join(',')}[${label}]`);
    const next = `ov${index}`;
    filters.push(`[${last}][${label}]overlay=eof_action=pass:enable='between(t,${sec(clip.startMs)},${sec(clip.startMs + clip.durationMs - 1)})'[${next}]`);
    last = next;
    inputIndex += 1;
  });

  // 文字与字幕：drawtext + textfile；字幕走底部安全区（画高 12% 以上），带底框不遮挡 UI 细节。
  const textChain = [];
  const font = filterPath(fontFile);
  for (const clip of spec.tracks.text) {
    const size = Math.round((clip.size ?? 64) * config.scale);
    const y = clip.position === 'top' ? `h*0.10` : clip.position === 'bottom' ? `h*0.78-th` : '(h-th)/2';
    textChain.push(`drawtext=fontfile='${font}':textfile='${filterPath(writeText(clip.text))}':fontcolor=${clip.color || 'white'}:fontsize=${size}:x=(w-tw)/2:y=${y}:borderw=${Math.max(1, Math.round(3 * config.scale))}:bordercolor=black@0.6:enable='between(t,${sec(clip.startMs)},${sec(clip.startMs + clip.durationMs)})'`);
  }
  for (const clip of spec.tracks.captions) {
    const size = Math.round(44 * config.scale);
    textChain.push(`drawtext=fontfile='${font}':textfile='${filterPath(writeText(clip.displayText))}':fontcolor=white:fontsize=${size}:x=(w-tw)/2:y=h*0.88-th:box=1:boxcolor=black@0.55:boxborderw=${Math.round(14 * config.scale)}:enable='between(t,${sec(clip.startMs)},${sec(clip.startMs + clip.durationMs)})'`);
  }
  if (textChain.length) {
    filters.push(`[${last}]${textChain.join(',')}[vtext]`);
    last = 'vtext';
  }
  filters.push(`[${last}]format=yuv420p[vout]`);

  if (preset === 'still') {
    return {
      args: ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'),
        '-map', '[vout]', '-ss', String(atSec ?? 0), '-frames:v', '1', outPath],
      width, height,
    };
  }

  // 音频：人声 / 音乐 / 音效三组；音乐用人声做 sidechain 闪避。
  const groups = { voice: [], music: [], sfx: [] };
  for (const clip of spec.tracks.audio) {
    const label = `a${inputIndex}`;
    inputs.push('-i', resolveArtifact(clip.artifactId).path);
    const delay = Math.round(clip.startMs);
    const trim = clip.durationMs ? `,atrim=0:${sec(clip.durationMs)}` : '';
    filters.push(`[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo${trim},adelay=${delay}|${delay},volume=${clip.gainDb ?? 0}dB[${label}]`);
    groups[clip.role].push({ label, duck: clip.duck !== false });
    inputIndex += 1;
  }
  const mix = (labels, out) => {
    if (labels.length === 1) filters.push(`[${labels[0]}]anull[${out}]`);
    else filters.push(`${labels.map(label => `[${label}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[${out}]`);
  };
  const finalLabels = [];
  if (groups.voice.length) {
    mix(groups.voice.map(item => item.label), 'voicemix');
    if (groups.music.length) filters.push('[voicemix]asplit=2[voiceout][voicesc]');
    else filters.push('[voicemix]anull[voiceout]');
    finalLabels.push('voiceout');
  }
  if (groups.music.length) {
    mix(groups.music.map(item => item.label), 'musicmix');
    if (groups.voice.length && groups.music.some(item => item.duck)) {
      filters.push('[musicmix][voicesc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[musicduck]');
      finalLabels.push('musicduck');
    } else {
      if (groups.voice.length) filters.push('[voicesc]anullsink');
      finalLabels.push('musicmix');
    }
  }
  if (groups.sfx.length) {
    mix(groups.sfx.map(item => item.label), 'sfxmix');
    finalLabels.push('sfxmix');
  }
  const audioMap = [];
  if (finalLabels.length) {
    mix(finalLabels, 'amixed');
    filters.push(`[amixed]apad,atrim=0:${sec(durationMs)},alimiter=limit=0.95[aout]`);
    audioMap.push('-map', '[aout]', '-c:a', 'aac', '-b:a', config.audioBitrate);
  }
  return {
    args: ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'),
      '-map', '[vout]', ...audioMap, '-t', sec(durationMs), '-r', String(fps),
      '-c:v', 'libx264', '-preset', config.preset, '-crf', String(config.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath],
    width, height,
  };
}

export async function renderWithFfmpeg(spec, { preset, atSec, outPath, resolveArtifact, scratchPath, signal }) {
  const fontFile = (spec.tracks.text.length || spec.tracks.captions.length) ? resolveFontInfo({ requireCjk: specNeedsCjk(spec) }).path : '';
  let counter = 0;
  const writeText = text => {
    const path = scratchPath(`text-${counter += 1}.txt`);
    writeFileSync(path, String(text), 'utf8');
    return path;
  };
  const { args, width, height } = buildFfmpegCommand(spec, { preset, atSec, outPath, resolveArtifact, writeText, fontFile });
  await runTool(ffmpegBin(), args, { capability: 'ffmpeg', signal });
  if (!existsSync(outPath)) throw Object.assign(new Error('ffmpeg 未产出文件'), { code: 'RENDER_FAILED' });
  return { engine: 'ffmpeg', width, height };
}

/** Remotion 需要 @remotion/renderer 与 @remotion/bundler；spec V2 的画面 / 文字 / 字幕 / 音频轨都能表达。 */
export function remotionAvailability() {
  const require = createRequire(join(REPO_ROOT, 'package.json'));
  try {
    require.resolve('@remotion/renderer');
    require.resolve('@remotion/bundler');
  } catch {
    return { ok: false, reason: '本机缺少 @remotion/renderer / @remotion/bundler', diagnose: '在仓库根目录运行 npm install' };
  }
  return { ok: true };
}

/**
 * spec V2 → ProductionSpec V1（含可选 texts / captions / audio），交给 Remotion 入口。
 * assetRef(artifactId) 返回组件可加载的引用（Node 渲染时为 `static:<文件名>`）。
 */
export function toProductionSpecV1(spec, runId, assetRef) {
  const fps = spec.output.fps;
  const frame = ms => Math.round((ms / 1000) * fps);
  const span = ms => Math.max(1, frame(ms));
  return {
    schemaVersion: 1,
    projectId: runId,
    sourceRevision: 0,
    output: { width: spec.output.width, height: spec.output.height, fps, durationFrames: span(spec.output.durationMs) },
    shots: [...spec.tracks.visual].sort((a, b) => a.startMs - b.startMs).map((clip, index) => ({
      shotId: clip.id,
      index: index + 1,
      startFrame: frame(clip.startMs),
      durationFrames: span(clip.durationMs),
      sourceType: 'imported',
      ...(clip.artifactId ? { assetRef: assetRef(clip.artifactId) } : {}),
      locked: clip.locked,
    })),
    texts: spec.tracks.text.map(clip => ({
      id: clip.id, text: clip.text, startFrame: frame(clip.startMs), durationFrames: span(clip.durationMs),
      position: clip.position || 'center', ...(clip.size ? { size: clip.size } : {}), ...(clip.color ? { color: clip.color } : {}),
    })),
    captions: spec.tracks.captions.map(clip => ({
      id: clip.id, text: clip.displayText, startFrame: frame(clip.startMs), durationFrames: span(clip.durationMs),
    })),
    audio: spec.tracks.audio.map(clip => ({
      id: clip.id, role: clip.role, src: assetRef(clip.artifactId), startFrame: frame(clip.startMs),
      ...(clip.durationMs ? { durationFrames: span(clip.durationMs) } : {}), gainDb: clip.gainDb ?? 0,
      ...(clip.role === 'music' ? { duck: clip.duck !== false } : {}),
    })),
    renderer: 'remotion',
  };
}

export async function renderWithRemotion(spec, { runId, preset, outPath, resolveArtifact, scratchPath, signal }) {
  const availability = remotionAvailability();
  if (!availability.ok) throw new CapabilityError('remotion', availability.reason, availability.diagnose);
  if (preset === 'still') throw new CapabilityError('remotion', 'Remotion 入口暂不支持单帧 still', '改用 engine=ffmpeg 出静态关键帧');
  // 无头浏览器读不了任意本地路径：把用到的 artifact 链接进 bundle 的 publicDir，用 staticFile 供给。
  const publicDir = scratchPath('remotion-public');
  mkdirSync(publicDir, { recursive: true });
  const assetRef = artifactId => {
    const source = resolveArtifact(artifactId).path;
    const name = basename(source);
    const target = join(publicDir, name);
    if (!existsSync(target)) {
      try { linkSync(source, target); } catch { copyFileSync(source, target); }
    }
    return `static:${name}`;
  };
  const productionSpec = toProductionSpecV1(spec, runId, assetRef);
  // 文字 / 字幕：把选中的字体文件放进 publicDir 嵌入，渲染机没装中文字体也不会出方框。
  if (spec.tracks.text.length || spec.tracks.captions.length) {
    const font = resolveFontInfo({ requireCjk: specNeedsCjk(spec) });
    const name = `flovart-font${extname(font.path).toLowerCase() || '.ttf'}`;
    const target = join(publicDir, name);
    if (!existsSync(target)) {
      try { linkSync(font.path, target); } catch { copyFileSync(font.path, target); }
    }
    productionSpec.font = { src: `static:${name}` };
  }
  const specPath = scratchPath('production-spec.v1.json');
  writeFileSync(specPath, JSON.stringify(productionSpec), 'utf8');
  const scale = RENDER_PRESETS[preset].scale;
  await runTool(process.execPath, [join(REPO_ROOT, 'scripts/render-production.mjs'), '--spec', specPath, '--out', outPath,
    '--entry', join(REPO_ROOT, 'remotion/index.ts'), '--public-dir', publicDir, '--scale', String(scale)],
  { capability: 'remotion', signal, timeoutMs: 30 * 60 * 1000 });
  return { engine: 'remotion', width: even(spec.output.width * scale), height: even(spec.output.height * scale) };
}
