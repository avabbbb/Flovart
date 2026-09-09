import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureVisibleWorkflow, harnessEnvironment, uninstall } from '../dsh-plugin/scripts/profile.mjs';
import { WorkspaceSupervisor } from '../dsh-plugin/scripts/workspace-supervisor.mjs';

class FakeChild extends EventEmitter {
  exitCode = null;
  kill = () => {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.emit('exit', 0);
  };

  crash(code = 1) {
    this.exitCode = code;
    this.emit('exit', code);
  }
}

describe('Flovart Harness launcher', () => {
  it('uses ensure for profile bootstrap instead of creating a hidden Director binding', () => {
    const assembly = JSON.parse(readFileSync(join(process.cwd(), 'dsh-plugin', 'assembly.json'), 'utf8'));
    const bootstrap = assembly.entrypoints?.hostTools?.bootstrap;

    expect(bootstrap).toBe('flovart ensure --json');
    expect(bootstrap).not.toContain('director.bind');
    expect(assembly.entrypoints?.workflowView).toMatchObject({
      kind: 'contextual-conversation-view',
      autoWorkspace: true,
      sidebarEntry: false,
    });
  });

  it('injects an opaque Workspace session instead of user-facing Agent fields', () => {
    const env = harnessEnvironment(
      { url: 'http://127.0.0.1:17372', token: 'opaque-session-token' },
      'H:\\Flovart Project',
      'H:\\Flovart Project\\workspace',
    );

    expect(env).toMatchObject({
      FLOVART_WORKSPACE_URL: 'http://127.0.0.1:17372',
      FLOVART_WORKSPACE_TOKEN: 'opaque-session-token',
      FLOVART_WORKSPACE_MODE: 'browser',
      FLOVART_AGENT_HOME: 'H:\\Flovart Project\\workspace',
      FLOVART_AGENT_CONFIG: 'H:\\Flovart Project\\workspace\\agent.json',
      FLOVART_CREW_DIR: 'H:\\Flovart Project\\workspace\\crew',
    });
    expect(env.FLOVART_CLI).toContain('tools\\flovart\\cli.js');
    expect(env).not.toHaveProperty('FLOVART_AGENT_URL');
    expect(env).not.toHaveProperty('FLOVART_AGENT_TOKEN');
  });

  it('ensures the visible Browser Workflow through the same CLI authority', () => {
    const calls = [];
    const result = ensureVisibleWorkflow({
      FLOVART_CLI: 'node "H:\\Flovart Project\\tools\\flovart\\cli.js"',
    }, (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: JSON.stringify({ ok: true, data: { ok: true, state: 'ready', browser: 'ready' } }) };
    });

    expect(result).toMatchObject({ ok: true, result: { state: 'ready', browser: 'ready' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['H:\\Flovart Project\\tools\\flovart\\cli.js', 'ensure', '--json']);
    expect(calls[0].options.cwd).toBe(process.cwd());
  });

  it('restarts an owned Workspace Operator after an unexpected exit', async () => {
    const config = { url: 'http://127.0.0.1:17372', token: 'stable-token' };
    const children = [];
    const supervisor = new WorkspaceSupervisor({
      readConfig: () => config,
      probe: async () => children.length > 0 ? { serviceMode: 'workspace-only' } : null,
      spawnWorkspace: () => {
        const child = new FakeChild();
        children.push(child);
        return child;
      },
      delay: async () => {},
      readinessAttempts: 2,
      restartDelays: [0],
    });

    expect(await supervisor.start()).toEqual({ config, ownership: 'owned' });
    children[0].crash();

    await expect.poll(() => children.length).toBe(2);
    expect(supervisor.snapshot()).toMatchObject({ state: 'running', ownership: 'owned', restarts: 1 });
    expect(supervisor.snapshot().config).toEqual(config);
    await supervisor.stop();
    expect(children[1].exitCode).toBe(0);
  });

  it('borrows but never restarts or kills an existing Workspace Operator', async () => {
    const config = { url: 'http://127.0.0.1:17372', token: 'external-token' };
    let spawns = 0;
    const supervisor = new WorkspaceSupervisor({
      readConfig: () => config,
      probe: async () => ({ serviceMode: 'workspace-only' }),
      spawnWorkspace: () => {
        spawns += 1;
        return new FakeChild();
      },
      delay: async () => {},
    });

    expect(await supervisor.start()).toEqual({ config, ownership: 'external' });
    await supervisor.stop();
    expect(spawns).toBe(0);
    expect(supervisor.snapshot()).toMatchObject({ state: 'stopped', ownership: 'external', restarts: 0 });
  });

  it('fails loudly if a restarted Operator changes the session URL or token', async () => {
    let config = { url: 'http://127.0.0.1:17372', token: 'stable-token' };
    const children = [];
    const supervisor = new WorkspaceSupervisor({
      readConfig: () => config,
      probe: async () => children.length > 0 ? { serviceMode: 'workspace-only' } : null,
      spawnWorkspace: () => {
        const child = new FakeChild();
        children.push(child);
        if (children.length === 2) config = { ...config, token: 'changed-token' };
        return child;
      },
      delay: async () => {},
      readinessAttempts: 2,
      restartDelays: [0],
      maxRestarts: 1,
    });

    await supervisor.start();
    const failure = supervisor.waitForFailure();
    children[0].crash();

    await expect(failure).resolves.toMatchObject({ message: expect.stringContaining('URL 或 Token') });
    expect(children[1].exitCode).toBe(0);
  });

  it('uninstalls only the app-managed Flovart profile and preserves the workspace directory', () => {
    const home = join(tmpdir(), `flovart-dsh-uninstall-${process.pid}-${Date.now()}`);
    const profile = join(home, 'profiles', 'flovart');
    const workspace = join(home, 'workspace');
    try {
      mkdirSync(profile, { recursive: true });
      mkdirSync(workspace, { recursive: true });
      writeFileSync(join(profile, 'package.json'), '{}');
      writeFileSync(join(workspace, 'session-marker.json'), '{}');

      expect(uninstall(home)).toMatchObject({ removed: true, profileDir: profile });
      expect(existsSync(profile)).toBe(false);
      expect(existsSync(workspace)).toBe(true);
      expect(existsSync(join(workspace, 'session-marker.json'))).toBe(true);
      expect(uninstall(home).removed).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
