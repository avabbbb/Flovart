#!/usr/bin/env node
// Remotion 引擎端到端：复用 e2e-pipeline-trace 的真实 run，用 engine=remotion 把最新版本
// （含文字层、底部字幕、人声 + 音乐闪避）渲染成 draft，再用 ffprobe / ffmpeg 检查结果并截两帧供人看。
// 需要 @remotion/renderer 能拉起无头浏览器；拉不起时如实失败。
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runPipelineTraceScenario } from './e2e-pipeline-trace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(ROOT, '.tmp', 'pipeline-remotion');
const summary = await runPipelineTraceScenario({ outDir, log: () => {} });
const { Pipeline } = await import(pathToFileURL(join(ROOT, 'tools/flovart/pipeline/index.js')).href);
const pipeline = new Pipeline({ home: join(outDir, 'runtime') });
const trace = pipeline.trace(summary.runId);
const version = trace.run.headVersion;
const spec = pipeline.store.getVersion(summary.runId, version).spec;
// 场景末尾 run 已归档（只读），这里直接调用引擎渲染同一份已保存的 spec，不经命令边界写 trace。
const { renderWithRemotion } = await import(pathToFileURL(join(ROOT, 'tools/flovart/pipeline/render.js')).href);
const outPath = pipeline.store.scratchPath(`v${version}-remotion-draft.mp4`);
const meta = await renderWithRemotion(spec, {
  runId: summary.runId, preset: 'draft', outPath,
  resolveArtifact: id => pipeline.store.requireArtifact(id), scratchPath: name => pipeline.store.scratchPath(name),
});
pipeline.close();
const render = { ...meta, path: outPath };
const probe = JSON.parse(spawnSync(process.env.FLOVART_FFPROBE || 'ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', render.path]).stdout.toString());
const video = probe.streams.find(stream => stream.codec_type === 'video');
const audio = probe.streams.find(stream => stream.codec_type === 'audio');
const durationMs = Math.round(Number(probe.format.duration) * 1000);
const failures = [];
if (!video) failures.push('没有视频流');
if (!audio) failures.push('没有音频流（音频轨未进成片）');
if (Math.abs(durationMs - spec.output.durationMs) > 200) failures.push(`时长 ${durationMs}ms 与 spec ${spec.output.durationMs}ms 不符`);
if (video && (video.width !== Math.round(spec.output.width / 2 / 2) * 2 && video.width !== Math.round(spec.output.width / 2))) failures.push(`draft 宽度 ${video.width} 不是一半`);
const frames = [];
const caption = spec.tracks.captions[0];
const text = spec.tracks.text[0];
for (const [label, clip] of [['caption', caption], ['text', text]]) {
  if (!clip) continue;
  const at = (clip.startMs + clip.durationMs / 2) / 1000;
  const path = join(outDir, `remotion-${label}.png`);
  spawnSync(process.env.FLOVART_FFMPEG || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', render.path, '-frames:v', '1', path]);
  frames.push(path);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, engine: render.engine, path: render.path, width: video.width, height: video.height, durationMs, audio: audio.codec_name, frames }, null, 2));
