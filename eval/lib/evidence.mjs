import { appendFile, writeFile } from 'node:fs/promises';

const SECRET_KEY_PATTERN = /(api[-_]?key|authorization|bearer|access[-_]?token|refresh[-_]?token|\btoken\b|client[-_]?secret|secret|credential|password|cookie)/i;
const SECRET_VALUE_PATTERNS = [
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/gi, replacement: () => REDACTED },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gi, replacement: () => REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/gi, replacement: () => REDACTED },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, replacement: () => REDACTED },
  { pattern: /Bearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}/gi, replacement: () => REDACTED },
  { pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, replacement: () => REDACTED },
  {
    pattern: /\b(api[-_]?key|access[-_]?token|refresh[-_]?token|token|client[-_]?secret|secret)\s*([:=])\s*["']?([A-Za-z0-9._~+\/-]{8,})["']?/gi,
    replacement: (_match, label, separator) => `${label}${separator}${REDACTED}`,
  },
];

const REDACTED = '[REDACTED]';

export function redactEvidence(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    let output = value;
    for (const { pattern, replacement } of SECRET_VALUE_PATTERNS) {
      output = output.replace(pattern, replacement);
    }
    return output;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '<circular>';
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactEvidence(value.message, seen),
      ...(value.stack ? { stack: redactEvidence(value.stack, seen) } : {}),
    };
  }
  if (Array.isArray(value)) return value.map(entry => redactEvidence(entry, seen));

  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactEvidence(nested, seen);
  }
  return result;
}

export function serializeEvidence(value, space = 0) {
  return JSON.stringify(redactEvidence(value), null, space) ?? 'null';
}

export async function writeEvidenceJson(path, value) {
  await writeFile(path, `${serializeEvidence(value, 2)}\n`, 'utf8');
}

export async function appendEvidenceJsonl(path, value) {
  await appendFile(path, `${serializeEvidence(value)}\n`, 'utf8');
}
