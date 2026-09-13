import { parse, resolve } from 'node:path';

const isGitHubActions = () => process.env.GITHUB_ACTIONS === 'true';

export function assertTestPath(targetPath, label = 'Test path') {
  const absolutePath = resolve(targetPath);
  if (process.platform !== 'win32') return absolutePath;

  const driveRoot = parse(absolutePath).root.toUpperCase();
  if (driveRoot === 'C:\\') throw new Error(`${label} must not use C: ${absolutePath}`);
  if (!isGitHubActions() && driveRoot !== 'H:\\') {
    throw new Error(`${label} must use H: for local Windows runs: ${absolutePath}`);
  }
  return absolutePath;
}

export function resolveTestTempRoot(projectDir, leaf = '') {
  const configuredRoot = process.env.FLOVART_TEST_TMP_ROOT?.trim();
  const runnerTemp = isGitHubActions() ? process.env.RUNNER_TEMP?.trim() : '';
  // GitHub's checkout directory can carry broad inherited ACLs. Keep test
  // discovery records and their ACL snapshots in the runner-owned temp area.
  const baseRoot = configuredRoot
    ? resolve(configuredRoot)
    : runnerTemp
      ? resolve(runnerTemp, 'flovart-tests')
      : resolve(projectDir, '.tmp');
  return assertTestPath(resolve(baseRoot, leaf), 'Test temporary files');
}
