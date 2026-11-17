// Tiny synthetic media for the demo dataset and tests, generated locally with
// ffmpeg (lavfi test sources, no third-party content). Never committed: they
// land in eval/aigc/results/fixtures/ (gitignored) or a test temp dir and are
// referenced from items / takes as `fixture:<name>`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { FFMPEG } from '../graders/media.mjs';

const video = (size, seconds, source = 'testsrc2') => ['-f', 'lavfi', '-i', `${source}${source.includes('=') ? ':' : '='}s=${size}:r=12:d=${seconds}`];
const sine = (seconds, frequency = 440) => ['-f', 'lavfi', '-i', `sine=f=${frequency}:d=${seconds}`];
const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast'];

/** name → ffmpeg input/codec arguments (output path appended). */
export const FIXTURES = {
  'moving-16x9-3s-audio.mp4': [...video('160x90', 3), ...sine(3), ...h264, '-c:a', 'aac', '-shortest'],
  'static-16x9-3s-audio.mp4': [...video('160x90', 3, 'color=c=gray'), ...sine(3), ...h264, '-c:a', 'aac', '-shortest'],
  'moving-9x16-5s.mp4': [...video('90x160', 5), ...h264, '-an'],
  'moving-16x9-4s-audio-3s.mp4': [...video('160x90', 4), ...sine(3, 330), ...h264, '-c:a', 'aac'],
  'square-64.png': ['-f', 'lavfi', '-i', 'testsrc2=s=64x64:d=1', '-frames:v', '1'],
  'tone-2s.wav': [...sine(2, 523)],
  'tone-3s-ref.wav': [...sine(3, 262)],
  'broken.mp4': null,
};

/** Generate every fixture into dir (idempotent). Returns { dir, generated }. */
export function ensureFixtures(dir) {
  mkdirSync(dir, { recursive: true });
  const generated = [];
  for (const [name, args] of Object.entries(FIXTURES)) {
    const out = join(dir, name);
    if (existsSync(out)) continue;
    if (args === null) {
      // A file with a media extension that is not media: exercises file-valid.
      writeFileSync(out, 'not a video');
      generated.push(name);
      continue;
    }
    const result = spawnSync(FFMPEG, ['-v', 'error', '-y', ...args, out], { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`ffmpeg failed for ${name}: ${result.error?.message ?? result.stderr}`);
    generated.push(name);
  }
  return { dir, generated };
}
