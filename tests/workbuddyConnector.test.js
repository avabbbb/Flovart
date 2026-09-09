import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(process.cwd(), 'integrations', 'workbuddy', 'flovart');

describe('WorkBuddy CLI connector', () => {
  it('matches the current official CLI connector shape without a fake OAuth flow', () => {
    const meta = JSON.parse(readFileSync(join(root, 'connector-meta.json'), 'utf8'));
    const cli = JSON.parse(readFileSync(join(root, 'cli.json'), 'utf8'));
    expect(meta).toMatchObject({ type: 'cli', source: 'flovart', minWorkbuddyVersion: '5.0.0' });
    expect(cli.runtime).toEqual({ type: 'node', version: '22' });
    for (const section of ['init', 'auth', 'status', 'unAuth']) {
      expect(Object.keys(cli[section])).toEqual(['darwin', 'linux', 'win32']);
      expect(Object.values(cli[section]).every(value => typeof value === 'string' && value.includes('flovart'))).toBe(true);
    }
    expect(cli.statusMatch).toContain('local-ready');
    expect(JSON.stringify({ meta, cli })).not.toMatch(/(?:api.?key|provider.?key|secret|token)/i);
  });

  it('keeps the skill on ensure/inspect/selection/apply/run and away from plumbing', () => {
    const skill = readFileSync(join(root, 'skills', 'flovart', 'SKILL.md'), 'utf8');
    expect(skill).toContain('flovart-cli ensure --json');
    expect(skill).toContain('workflow.apply');
    expect(skill).toContain('workflow.node.run');
    expect(skill).not.toMatch(/agentUrl|agentToken|x-flovart-agent-token|MCP|端口|Token/i);
  });

  it('generates a clean connector artifact', () => {
    execFileSync(process.execPath, ['integrations/workbuddy/build.mjs'], { cwd: process.cwd(), stdio: 'pipe' });
    expect(existsSync(join(process.cwd(), 'dist-workbuddy', 'flovart', 'connector-meta.json'))).toBe(true);
    expect(existsSync(join(process.cwd(), 'dist-workbuddy', 'flovart', 'skills', 'flovart', 'SKILL.md'))).toBe(true);
  });
});
