// Trajectory recorder.
//
// Every trial writes a JSONL trajectory so a failure can be explained instead
// of merely reported. Secrets are redacted on the way in: real API keys, bearer
// tokens and runtime tokens must never reach an evidence file.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { appendEvidenceJsonl, writeEvidenceJson } from '../lib/evidence.mjs';

export function createTrajectoryRecorder({ runDir, taskId, trialIndex, metadata }) {
  const trialDir = join(runDir, taskId, `trial-${String(trialIndex).padStart(2, '0')}`);
  const trajectoryPath = join(trialDir, 'trajectory.jsonl');
  let sequence = 0;
  let ready = null;

  function ensureDir() {
    ready ||= mkdir(trialDir, { recursive: true }).then(() => mkdir(join(trialDir, 'artifacts'), { recursive: true }));
    return ready;
  }

  async function append(event) {
    await ensureDir();
    sequence += 1;
    await appendEvidenceJsonl(trajectoryPath, {
      sequence,
      at: new Date().toISOString(),
      ...event,
    });
  }

  return {
    trialDir,
    trajectoryPath,
    async init() {
      await ensureDir();
      await writeEvidenceJson(join(trialDir, 'metadata.json'), { taskId, trialIndex, ...metadata });
    },
    recordToolCall(call) {
      return append({ kind: 'tool_call', ...call });
    },
    recordToolResult(result) {
      return append({ kind: 'tool_result', ...result });
    },
    recordApproval(event) {
      return append({ kind: 'approval', ...event });
    },
    recordProviderEvent(event) {
      return append({ kind: 'provider', ...event });
    },
    recordError(event) {
      return append({ kind: 'error', ...event });
    },
    recordNote(event) {
      return append({ kind: 'note', ...event });
    },
    async finalise({ worldFinal, worldNormalized, score, timing }) {
      await ensureDir();
      await writeEvidenceJson(join(trialDir, 'world-final.json'), worldFinal);
      await writeEvidenceJson(join(trialDir, 'world-normalized.json'), worldNormalized);
      await writeEvidenceJson(join(trialDir, 'score.json'), score);
      await appendEvidenceJsonl(trajectoryPath, { kind: 'final', timing, score });
    },
  };
}
