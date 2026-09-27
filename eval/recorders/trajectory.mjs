// Trajectory recorder.
//
// Every trial writes a JSONL trajectory so a failure can be explained instead
// of merely reported. Secrets are redacted on the way in: real API keys, bearer
// tokens and runtime tokens must never reach an evidence file.

import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|(?:^|[^a-z0-9])token(?:$|[^a-z0-9])|access[-_]?token|refresh[-_]?token|(?:^|[^a-z0-9])secret(?:$|[^a-z0-9])|credential|password|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g,
  /Bearer\s+[A-Za-z0-9._-]{12,}/gi,
  /\b(?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|(?:[a-z0-9]+[-_ ]?)?token|authorization|credential|secret|password|cookie)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[A-Za-z0-9_~+./=-]{12,})/gi,
];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key) {
  // Preserve the safety counter; splitting camel case lets sessionToken and
  // providerSecret still match the credential-key rules below.
  if (/^secret[_-]?exposure$/i.test(key)) return false;
  const normalized = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return SECRET_KEY_PATTERN.test(normalized);
}

export function redactSecrets(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let output = value;
    for (const pattern of SECRET_VALUE_PATTERNS) output = output.replace(pattern, REDACTED);
    return output;
  }
  if (value instanceof Error) {
    if (seen.has(value)) return '<circular>';
    seen.add(value);
    const normalized = { name: value.name, message: value.message };
    if (value.cause !== undefined) normalized.cause = value.cause;
    for (const [key, nested] of Object.entries(value)) normalized[key] = nested;
    const result = {};
    for (const [key, nested] of Object.entries(normalized)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactSecrets(nested, seen);
    }
    return result;
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
      result[key] = isSensitiveKey(key) ? REDACTED : redactSecrets(nested, seen);
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
