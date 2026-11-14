#!/usr/bin/env node
// ProductionSpec V1 → MP4。Node 侧渲染入口：Agent / Workflow 节点 / 本地 Worker 共用。
// 用法：
//   node scripts/render-production.mjs --spec spec.json --out out.mp4 [--entry remotion/index.ts] [--id Production]
//     [--public-dir dir]  spec 里 `static:<文件名>` 的素材从这个目录供给（staticFile）
//     [--scale 0.5]       输出按比例缩放（draft 用）
// 输出一行 JSON：{ ok, output, frames, fps, width, height, durationMs }。失败时退出码非 0。
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) throw new Error(`缺少 --${key} 的值`);
    out[key] = next;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.spec || !args.out) {
  process.stderr.write('用法: node scripts/render-production.mjs --spec spec.json --out out.mp4\n');
  process.exit(2);
}

const entryPoint = path.resolve(args.entry ?? 'remotion/index.ts');
const compositionId = args.id ?? 'Production';
const output = path.resolve(args.out);

const spec = JSON.parse(await readFile(path.resolve(args.spec), 'utf8'));
if (spec?.schemaVersion !== 1 || !Array.isArray(spec.shots)) {
  throw new Error('不是 ProductionSpec V1：需要 schemaVersion: 1 与 shots[]');
}

await mkdir(path.dirname(output), { recursive: true });

const inputProps = { spec };
const publicDir = args['public-dir'] ? path.resolve(args['public-dir']) : undefined;
const scale = args.scale ? Number(args.scale) : 1;
if (!(scale > 0 && scale <= 1)) throw new Error('--scale 必须在 (0, 1] 之间');
const serveUrl = await bundle({ entryPoint, ...(publicDir ? { publicDir } : {}) });
const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  outputLocation: output,
  inputProps,
  concurrency: 1,
  scale,
});

process.stdout.write(JSON.stringify({
  ok: true,
  output,
  frames: composition.durationInFrames,
  fps: composition.fps,
  width: Math.round(composition.width * scale),
  height: Math.round(composition.height * scale),
  durationMs: Math.round((composition.durationInFrames / composition.fps) * 1000),
}) + '\n');
