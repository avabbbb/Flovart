// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { discoverAgentHosts } from '../tools/flovart/host-discovery.js';
import {
  getHostRegistry,
  getDistributionTarget,
  resolveDirectorBinding,
  listAgentIdentities,
} from '../tools/flovart/host-registry.js';

describe('Flovart Host registry', () => {
  it('keeps Agent Identity, IDE, Distribution Target, Runtime Surface, and Binding as separate dimensions', () => {
    const registry = getHostRegistry();

    expect(registry.agentIdentities.map(item => item.id)).toContain('codebuddy-code');
    expect(registry.agentIdentities.map(item => item.id)).toContain('workbuddy');
    expect(registry.ideHosts.map(item => item.id)).toEqual(['cursor', 'windsurf', 'vscode']);
    expect(registry.distributionTargets.map(item => item.id)).toContain('codebuddy-code-skill');
    expect(registry.runtimeSurfaces.map(item => item.id)).toContain('browser-workflow');
    expect(registry.directorBindings.map(item => item.agentIdentityId)).not.toContain('workbuddy');
    expect(registry.directorBindings.map(item => item.agentIdentityId)).not.toContain('codebuddy-code');
  });

  it('discovers PATH executables while keeping manual Skill import separate from app detection', () => {
    const probed = [];
    const result = discoverAgentHosts({
      platform: 'win32',
      probe: identity => {
        probed.push(identity.id);
        return identity.id === 'codex'
          ? { available: true, executable: 'codex', path: 'C:\\tools\\codex.exe', version: 'codex 1.0.0' }
          : { available: false, executable: identity.executable, path: null, version: null };
      },
    });

    const codex = result.agents.find(item => item.id === 'codex');
    const workbuddy = result.agents.find(item => item.id === 'workbuddy');
    expect(codex).toMatchObject({ available: true, path: 'C:\\tools\\codex.exe', authStatus: 'not-inspected' });
    expect(workbuddy).toMatchObject({ status: 'manual-import', available: false, directorBinding: 'not-supported' });
    expect(workbuddy.runtimeSurfaces).toContain('browser-workflow');
  });

  it('maps canonical Agent Identity only where a Director Runtime Binding exists', () => {
    expect(resolveDirectorBinding('codex')).toMatchObject({ runtimeHostKind: 'codex' });
    expect(resolveDirectorBinding('deepseek-harness')).toMatchObject({ runtimeHostKind: 'deepseek' });
    expect(resolveDirectorBinding('workbuddy')).toBeNull();
    expect(resolveDirectorBinding('codebuddy-code')).toBeNull();
  });

  it('keeps user-facing projection aliases separate from canonical targets', () => {
    expect(getDistributionTarget('codex')).toMatchObject({ id: 'codex-skill' });
    expect(getDistributionTarget('codebuddy')).toMatchObject({ id: 'codebuddy-code-skill' });
  });

  it('uses an executable Windows shim for version probing instead of a shell script alias', () => {
    const calls = [];
    const result = discoverAgentHosts({
      platform: 'win32',
      runner: (command, args) => {
        calls.push({ command, args });
        if (command === 'where.exe' && args[0] === 'codex') {
          return { status: 0, stdout: 'C:\\tools\\codex\nC:\\tools\\codex.cmd\n' };
        }
        if (String(command).toLowerCase().endsWith('cmd.exe') && args[2] === '/c') return { status: 0, stdout: 'codex-cli 1.2.3\n' };
        return { status: 1, stdout: '' };
      },
    });

    expect(result.agents.find(item => item.id === 'codex')).toMatchObject({
      available: true,
      path: 'C:\\tools\\codex.cmd',
      version: 'codex-cli 1.2.3',
    });
    expect(calls).toContainEqual(expect.objectContaining({
      command: expect.stringMatching(/cmd\.exe$/i),
      args: ['/d', '/s', '/c', 'C:\\tools\\codex.cmd', '--version'],
    }));
  });
});

describe('host discovery cache', () => {
  it('serves cached results inside the TTL for the default probe', async () => {
    // Injected probes bypass the cache, so exercise the real spawnSync path
    // twice and assert the second call does not pay a rescan. Timing is
    // load-bearing here: an uncached rescan costs ~1s on this machine.
    const first = discoverAgentHosts({ includeVersion: false });
    const started = Date.now();
    const second = discoverAgentHosts({ includeVersion: false });
    const elapsed = Date.now() - started;
    expect(second).toEqual(first);
    expect(elapsed).toBeLessThan(50);
  });

  it('refresh=true bypasses the cache and pays a real rescan', () => {
    discoverAgentHosts({ includeVersion: false });
    const started = Date.now();
    const result = discoverAgentHosts({ includeVersion: false, refresh: true });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    // A real rescan spawns where.exe probes; on this machine that costs
    // hundreds of ms. Assert it took meaningful time so we know refresh did
    // not silently hit the cache.
    expect(elapsed).toBeGreaterThan(50);
  });

  it('injected probe/runner options bypass the cache so tests stay isolated', () => {
    let probes = 0;
    const options = {
      platform: 'win32',
      probe: () => {
        probes += 1;
        return { available: false, executable: null, path: null, version: null };
      },
    };
    discoverAgentHosts(options);
    discoverAgentHosts(options);
    // Both calls must have probed: if the cache swallowed the second call,
    // probes would equal the identity count from only one pass.
    const identityCount = listAgentIdentities().length;
    expect(probes).toBe(identityCount * 2);
  });

  it('re-scans once the TTL has expired instead of serving stale agents', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      // Populate the cache under fake time so no earlier real-time entry can
      // satisfy the assertion.
      const first = discoverAgentHosts({ includeVersion: false, refresh: true });
      vi.setSystemTime(new Date('2026-01-01T00:00:06Z'));
      const second = discoverAgentHosts({ includeVersion: false });
      expect(second.scannedAt).not.toBe(first.scannedAt);
      expect(second.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
