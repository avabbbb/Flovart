import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const findings = [];

const detectors = [
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { id: 'github-token', pattern: /\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { id: 'cloud-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'openai-style-key', pattern: /\bsk-[A-Za-z0-9]{24,}\b/ },
  { id: 'literal-bearer', pattern: /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}/i },
  { id: 'literal-api-key', pattern: /\b(?:api[_-]?key|apikey)\s*[:=]\s*["'`][^"'`\r\n]{20,}["'`]/i },
];

const secretFilePattern = /(^|[\\/])(?:\.env(?:\.|$)|id_(?:rsa|dsa|ecdsa|ed25519)|credentials\.json)(?:$|[\\/])|\.(?:pem|p12|pfx|key)$/i;

// Token-shaped literals that exist only to prove the evidence recorder redacts
// credentials (see eval/red-team.mjs). They must be exempted by exact value:
// exempting the whole file would also hide a real token added there later.
const intentionalFixtures = new Set([
  'sk-live-REDTEAM0000000000000000000',
  'ghp_REDTEAM000000000000000000000000',
]);

function repositoryFiles() {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function safePreview(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const lineEnd = text.indexOf('\n', index);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  return detectors.reduce((preview, detector) => preview.replace(detector.pattern, '[REDACTED]'), line);
}

const files = repositoryFiles();
for (const relativePath of files) {
  const absolutePath = join(root, relativePath);
  if (secretFilePattern.test(relativePath)) {
    findings.push({ path: relativePath, line: 1, detector: 'secret-like tracked filename' });
    continue;
  }

  let stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    continue;
  }
  if (!stats.isFile() || stats.size > 5 * 1024 * 1024) continue;

  let buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch {
    continue;
  }
  if (buffer.includes(0)) continue;
  const text = buffer.toString('utf8');

  for (const detector of detectors) {
    const match = detector.pattern.exec(text);
    if (!match) continue;
    if (intentionalFixtures.has(match[0])) continue;
    findings.push({
      path: relativePath,
      line: lineNumber(text, match.index),
      detector: detector.id,
      preview: safePreview(text, match.index),
    });
  }
}

const report = {
  ok: findings.length === 0,
  scanned: files.length,
  findings,
};
console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exitCode = 1;
