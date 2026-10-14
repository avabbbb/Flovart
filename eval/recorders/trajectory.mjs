// Trajectory recorder.
//
// Every trial writes a JSONL trajectory so a failure can be explained instead
// of merely reported. Secrets are redacted on the way in: real API keys, bearer
// tokens and runtime tokens must never reach an evidence file.

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

// Key names are matched on substrings so camelCase compounds (bearerToken,
// clientSecret, secretKey, sessionToken) cannot slip past a word boundary.
// Keys that merely *measure* secret handling are exempted by exact name so
// safety graders and hard gates keep reading their metrics.
const METRIC_KEY_EXEMPTIONS = /^(?:secret[-_]?exposure|exposed[-_]?secrets?)$/i;
const SECRET_KEY_PATTERN = /(api[-_]?key|access[-_]?key|authorization|bearer|token|secret|password|passwd|credential|cookie|jwt|private[-_]?key|session[-_]?(?:id|token))/i;
// Value patterns run over every string, including serialized JSON fragments
// inside error text, so prefixless credentials need their own shapes: a bare
// JWT (eyJ…), AWS access keys (AKIA…) and Google keys (AIza…) carry no
// "Bearer" prefix and would otherwise pass straight through.
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}/g,
  /\bAKIA[0-9A-Z]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:api[-_ ]?key|access[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|secret[-_ ]?key|session[-_ ]?token|bearer[-_ ]?token|auth[-_ ]?token|authorization|credential|cookie|password|passwd|token|secret)\b\s*[:=]?\s*["']?[A-Za-z0-9._+\/=\-]{12,}/gi,
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
      result[key] = SECRET_KEY_PATTERN.test(key) && !METRIC_KEY_EXEMPTIONS.test(key) ? REDACTED : redactSecrets(nested, seen);
    }
    return result;
  }
  return value;
}

export function serializeEvidence(value, pretty = false) {
  return JSON.stringify(redactSecrets(value), null, pretty ? 2 : undefined);
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
    const line = serializeEvidence({
      sequence,
      at: new Date().toISOString(),
      ...event,
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
        `${serializeEvidence({ taskId, trialIndex, ...metadata }, true)}\n`,
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
      await writeFile(join(trialDir, 'world-final.json'), `${serializeEvidence(worldFinal, true)}\n`, 'utf8');
      await writeFile(join(trialDir, 'world-normalized.json'), `${serializeEvidence(worldNormalized, true)}\n`, 'utf8');
      await writeFile(join(trialDir, 'score.json'), `${serializeEvidence(score, true)}\n`, 'utf8');
      await appendFile(trajectoryPath, `${serializeEvidence({ kind: 'final', timing, score })}\n`, 'utf8');
    },
  };
}
