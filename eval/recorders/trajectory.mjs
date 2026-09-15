// Trajectory recorder.
//
// Every trial writes a JSONL trajectory so a failure can be explained instead
// of merely reported. Secrets are redacted on the way in: real API keys, bearer
// tokens and runtime tokens must never reach an evidence file.

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|\btoken\b|access[-_]?token|refresh[-_]?token|secret|credential|password|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b[0-9a-f]{64}\b/gi,
];

const REDACTED = '[REDACTED]';

export function redactSecrets(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let output = value;
    for (const pattern of SECRET_VALUE_PATTERNS) output = output.replace(pattern, REDACTED);
    return output;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    return value.map(entry => redactSecrets(entry, seen));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactSecrets(nested, seen);
    }
    return result;
  }
  return value;
}

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
    const line = JSON.stringify({
      sequence,
      at: new Date().toISOString(),
      ...redactSecrets(event),
    });
    await appendFile(trajectoryPath, `${line}\n`, 'utf8');
  }

  return {
    trialDir,
    trajectoryPath,
    async init() {
      await ensureDir();
      await writeFile(
        join(trialDir, 'metadata.json'),
        `${JSON.stringify(redactSecrets({ taskId, trialIndex, ...metadata }), null, 2)}\n`,
        'utf8',
      );
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
      await writeFile(join(trialDir, 'world-final.json'), `${JSON.stringify(worldFinal, null, 2)}\n`, 'utf8');
      await writeFile(join(trialDir, 'world-normalized.json'), `${JSON.stringify(worldNormalized, null, 2)}\n`, 'utf8');
      await writeFile(join(trialDir, 'score.json'), `${JSON.stringify(score, null, 2)}\n`, 'utf8');
      await appendFile(trajectoryPath, `${JSON.stringify({ kind: 'final', timing, score })}\n`, 'utf8');
    },
  };
}
