import { describe, expect, it } from 'vitest';
import { parseDevArgs, planInstall, planStart } from '../tools/flovart/dev-commands.js';
import { buildTuiCommand, tokenizeTuiLine } from '../tools/flovart/tui.js';

describe('flovart dev startup commands', () => {
  it('plans frontend-only local startup without database', () => {
    const plan = planStart(['--source', '--web', '--open'], process.cwd());

    expect(plan).toMatchObject({
      command: 'start',
      mode: 'local',
      services: ['web'],
      openBrowser: true,
    });
    expect(plan.urls).toEqual({ web: 'http://localhost:11451' });
  });

  it('plans backend startup with PostgreSQL dependency', () => {
    const plan = planStart(['--source', '--backend'], process.cwd());

    expect(plan.mode).toBe('local');
    expect(plan.services).toEqual(['db', 'hub', 'enterprise']);
    expect(plan.openBrowser).toBe(false);
  });

  it('plans full docker startup with detached mode', () => {
    const plan = planStart(['--source', '--docker', '--all', '--detach', '--open'], process.cwd());

    expect(plan).toMatchObject({
      mode: 'docker',
      services: ['db', 'hub', 'enterprise', 'web'],
      detach: true,
      openBrowser: true,
    });
  });

  it('keeps install scoped to requested services', () => {
    expect(planInstall(['--source', '--web'], process.cwd()).services).toEqual(['web']);
    expect(planInstall(['--source', '--backend'], process.cwd()).services).toEqual(['hub', 'enterprise']);
    expect(parseDevArgs(['web', '--plan', '--json'])).toMatchObject({ web: true, plan: true, json: true });
  });

  it('maps TUI slash commands to existing CLI commands', () => {
    expect(buildTuiCommand('/START')).toEqual({ type: 'run', args: ['start'] });
    expect(buildTuiCommand('/web --plan')).toEqual({ type: 'run', args: ['start', '--source', '--web', '--open', '--plan'] });
    expect(buildTuiCommand('/docker -d')).toEqual({ type: 'run', args: ['start', '--source', '--docker', '--all', '--open', '-d'] });
    expect(buildTuiCommand('/plan --backend')).toEqual({ type: 'run', args: ['start', '--plan', '--json', '--backend'] });
    expect(buildTuiCommand('/runtime')).toEqual({ type: 'run', args: ['runtime.status', '--json'] });
    expect(buildTuiCommand('/workspace')).toEqual({ type: 'run', args: ['workspace.status', '--json'] });
    expect(buildTuiCommand('/tasks')).toEqual({ type: 'run', args: ['task.list', '--limit', '20', '--json'] });
    expect(buildTuiCommand('/research')).toEqual({ type: 'unknown', name: 'research (topic required)' });
    expect(buildTuiCommand('/research US politics')).toMatchObject({
      type: 'run',
      args: [
        'research.topic.collect',
        '--topic',
        'US politics',
        '--sources',
        '["reddit","x"]',
        '--idempotency-key',
        expect.stringMatching(/^tui-research-\d+$/),
        '--json',
      ],
    });
    expect(buildTuiCommand('/exit')).toEqual({ type: 'exit' });
  });

  it('tokenizes quoted TUI commands', () => {
    expect(tokenizeTuiLine('/run prompt.enhance --prompt "red car"')).toEqual(['/run', 'prompt.enhance', '--prompt', 'red car']);
  });
});
