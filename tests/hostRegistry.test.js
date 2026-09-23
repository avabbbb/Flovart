// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { discoverAgentHosts } from '../tools/flovart/host-discovery.js';
import {
  getHostRegistry,
  getDistributionTarget,
  listAgentIdentities,
} from '../tools/flovart/host-registry.js';

describe('Flovart Host registry', () => {
  it('keeps Agent Identity, IDE, Distribution Target, and Runtime Surface as separate dimensions', () => {
    const registry = getHostRegistry();

    expect(registry.agentIdentities.map(item => item.id)).toContain('codebuddy-code');
    expect(registry.agentIdentities.map(item => item.id)).toContain('workbuddy');
    expect(registry.ideHosts.map(item => item.id)).toEqual(['cursor', 'windsurf', 'vscode']);
    expect(registry.distributionTargets.map(item => item.id)).toContain('codebuddy-code-skill');
    expect(registry.runtimeSurfaces.map(item => item.id)).toContain('browser-workflow');
    expect(registry.directorBindings).toBeUndefined();
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
    expect(workbuddy).toMatchObject({ status: 'manual-import', available: false });
    expect(workbuddy.runtimeSurfaces).toContain('browser-workflow');
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
    // twice and assert the second call does not pay a rescan. Instead of a
    // fragile wall-clock threshold, assert the cache returns the same
    // scannedAt timestamp (a rescan would produce a new one).
    const first = discoverAgentHosts({ includeVersion: false });
    const second = discoverAgentHosts({ includeVersion: false });
    expect(second).toEqual(first);
    expect(second.scannedAt).toBe(first.scannedAt);
  });

  it('refresh=true bypasses the cache and pays a real rescan', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      // Populate the cache under fake time so no earlier real-time entry can
      // satisfy the assertion.
      const first = discoverAgentHosts({ includeVersion: false, refresh: true });
      vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
      const result = discoverAgentHosts({ includeVersion: false, refresh: true });
      expect(result.ok).toBe(true);
      // A real rescan produces a new scannedAt timestamp; using fake timers
      // avoids machine-dependent wall-clock thresholds.
      expect(result.scannedAt).not.toBe(first.scannedAt);
    } finally {
      vi.useRealTimers();
    }
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
