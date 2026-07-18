import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(packageDir, '..', '..');

async function refreshDirectory(source, target) {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

await Promise.all([
  refreshDirectory(resolve(repoDir, 'agent'), resolve(packageDir, 'managed-agent')),
  refreshDirectory(resolve(repoDir, '.agents', 'skills', 'flovart'), resolve(packageDir, 'skill')),
]);
