import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testTempRoot = resolve(projectDir, '.tmp', 'vitest');
if (parse(testTempRoot).root.toUpperCase() !== 'H:\\') throw new Error(`Critical tests must use an H: temp root: ${testTempRoot}`);
mkdirSync(testTempRoot, { recursive: true });

const repeat = Number(process.env.FLOVART_CRITICAL_REPEATS || process.argv[2] || 10);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
  throw new Error('FLOVART_CRITICAL_REPEATS must be an integer from 1 to 20.');
}

const files = [
  'tests/workflowMigration.test.ts',
  'tests/workflowAgentSession.test.js',
  'tests/agentConnectionBootstrap.test.ts',
  'tests/releaseCandidateProviderResilience.test.ts',
  'tests/runtimeCredentials.test.ts',
  'tests/skillPackage.test.ts',
  'tests/agentSkillRegistry.test.ts',
  'tests/offlineShell.test.ts',
  'tests/offlineShell.test.tsx',
];

const command = process.execPath;
const args = ['node_modules/vitest/vitest.mjs', 'run', ...files, '--reporter=dot'];
const startedAt = Date.now();

for (let index = 1; index <= repeat; index += 1) {
  console.log(`\n=== Critical suite ${index}/${repeat} ===`);
  const result = spawnSync(command, args, {
    cwd: projectDir,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true', TEMP: testTempRoot, TMP: testTempRoot, TMPDIR: testTempRoot },
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Critical suite failed on repetition ${index}.`);
    process.exit(result.status || 1);
  }
}

console.log(`\nCritical suite green: ${repeat}/${repeat} (${((Date.now() - startedAt) / 1000).toFixed(1)}s).`);
