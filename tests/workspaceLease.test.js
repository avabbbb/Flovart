import { describe, expect, it } from 'vitest';
import { WorkspaceLeaseError, WorkspaceLeaseManager } from '../agent/workspace-lease.js';

describe('WorkspaceLeaseManager', () => {
  it('acquires, renews, validates, releases, and expires a lease', () => {
    let now = 1_000;
    const manager = new WorkspaceLeaseManager({ ttlMs: 100, now: () => now, idFactory: () => 'lease-1' });
    const lease = manager.acquire({ agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', baseRevision: 4 });
    expect(lease).toMatchObject({ leaseId: 'lease-1', agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', baseRevision: 4, issuedAt: 1_000, expiresAt: 1_100 });
    now = 1_050;
    expect(manager.validate({ ...lease, agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', currentClientId: 'browser-a', currentProjectId: 'project-a', expectedRevision: 4, currentRevision: 4 })).toMatchObject({ expiresAt: 1_150 });
    expect(manager.release('lease-1')).toBe(true);
    expect(manager.get('lease-1')).toBeNull();
    const next = manager.acquire({ agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', baseRevision: 4 });
    now = 2_000;
    manager.expire();
    expect(manager.get(next.leaseId)).toBeNull();
  });

  it('does not follow an owner to a changed project or browser client', () => {
    const manager = new WorkspaceLeaseManager({ idFactory: () => 'lease-1' });
    manager.acquire({ agentIdentity: 'codex', hostSessionId: 'turn-1', clientId: 'browser-a', projectId: 'project-a', baseRevision: 1 });
    expect(() => manager.acquire({ agentIdentity: 'codex', hostSessionId: 'turn-1', clientId: 'browser-b', projectId: 'project-b', baseRevision: 1 })).toThrowError(new RegExp('目标已经改变'));
    let targetError;
    try { manager.validate({ leaseId: 'lease-1', agentIdentity: 'codex', hostSessionId: 'turn-1', clientId: 'browser-a', projectId: 'project-a', currentClientId: 'browser-a', currentProjectId: 'project-b', mutation: true, mutationId: 'mutation-1' }); } catch (error) { targetError = error; }
    expect(targetError).toMatchObject({ code: 'LEASE_TARGET_CHANGED' });
  });

  it('returns structured revision and workspace failures', () => {
    const manager = new WorkspaceLeaseManager({ idFactory: () => 'lease-1' });
    const lease = manager.acquire({ agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', baseRevision: 3 });
    let revisionError;
    try { manager.validate({ leaseId: lease.leaseId, agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', currentClientId: 'browser-a', currentProjectId: 'project-a', expectedRevision: 2, currentRevision: 3, mutation: true, mutationId: 'mutation-1' }); } catch (error) { revisionError = error; }
    expect(revisionError).toMatchObject({ code: 'REVISION_CONFLICT', details: { expectedRevision: 2, actualRevision: 3 } });
    let unavailableError;
    try { manager.validate({ leaseId: lease.leaseId, agentIdentity: 'codex', clientId: 'browser-a', projectId: 'project-a', currentClientId: null, currentProjectId: null }); } catch (error) { unavailableError = error; }
    expect(unavailableError).toMatchObject({ code: 'WORKSPACE_UNAVAILABLE' });
    let missingError;
    try { manager.validate({ leaseId: 'missing', agentIdentity: 'codex' }); } catch (error) { missingError = error; }
    expect(missingError).toBeInstanceOf(WorkspaceLeaseError);
  });

  it('keeps the lease target stable across an inspect/apply/run turn', () => {
    const manager = new WorkspaceLeaseManager({ idFactory: () => 'turn-lease' });
    const first = manager.acquire({ agentIdentity: 'codex', hostSessionId: 'turn-1', clientId: 'browser-a', projectId: 'project-a', baseRevision: 7 });
    const inspected = manager.validate({
      leaseId: first.leaseId,
      agentIdentity: 'codex',
      hostSessionId: 'turn-1',
      clientId: 'browser-a',
      projectId: 'project-a',
      currentClientId: 'browser-a',
      currentProjectId: 'project-a',
    });
    const applied = manager.validate({
      leaseId: inspected.leaseId,
      agentIdentity: 'codex',
      hostSessionId: 'turn-1',
      clientId: 'browser-a',
      projectId: 'project-a',
      currentClientId: 'browser-a',
      currentProjectId: 'project-a',
      expectedRevision: 7,
      currentRevision: 7,
      mutation: true,
      mutationId: 'mutation-1',
    });
    expect(applied.leaseId).toBe(first.leaseId);
    expect(() => manager.validate({
      leaseId: applied.leaseId,
      agentIdentity: 'codex',
      hostSessionId: 'turn-1',
      clientId: 'browser-a',
      projectId: 'project-b',
      currentClientId: 'browser-a',
      currentProjectId: 'project-b',
    })).toThrowError(new RegExp('目标已改变|目标已经改变|项目目标'));
  });
});
