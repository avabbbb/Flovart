import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureHostReady, LinkActivationError } from '../services/link/hostActivation';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';
import type { AgentHostDiscovery } from '../services/agentHostDiscovery';

const available: AgentHostDiscovery = {
  ok: true,
  state: 'ready',
  agents: [{
    id: 'codex', label: 'Codex', category: 'coding-agent', status: 'available', available: true,
    executable: 'codex', path: null, version: null, authStatus: 'not-inspected', distributionTargets: [], runtimeSurfaces: [], directorBinding: 'supported', diagnostic: '',
  }],
};

beforeEach(() => {
  useAgentConnectionStore.getState().reset();
  useAgentConnectionStore.getState().setStatus('ready', { clientId: 'client-a', projectId: 'project-a', writerStatus: 'inactive' });
});

afterEach(() => useAgentConnectionStore.getState().reset());

describe('Flovart Link host activation', () => {
  it('owns the prepare → writer → host sequence in one coordinator', async () => {
    const order: string[] = [];
    const result = await ensureHostReady('codex', {
      discover: vi.fn().mockResolvedValue(available),
      prepare: vi.fn().mockImplementation(async () => { order.push('prepare'); return { ok: true }; }),
      activateWriter: vi.fn().mockImplementation(async () => { order.push('writer'); return {}; }),
      activateHost: vi.fn().mockImplementation(async () => { order.push('host'); return { activeHostWriter: { agentIdentity: 'codex', projectId: 'project-a', hasSessionId: false }, switched: false }; }),
    });
    expect(order).toEqual(['prepare', 'writer', 'host']);
    expect(result).toMatchObject({ activeHostWriter: { agentIdentity: 'codex', projectId: 'project-a' } });
  });

  it('returns setup state for an external/manual host without pretending activation', async () => {
    const activate = vi.fn();
    const result = await ensureHostReady('workbuddy', {
      discover: vi.fn().mockResolvedValue({ ok: true, state: 'ready', agents: [] }),
      activateHost: activate,
    });
    expect(result).toEqual({ state: 'needs_setup', hostId: 'workbuddy' });
    expect(activate).not.toHaveBeenCalled();
  });

  it('does not turn a failed local discovery into host setup', async () => {
    await expect(ensureHostReady('codex', {
      discover: vi.fn().mockResolvedValue({ ok: false, state: 'offline', agents: [], error: 'Agent service stopped' }),
    })).rejects.toMatchObject({ code: 'LINK_OFFLINE' });
  });

  it('fails safely when the project changes during preparation', async () => {
    const prepare = vi.fn().mockImplementation(async () => {
      useAgentConnectionStore.getState().setStatus('ready', { projectId: 'project-b' });
      return { ok: true };
    });
    await expect(ensureHostReady('codex', { discover: vi.fn().mockResolvedValue(available), prepare })).rejects.toMatchObject({ code: 'LEASE_TARGET_CHANGED' });
  });

  it('does not probe or re-activate an already active host', async () => {
    useAgentConnectionStore.getState().setStatus('ready', { activeHostIdentity: 'codex', activeHostProjectId: 'project-a', writerStatus: 'active' });
    const discover = vi.fn();
    await expect(ensureHostReady('codex', { discover })).resolves.toMatchObject({ switched: false });
    expect(discover).not.toHaveBeenCalled();
  });

  it('uses structured public errors when the workspace is absent', async () => {
    useAgentConnectionStore.getState().setStatus('ready', { projectId: null });
    await expect(ensureHostReady('codex')).rejects.toBeInstanceOf(LinkActivationError);
    await expect(ensureHostReady('codex')).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' });
  });
});
