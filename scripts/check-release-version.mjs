import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const expected = String(process.argv[2] || readFileSync(resolve(root, 'VERSION'), 'utf8')).trim().replace(/^v/, '');
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const tauriConfig = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const releaseRepository = 'avabbbb/Flovart';
const retiredRepositoryOwner = ['Paker', 'kk'].join('-');
const sources = {
  VERSION: readFileSync(resolve(root, 'VERSION'), 'utf8').trim(),
  'package.json': JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  'package-lock.json': lockfile.version,
  'package-lock.json packages[""]': lockfile.packages?.['']?.version,
  'tools/flovart/package.json': JSON.parse(readFileSync(resolve(root, 'tools/flovart/package.json'), 'utf8')).version,
  'src-tauri/tauri.conf.json': tauriConfig.version,
  'src-tauri/Cargo.toml': readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1],
};
const mismatches = Object.entries(sources).filter(([, version]) => version !== expected);
const minimumNodeMajor = rootPackage.engines?.node?.match(/>=?\s*(\d+)/)?.[1];
const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
const dockerNodeMajor = dockerfile.match(/^\s*FROM\s+node:(\d+)/mi)?.[1];
const updaterEndpoints = tauriConfig.plugins?.updater?.endpoints || [];
const expectedUpdaterEndpoint = `https://github.com/${releaseRepository}/releases/latest/download/latest.json`;
const errors = [];

if (!dockerNodeMajor || !minimumNodeMajor || Number(dockerNodeMajor) < Number(minimumNodeMajor)) {
  errors.push(`Dockerfile Node base must satisfy package.json engines (${rootPackage.engines?.node || 'missing'}); found node:${dockerNodeMajor || '(missing)'}`);
}

if (updaterEndpoints.length !== 1 || updaterEndpoints[0] !== expectedUpdaterEndpoint) {
  errors.push(`Tauri updater endpoint must be ${expectedUpdaterEndpoint}; found ${updaterEndpoints.join(', ') || '(missing)'}`);
}

try {
  const visibleFiles = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  const staleOwnerFiles = visibleFiles.filter(file => {
    if (!/\.(?:md|mdx|json|jsonc|js|mjs|ts|tsx|yml|yaml|toml|rs|ps1|sh)$/i.test(file)) return false;
    try { return readFileSync(resolve(root, file), 'utf8').includes(retiredRepositoryOwner); } catch { return false; }
  });
  if (staleOwnerFiles.length) errors.push(`Stale repository owner reference ${retiredRepositoryOwner} found in: ${staleOwnerFiles.join(', ')}`);
} catch (error) {
  errors.push(`Unable to enumerate Git-visible release files: ${error instanceof Error ? error.message : String(error)}`);
}

if (mismatches.length || errors.length) {
  const details = [];
  if (mismatches.length) details.push(`version mismatch: ${mismatches.map(([file, version]) => `${file}=${version || '(missing)'}`).join(', ')}`);
  details.push(...errors);
  throw new Error(details.join('; '));
}
console.log(`Flovart release identity is aligned at ${expected} (${releaseRepository}).`);
