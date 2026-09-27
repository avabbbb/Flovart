import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readExpectedVersion(value) {
  return String(value || readFileSync(join(root, 'VERSION'), 'utf8'))
    .trim()
    .replace(/^v/i, '');
}

function installerFiles(installerDir) {
  if (!existsSync(installerDir)) return [];
  return readdirSync(installerDir)
    .filter(name => /\.(?:exe|msi|deb|AppImage|dmg)$/i.test(name))
    .map(name => join(installerDir, name))
    .filter(path => statSync(path).isFile());
}

function verifyChecksumManifest(manifestPath, files) {
  const errors = [];
  if (!existsSync(manifestPath)) return ['SHA256SUMS.txt is missing'];

  const entries = new Map();
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})\s+(?:\*)?(.+)$/i);
    if (!match) {
      errors.push(`invalid checksum line: ${line}`);
      continue;
    }
    const [, digest, name] = match;
    if (entries.has(name)) errors.push(`duplicate checksum entry: ${name}`);
    entries.set(name, digest.toLowerCase());
  }

  const expectedNames = new Set(files.map(path => path.split(/[\\/]/).pop()));
  for (const name of expectedNames) {
    const digest = entries.get(name);
    if (!digest) {
      errors.push(`installer is absent from SHA256SUMS.txt: ${name}`);
      continue;
    }
    const file = files.find(path => path.split(/[\\/]/).pop() === name);
    if (sha256(file) !== digest) errors.push(`checksum mismatch: ${name}`);
  }
  for (const name of entries.keys()) {
    if (!expectedNames.has(name)) errors.push(`SHA256SUMS.txt contains an unknown file: ${name}`);
  }
  return errors;
}

function verifySbom(sbomPath) {
  if (!existsSync(sbomPath)) return [`SBOM is missing: ${sbomPath}`];
  try {
    const document = JSON.parse(readFileSync(sbomPath, 'utf8'));
    const errors = [];
    if (typeof document.spdxVersion !== 'string' || !document.spdxVersion.startsWith('SPDX-')) errors.push('SBOM spdxVersion is missing');
    if (typeof document.SPDXID !== 'string' || !document.SPDXID) errors.push('SBOM SPDXID is missing');
    if (typeof document.name !== 'string' || !document.name) errors.push('SBOM name is missing');
    if (!Array.isArray(document.packages)) errors.push('SBOM packages must be an array');
    return errors;
  } catch (error) {
    return [`SBOM is not valid JSON: ${error instanceof Error ? error.message : String(error)}`];
  }
}

export function verifyReleaseArtifacts({ artifactDir = join(root, 'dist', 'release-artifacts'), expectedVersion, sbomPath } = {}) {
  const errors = [];
  const version = readExpectedVersion(expectedVersion);
  const installerDir = join(artifactDir, 'installers');
  const files = installerFiles(installerDir);
  if (files.length === 0) errors.push(`no installer artifacts found in ${installerDir}`);

  const versionPattern = new RegExp(`(?:^|_|-)v?${escapeRegExp(version)}(?:_|-|\\.|$)`, 'i');
  for (const file of files) {
    const name = file.split(/[\\/]/).pop();
    if (!versionPattern.test(name)) errors.push(`installer filename does not contain release version ${version}: ${name}`);
  }

  errors.push(...verifyChecksumManifest(join(artifactDir, 'SHA256SUMS.txt'), files));
  if (sbomPath) errors.push(...verifySbom(sbomPath));

  return {
    ok: errors.length === 0,
    artifactDir,
    version,
    installers: files.map(file => ({ name: file.split(/[\\/]/).pop(), bytes: statSync(file).size, sha256: sha256(file) })),
    sbom: sbomPath || null,
    errors,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact-dir') options.artifactDir = argv[++index];
    else if (arg === '--version') options.expectedVersion = argv[++index];
    else if (arg === '--sbom') options.sbomPath = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    const report = verifyReleaseArtifacts(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
