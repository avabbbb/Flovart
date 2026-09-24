import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createTrajectoryRecorder, serializeEvidence } from '../eval/recorders/trajectory.mjs';

describe('FlovartBench evidence redaction', () => {
  it('redacts credential-shaped values without erasing ordinary SHA-256 hashes or safety metrics', () => {
    const checksum = 'b'.repeat(64);
    const evidence = JSON.parse(serializeEvidence({
      message: `provider said Bearer ghp_${'x'.repeat(30)} and token=opaque-token-value-0000000000`,
      nested: { apiKey: checksum, authorization: 'credential-value-that-must-not-escape' },
      contentChecksum: checksum,
      safety: { secretExposure: 2 },
    }));

    expect(evidence.message).not.toContain('ghp_');
    expect(evidence.message).not.toContain('opaque-token-value-0000000000');
    expect(evidence.nested.apiKey).toBe('[REDACTED]');
    expect(evidence.nested.authorization).toBe('[REDACTED]');
    expect(evidence.contentChecksum).toBe(checksum);
    expect(evidence.safety.secretExposure).toBe(2);
  });

  it('uses the same serializer for metadata, events, worlds, score and the final event', async () => {
    const root = join(process.cwd(), '.tmp');
    await mkdir(root, { recursive: true });
    const runDir = await mkdtemp(join(root, 'eval-evidence-redaction-'));
    const secret = 'sk-test-' + 'r'.repeat(24);
    const opaqueToken = 'opaque-token-value-' + 'q'.repeat(20);
    const checksum = 'c'.repeat(64);
    const recorder = createTrajectoryRecorder({
      runDir,
      taskId: 'redaction-test',
      trialIndex: 1,
      metadata: { note: `metadata ${secret}`, apiKey: checksum, artifactChecksum: checksum },
    });

    try {
      await recorder.init();
      await recorder.recordToolCall({ args: { nested: { note: `argument Bearer ${opaqueToken}` } } });
      await recorder.recordToolResult({ result: { message: `result token=${opaqueToken}`, contentChecksum: checksum } });
      await recorder.recordApproval({ metadata: { authorization: `Bearer ${opaqueToken}` } });
      await recorder.recordProviderEvent({ error: new Error(`provider ${secret}`) });
      await recorder.recordError({ message: `runner token=${opaqueToken}` });
      await recorder.recordNote({ text: `note ${secret}` });
      await recorder.finalise({
        worldFinal: {
          workflow: { nodes: [{ metadata: { apiKey: secret, note: `world token=${opaqueToken}`, contentChecksum: checksum } }] },
          safety: { secretExposure: 2 },
        },
        worldNormalized: { workflow: { nodes: [{ metadata: { note: `normalized ${secret}` } }] } },
        score: { error: new Error(`score error token=${opaqueToken}`), canonicalHash: checksum },
        timing: { wallTimeMs: 1 },
      });

      const trialDir = join(runDir, 'redaction-test', 'trial-01');
      const evidenceFiles = [
        'metadata.json',
        'trajectory.jsonl',
        'world-final.json',
        'world-normalized.json',
        'score.json',
      ];
      const contents = await Promise.all(evidenceFiles.map(name => readFile(join(trialDir, name), 'utf8')));
      const combined = contents.join('\n');

      expect(combined).not.toContain(secret);
      expect(combined).not.toContain(opaqueToken);
      expect(combined).toContain(checksum);
      expect(JSON.parse(contents[0]).note).toContain('[REDACTED]');
      expect(JSON.parse(contents[2]).workflow.nodes[0].metadata.contentChecksum).toBe(checksum);
      expect(JSON.parse(contents[2]).safety.secretExposure).toBe(2);
      expect(JSON.parse(contents[3]).workflow.nodes[0].metadata.note).toContain('[REDACTED]');
      expect(JSON.parse(contents[4]).canonicalHash).toBe(checksum);
      for (const line of contents[1].trim().split(/\r?\n/)) expect(() => JSON.parse(line)).not.toThrow();
      // Keep the path assertion close to the writes: all evidence belongs below
      // the isolated project .tmp directory and is removed even on failure.
      expect(trialDir.startsWith(runDir)).toBe(true);
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});
