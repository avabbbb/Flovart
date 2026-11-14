// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runPipelineTraceScenario } from '../scripts/e2e-pipeline-trace.mjs';

const hasFfmpeg = spawnSync(process.env.FLOVART_FFMPEG || 'ffmpeg', ['-version']).status === 0
  && spawnSync(process.env.FLOVART_FFPROBE || 'ffprobe', ['-version']).status === 0;
const outDir = mkdtempSync(join(tmpdir(), 'flovart-pipeline-trace-'));

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

// docs/design/16-agent-video-pipeline.md §10.1：本机 fake provider 的端到端 trace。
describe.skipIf(!hasFfmpeg)('agent video pipeline P0 trace', () => {
  it('runs brief → v1 → review → targeted patch → v2 → pass → final → archive with recovery and edge cases', async () => {
    const summary = await runPipelineTraceScenario({ outDir, log: () => {} });
    expect(summary.checks.length).toBeGreaterThanOrEqual(35);
    expect(summary.rounds.slice(0, 2).map(round => [round.version, round.verdict])).toEqual([[1, 'revise'], [2, 'pass']]);
    expect(summary.rounds[0].fixedByVersion).toBe(2);
    expect(summary.versions[1].diff.changed.map(change => change.id)).toEqual(['shot-result-card']);
  }, 240_000);
});
