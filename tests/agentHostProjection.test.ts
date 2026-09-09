// @vitest-environment node

import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareAgentHostProjection } from '../agent/host-projection.js';
import { activateAgentHost, discoverAgentHosts, prepareAgentHostProjection as requestProjection } from '../services/agentHostDiscovery';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';

const available = (id: string) => ({ id, available: true });

afterEach(() => {
  useAgentConnectionStore.getState().reset();
});

describe('Agent Host Projection preparation', () => {
  it('prepares the selected coding-agent Skill without returning filesystem details', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'flovart-host-projection-'));
    mkdirSync(join(projectDir, '.agents'), { recursive: true });
    const result = prepareAgentHostProjection({
      agentIdentity: 'codex',
      projectDir,
      discover: () => ({ agents: [available('codex')] }),
    });

    expect(result).toMatchObject({
      ok: true,
      agentIdentity: { id: 'codex', label: 'Codex' },
      distributionTarget: { id: 'codex-skill', kind: 'skill' },
      projection: { status: 'ready', skillReady: true, bootstrapReady: true },
    });
    expect(JSON.stringify(result)).not.toContain(projectDir);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'flovart', 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(projectDir, '.agents', 'skills', 'flovart', 'SKILL.md'), 'utf8')).toContain('workflow.apply');
  });

  it('keeps DSH on its external Plugin/Profile projection', () => {
    const result = prepareAgentHostProjection({
      agentIdentity: 'deepseek-harness',
      discover: () => ({ agents: [available('deepseek-harness')] }),
    });
    expect(result).toMatchObject({ ok: true, projection: { status: 'external', skillReady: false } });
  });

  it('offers WorkBuddy import without claiming that the app or Skill is installed', () => {
    const result = prepareAgentHostProjection({ agentIdentity: 'workbuddy', discover: () => ({ agents: [] }) });
    expect(result).toMatchObject({
      ok: true,
      distributionTarget: { id: 'workbuddy-skill', kind: 'skill' },
      projection: { status: 'external', skillReady: false, bootstrapReady: false },
    });
  });

  it('does not prepare a projection for an unavailable Host', () => {
    expect(prepareAgentHostProjection({ agentIdentity: 'codebuddy-code', discover: () => ({ agents: [] }) })).toMatchObject({
      ok: false,
      error: { code: 'HOST_UNAVAILABLE' },
    });
  });

  it('posts only the selected identity and keeps the token out of the response', async () => {
    const requests: Request[] = [];
    const result = await requestProjection('codex', {
      discover: async () => ({ url: 'http://127.0.0.1:17373', token: 'secret-token' } as never),
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({
          ok: true,
          agentIdentity: { id: 'codex', label: 'Codex' },
          distributionTarget: { id: 'codex-skill', label: 'Codex Skill', kind: 'skill' },
          projection: { status: 'ready', skillReady: true, bootstrapReady: true, message: 'Codex 的 Flovart Skill 已准备。' },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    expect(result.projection.status).toBe('ready');
    expect(requests[0].url).toBe('http://127.0.0.1:17373/hosts/prepare');
    expect(await requests[0].json()).toEqual({ agentIdentity: 'codex' });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('uses the lightweight discovery request for the Host Picker', async () => {
    const requests: Request[] = [];
    await discoverAgentHosts({
      discover: async () => ({ url: 'http://127.0.0.1:17373', token: 'secret-token' } as never),
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({ ok: true, agents: [] }), { status: 200 });
      },
    });
    expect(new URL(requests.at(-1)!.url).searchParams.get('includeVersion')).toBe('false');
  });

  it('activates a selected Browser-capable Host without exposing the local token', async () => {
    const requests: Request[] = [];
    const result = await activateAgentHost('claude-code', {
      discover: async () => ({ url: 'http://127.0.0.1:17373', token: 'secret-token' } as never),
      fetchImpl: async (input, init) => {
        requests.push(new Request(input, init));
        return new Response(JSON.stringify({
          ok: true,
          activeHostWriter: { agentIdentity: 'claude-code', projectId: 'project-1', hasSessionId: false },
          switched: true,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });

    expect(result).toMatchObject({ switched: true, activeHostWriter: { agentIdentity: 'claude-code' } });
    expect(requests[0].url).toBe('http://127.0.0.1:17373/host/activate');
    expect(await requests[0].json()).toEqual({ agentIdentity: 'claude-code' });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});
