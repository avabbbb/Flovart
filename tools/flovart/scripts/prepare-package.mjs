import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(packageDir, '..', '..');

async function refreshDirectory(source, target) {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
}

// The repo `agent/` directory is published as `managed-agent/`. Inside the
// package, relative imports to the repo's `../tools/flovart/*` and
// `../services/*` do not exist, so every module the agent needs must resolve
// against the package root (where the real skill-*.js files are shipped).
// We overwrite the copied alias files with package-layout aliases AFTER the
// directory copy completes (parallel writes race the recursive cp).
const PACKAGE_LAYOUT_ALIASES = {
  'skill-package.js': "export * from '../skill-package.js';\n",
  'skill-registry.js': "export * from '../skill-registry.js';\n",
};

await refreshDirectory(resolve(repoDir, 'agent'), resolve(packageDir, 'managed-agent'));
// Nested under skill/flovart so the package layout matches every other skill
// package (skill/open-flovart, skill/vox-director) and initCliHost can copy the
// whole package directory — SKILL.md alone drops commands/ and scripts/.
await refreshDirectory(resolve(repoDir, '.agents', 'skills', 'flovart'), resolve(packageDir, 'skill', 'flovart'));
await refreshDirectory(resolve(repoDir, '.agents', 'skills', 'open-flovart'), resolve(packageDir, 'skill', 'open-flovart'));
// Bundled Production Skills also ship inside the package so the packaged
// Managed Agent can bind them (skill/vox-director/); the loader checks both
// the repo checkout and this packaged location.
await refreshDirectory(
  resolve(repoDir, '.agents', 'skills', 'vox-director'),
  resolve(packageDir, 'skill', 'vox-director'),
);
for (const [name, content] of Object.entries(PACKAGE_LAYOUT_ALIASES)) {
  await writeFile(resolve(packageDir, 'managed-agent', name), content, 'utf8');
}
