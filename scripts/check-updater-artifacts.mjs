import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readExpectedVersion(value) {
  return String(value || readFileSync(join(root, 'VERSION'), 'utf8'))
    .trim()
    .replace(/^v/i, '');
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function findFile(directory, name) {
  return walk(directory).find(path => basename(path) === name);
}

function updaterArtifactName(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) return null;
    return name;
  } catch {
    return null;
  }
}

export function verifyUpdaterArtifacts({
  artifactDir = join(root, 'dist', 'release-artifacts'),
  latestJsonPath = join(artifactDir, 'latest.json'),
  expectedVersion,
} = {}) {
  const errors = [];
  const version = readExpectedVersion(expectedVersion);
  const verified = [];

  if (!existsSync(latestJsonPath)) {
    return { ok: false, version, platforms: [], verified, errors: [`latest.json is missing: ${latestJsonPath}`] };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(latestJsonPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      version,
      platforms: [],
      verified,
      errors: [`latest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }

  if (manifest.version !== version) errors.push(`latest.json version is ${manifest.version || '(missing)'}, expected ${version}`);
  const platforms = manifest.platforms && typeof manifest.platforms === 'object' ? Object.entries(manifest.platforms) : [];
  if (!platforms.length) errors.push('latest.json has no platform entries');

  for (const [platform, entry] of platforms) {
    if (!entry || typeof entry !== 'object') {
      errors.push(`${platform}: updater platform entry is invalid`);
      continue;
    }
    if (typeof entry.signature !== 'string' || !entry.signature.trim()) {
      errors.push(`${platform}: updater signature is missing`);
      continue;
    }
    if (typeof entry.url !== 'string' || !entry.url.trim()) {
      errors.push(`${platform}: updater URL is missing`);
      continue;
    }

    const artifactName = updaterArtifactName(entry.url);
    if (!artifactName) {
      errors.push(`${platform}: updater URL does not contain a safe artifact filename`);
      continue;
    }
    const versionPattern = new RegExp(`(?:^|[_-])v?${escapeRegExp(version)}(?:[_\\-.]|$)`, 'i');
    // Tauri names macOS updater bundles <Product>[_<arch>].app.tar.gz with no version;
    // they are still bound to this release by the signature check below.
    const isDarwinAppBundle = platform.startsWith('darwin') && /\.app\.tar\.gz$/i.test(artifactName);
    if ((!isDarwinAppBundle && !versionPattern.test(artifactName)) || artifactName.endsWith('.sig')) {
      errors.push(`${platform}: updater artifact filename does not match release version ${version}`);
      continue;
    }
    const artifactPath = findFile(artifactDir, artifactName);
    if (!artifactPath) {
      errors.push(`${platform}: updater artifact is missing: ${artifactName}`);
      continue;
    }
    const signaturePath = findFile(artifactDir, `${artifactName}.sig`);
    if (!signaturePath) {
      errors.push(`${platform}: updater sidecar signature is missing: ${artifactName}.sig`);
      continue;
    }
    const sidecarSignature = readFileSync(signaturePath, 'utf8').trim();
    if (sidecarSignature !== entry.signature.trim()) {
      errors.push(`${platform}: latest.json signature does not match ${artifactName}.sig`);
      continue;
    }
    verified.push({ platform, artifact: artifactName, bytes: statSync(artifactPath).size });
  }

  return {
    ok: errors.length === 0,
    version,
    platforms: platforms.map(([platform]) => platform),
    verified,
    errors,
  };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact-dir') options.artifactDir = argv[++index];
    else if (arg === '--latest-json') options.latestJsonPath = argv[++index];
    else if (arg === '--version') options.expectedVersion = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    const report = verifyUpdaterArtifacts(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
