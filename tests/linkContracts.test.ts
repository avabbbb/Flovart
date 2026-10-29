import { describe, expect, it } from 'vitest';
import { createFlovartHostRegistry, getFlovartHostDefinition } from '../services/link/hostRegistry';
import { toLinkPublicStatus } from '../services/link/publicStatus';

describe('Flovart Link contracts', () => {
  it('keeps host definitions declarative and gives every host the same capabilities', () => {
    const hosts = createFlovartHostRegistry();
    expect(hosts.map(host => host.id)).toEqual(expect.arrayContaining(['codex', 'workbuddy']));
    expect(getFlovartHostDefinition('codex')?.capabilities).toMatchObject({ inspect: true, mutate: true, run: true, selection: true });
    expect(getFlovartHostDefinition('deepseek-harness')).toBeNull();
    expect(getFlovartHostDefinition('missing')).toBeNull();
  });

  it.each([
    [{ service: 'ready', browserConnected: true, writerActive: true, host: { available: true, status: 'available' } }, 'ready', 'use'],
    [{ service: 'ready', host: { available: false, status: 'manual-import' } }, 'needs_setup', 'setup'],
    [{ service: 'ready', host: { available: true, status: 'available', authStatus: 'needs-login' } }, 'needs_login', 'login'],
    [{ service: 'offline', host: { available: true, status: 'available' } }, 'offline', 'repair'],
    [{ service: 'offline', host: { available: false, status: 'manual-import' } }, 'offline', 'repair'],
  ] as const)('projects internal state %o to %s', (input, state, action) => {
    expect(toLinkPublicStatus(input)).toMatchObject({ state, action });
  });
});
