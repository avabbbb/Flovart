import { afterEach, describe, expect, it } from 'vitest';
import { assertTestPath, resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const originalGitHubActions = process.env.GITHUB_ACTIONS;
const originalRunnerTemp = process.env.RUNNER_TEMP;
const originalConfiguredRoot = process.env.FLOVART_TEST_TMP_ROOT;

afterEach(() => {
  if (originalGitHubActions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = originalGitHubActions;
  if (originalRunnerTemp === undefined) delete process.env.RUNNER_TEMP;
  else process.env.RUNNER_TEMP = originalRunnerTemp;
  if (originalConfiguredRoot === undefined) delete process.env.FLOVART_TEST_TMP_ROOT;
  else process.env.FLOVART_TEST_TMP_ROOT = originalConfiguredRoot;
});

describe('test temporary path policy', () => {
  it('keeps local Windows test files on H and rejects C', () => {
    if (process.platform !== 'win32') return;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.RUNNER_TEMP;
    delete process.env.FLOVART_TEST_TMP_ROOT;

    expect(resolveTestTempRoot('H:\\workspace', 'vitest')).toBe('H:\\workspace\\.tmp\\vitest');
    expect(() => assertTestPath('C:\\temp', 'Test files')).toThrow('must not use C:');
    expect(() => assertTestPath('D:\\temp', 'Test files')).toThrow('must use H:');
  });

  it('accepts a non-C GitHub runner path without weakening the C guard', () => {
    if (process.platform !== 'win32') return;
    process.env.GITHUB_ACTIONS = 'true';
    process.env.RUNNER_TEMP = 'D:\\a\\_temp';
    delete process.env.FLOVART_TEST_TMP_ROOT;

    expect(resolveTestTempRoot('D:\\a\\Flovart\\Flovart', 'vitest')).toBe('D:\\a\\_temp\\flovart-tests\\vitest');
    expect(() => assertTestPath('C:\\runner-temp', 'Runner files')).toThrow('must not use C:');
  });
});
