import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'integrations', 'workbuddy', 'iris');

describe('WorkBuddy CLI connector', () => {
  it('matches the current official CLI connector shape without a fake OAuth flow', () => {
    const meta = JSON.parse(readFileSync(join(root, 'connector-meta.json'), 'utf8'));
    const cli = JSON.parse(readFileSync(join(root, 'cli.json'), 'utf8'));
    expect(meta).toMatchObject({ type: 'cli', source: 'iris', minWorkbuddyVersion: '5.0.0' });
    expect(cli.runtime).toEqual({ type: 'node', version: '22' });
    for (const section of ['init', 'auth', 'status', 'unAuth']) {
      expect(Object.keys(cli[section])).toEqual(['darwin', 'linux', 'win32']);
      // init installs the npm package, which keeps the @flovart scope; every other command runs the iris-cli bin.
      const needle = section === 'init' ? '@flovart/cli' : 'iris-cli';
      expect(Object.values(cli[section]).every(value => typeof value === 'string' && value.includes(needle))).toBe(true);
    }
    expect(cli.statusMatch).toContain('local-ready');
    expect(JSON.stringify({ meta, cli })).not.toMatch(/(?:api.?key|provider.?key|secret|token)/i);
  });

  it('keeps the skill on ensure/inspect/selection/apply/run and away from plumbing', () => {
    const skill = readFileSync(join(root, 'skills', 'iris', 'SKILL.md'), 'utf8');
    expect(skill).toContain('iris-cli ensure --json');
    expect(skill).toContain('workflow.apply');
    expect(skill).toContain('workflow.node.run');
    expect(skill).not.toMatch(/agentUrl|agentToken|x-flovart-agent-token|MCP|端口|Token/i);
  });

  it('generates a clean connector artifact', () => {
    execFileSync(process.execPath, ['integrations/workbuddy/build.mjs'], { cwd: process.cwd(), stdio: 'pipe' });
    expect(existsSync(join(process.cwd(), 'dist-workbuddy', 'iris', 'connector-meta.json'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'dist-workbuddy', 'iris', 'skills', 'iris', 'SKILL.md'))).toBe(true);
  });
});
