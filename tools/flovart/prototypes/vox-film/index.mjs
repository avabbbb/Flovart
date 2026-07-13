#!/usr/bin/env node
/**
 * PROTOTYPE — wipe me after the film manifest and CLI boundary are accepted.
 *
 * Question: can a 15-second editorial-collage film move from one manifest through
 * Flovart command mapping, local rendering, and verification without an API key?
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { COMMAND_REGISTRY } from '../../core.js';
import { createCommandPlan, createFilmManifest, initialState, transition } from './film-logic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const outputDir = resolve(repoRoot, arg('--out', '.flovart/prototypes/vox-film-dry-run'));
let state = initialState(outputDir);
let film;

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`${command} 退出码 ${code}\n${stderr.trim()}`));
    });
  });
}

const json = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const displayPath = (path) => path ? relative(repoRoot, path).replaceAll('\\', '/') : null;

function printState(clear = false) {
  if (clear) console.clear();
  console.log('\x1b[1mFlovart × Editorial Collage Film — PROTOTYPE\x1b[0m');
  console.log('\x1b[2m零 API、零费用；所有媒体均由本地 ffmpeg mock 生成。\x1b[0m\n');
  console.log(JSON.stringify({
    phase: state.phase,
    providerCalls: state.providerCalls,
    costUsd: state.costUsd,
    commandCoverage: state.commandCoverage,
    files: Object.fromEntries(Object.entries(state.files).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(displayPath) : displayPath(value),
    ])),
    verification: state.verification,
    error: state.error,
  }, null, 2));
  console.log('\n\x1b[1m[p]\x1b[0m 生成计划  \x1b[1m[r]\x1b[0m 渲染 mock  \x1b[1m[v]\x1b[0m 验证成片  \x1b[1m[a]\x1b[0m 全流程  \x1b[1m[x]\x1b[0m 重置  \x1b[1m[q]\x1b[0m 退出');
}

async function plan() {
  film = createFilmManifest();
  const commandPlan = createCommandPlan(COMMAND_REGISTRY, film);
  await mkdir(outputDir, { recursive: true });
  const manifestPath = resolve(outputDir, 'film.json');
  const planPath = resolve(outputDir, 'flovart-command-plan.json');
  await Promise.all([json(manifestPath, film), json(planPath, commandPlan)]);
  state = transition(state, { type: 'PLANNED', plan: commandPlan, manifestPath, planPath });
  printState();
}

async function render() {
  if (state.phase !== 'planned') throw new Error('请先执行 [p] 生成计划。');
  const clipDir = resolve(outputDir, 'clips');
  await mkdir(clipDir, { recursive: true });
  const clips = [];
  for (let index = 0; index < film.beats.length; index += 1) {
    const beat = film.beats[index];
    const clipPath = resolve(clipDir, `${beat.id}.mp4`);
    const fadeOutAt = Math.max(0, beat.durationSec - 0.25);
    await run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=${beat.color}:s=${film.output.width}x${film.output.height}:r=${film.output.fps}:d=${beat.durationSec}`,
      '-f', 'lavfi', '-i', `sine=frequency=${beat.toneHz}:sample_rate=48000:duration=${beat.durationSec}`,
      '-vf', `drawgrid=w=96:h=96:t=1:c=white@0.08,fade=t=in:st=0:d=0.25,fade=t=out:st=${fadeOutAt}:d=0.25`,
      '-af', `volume=0.04,afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeOutAt}:d=0.25`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-shortest', clipPath,
    ]);
    clips.push(clipPath);
  }
  const concatPath = resolve(outputDir, 'concat.txt');
  await writeFile(concatPath, `${clips.map((path) => `file '${path.replaceAll('\\', '/')}'`).join('\n')}\n`, 'utf8');
  const finalPath = resolve(outputDir, 'final.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', finalPath]);
  state = transition(state, { type: 'RENDERED', clips, finalPath });
  printState();
}

async function verify() {
  if (state.phase !== 'rendered') throw new Error('请先执行 [r] 渲染 mock 成片。');
  const probe = JSON.parse(await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,sample_rate',
    '-of', 'json', state.files.final,
  ]));
  const durationSec = Number(probe.format?.duration || 0);
  const video = probe.streams?.find((stream) => stream.codec_type === 'video');
  const audio = probe.streams?.find((stream) => stream.codec_type === 'audio');
  const checks = {
    duration: durationSec >= 14.8 && durationSec <= 15.3,
    video: video?.codec_name === 'h264' && video.width === film.output.width && video.height === film.output.height,
    audio: Boolean(audio),
    noProviderCalls: state.providerCalls === 0,
    zeroCost: state.costUsd === 0,
  };
  const verification = {
    passed: Object.values(checks).every(Boolean),
    checks,
    measured: { durationSec, video, audio },
    productionGaps: state.commandCoverage.missing,
  };
  const contactSheetPath = resolve(outputDir, 'contact-sheet.png');
  await run('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', state.files.final,
    '-vf', 'fps=1/5,scale=426:240,tile=3x1:padding=8:margin=8:color=0x111111',
    '-frames:v', '1', contactSheetPath,
  ]);
  const verificationPath = resolve(outputDir, 'verification.json');
  await json(verificationPath, verification);
  state = transition(state, { type: 'VERIFIED', verification, contactSheetPath, verificationPath });
  printState();
}

async function all() {
  if (state.phase !== 'idle' && state.phase !== 'failed' && state.phase !== 'verified') state = initialState(outputDir);
  await plan();
  await render();
  await verify();
}

async function dispatch(key) {
  if (key === 'p') return plan();
  if (key === 'r') return render();
  if (key === 'v') return verify();
  if (key === 'a') return all();
  if (key === 'x') { state = transition(state, { type: 'RESET' }); printState(); }
}

async function main() {
  if (process.argv.includes('--auto')) return all();
  const input = createInterface({ input: process.stdin, output: process.stdout });
  printState();
  while (true) {
    const key = (await input.question('> ')).trim().toLowerCase();
    if (key === 'q') break;
    try { await dispatch(key); }
    catch (error) {
      state = transition(state, { type: 'FAILED', error: error instanceof Error ? error.message : String(error) });
      printState();
    }
  }
  input.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
