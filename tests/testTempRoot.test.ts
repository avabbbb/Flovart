import { afterEach, describe, expect, it } from 'vitest';
import { assertTestPath, resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const originalGitHubActions = process.env.GITHUB_ACTIONS;

afterEach(() => {
  if (originalGitHubActions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = originalGitHubActions;
});

describe('test temporary path policy', () => {
  it('keeps local Windows test files on H and rejects C', () => {
    if (process.platform !== 'win32') return;
    delete process.env.GITHUB_ACTIONS;

    expect(resolveTestTempRoot('H:\\workspace', 'vitest')).toBe('H:\\workspace\\.tmp\\vitest');
    expect(() => assertTestPath('C:\\temp', 'Test files')).toThrow('must not use C:');
    expect(() => assertTestPath('D:\\temp', 'Test files')).toThrow('must use H:');
  });

  it('accepts a non-C GitHub runner path without weakening the C guard', () => {
    if (process.platform !== 'win32') return;
    process.env.GITHUB_ACTIONS = 'true';

    expect(resolveTestTempRoot('D:\\a\\Flovart\\Flovart', 'vitest')).toBe('D:\\a\\Flovart\\Flovart\\.tmp\\vitest');
    expect(() => assertTestPath('C:\\runner-temp', 'Runner files')).toThrow('must not use C:');
  });
});
