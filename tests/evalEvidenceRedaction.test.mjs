// @vitest-environment node

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { serializeEvidence } from '../eval/lib/evidence.mjs';
import { createTrajectoryRecorder } from '../eval/recorders/trajectory.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('FlovartBench evidence serialization boundary', () => {
  it('redacts credentials embedded in arbitrary nested strings and preserves artifact hashes', () => {
    const apiSecret = 'sk-live-REDTEAM0000000000000000000';
    const bearerSecret = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturelong';
    const githubSecret = 'ghp_REDTEAM000000000000000000000000';
    const artifactSha256 = 'a'.repeat(64);

    const serialized = serializeEvidence({
      error: { message: `provider rejected ${apiSecret}; auth ${bearerSecret}; token ${githubSecret}` },
      nested: [{ debug: `artifact sha256=${artifactSha256}` }],
    }, 2);

    expect(serialized).not.toContain(apiSecret);
    expect(serialized).not.toContain(bearerSecret);
    expect(serialized).not.toContain(githubSecret);
    expect(serialized).toContain(artifactSha256);
  });

  it('routes metadata, tool/provider/approval/note/error events, worlds, score, and final events through redaction', async () => {
    const apiSecret = 'sk-live-REDTEAM0000000000000000000';
    const bearerSecret = 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signaturelong';
    const githubSecret = 'ghp_REDTEAM000000000000000000000000';
    const runDir = await mkdtemp(join(process.cwd(), '.tmp', 'vitest', 'trajectory-redaction-'));
    temporaryDirectories.push(runDir);

    const recorder = createTrajectoryRecorder({
      runDir,
      taskId: 'redaction-task',
      trialIndex: 1,
      metadata: { note: `runner started with ${apiSecret}`, nested: { token: githubSecret } },
    });
    await recorder.init();
    await recorder.recordToolCall({ args: { note: `tool received ${apiSecret}` } });
    await recorder.recordToolResult({ result: { message: `tool returned ${bearerSecret}` } });
    await recorder.recordApproval({ metadata: { token: githubSecret } });
    await recorder.recordProviderEvent({ error: { detail: `provider said ${apiSecret}` } });
    await recorder.recordNote({ message: `note contains ${githubSecret}` });
    await recorder.recordError({ error: { message: `runner failed with ${bearerSecret}` } });
    await recorder.finalise({
      worldFinal: { state: { error: `${apiSecret}` } },
      worldNormalized: { note: `${githubSecret}` },
      score: { error: { message: `score retained ${bearerSecret}` }, token: apiSecret },
      timing: { wallTimeMs: 10 },
    });

    const trialDir = join(runDir, 'redaction-task', 'trial-01');
    const evidencePaths = (await readdir(trialDir)).filter(name => /\.(json|jsonl)$/.test(name));
    const contents = await Promise.all(evidencePaths.map(name => readFile(join(trialDir, name), 'utf8')));
    const evidence = contents.join('\n');

    expect(evidencePaths.sort()).toEqual(['metadata.json', 'score.json', 'trajectory.jsonl', 'world-final.json', 'world-normalized.json']);
    expect(evidence).not.toContain(apiSecret);
    expect(evidence).not.toContain(bearerSecret);
    expect(evidence).not.toContain(githubSecret);
    expect(evidence).toContain('[REDACTED]');
  });
});
