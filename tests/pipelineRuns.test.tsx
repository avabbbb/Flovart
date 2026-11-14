import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import {
  fetchPipelineRuns,
  fetchPipelineTrace,
  pickVersionRenders,
  planPipelineVersionNodes,
  pipelineBatchId,
  type PipelineTrace,
} from '../services/pipelineRuns';

vi.mock('../services/managedAgentConnection', () => ({
  getManagedAgentConnection: vi.fn(async () => ({ state: 'ready', url: 'http://127.0.0.1:4000', token: 't', managed: true })),
}));

const trace = {
  run: { id: 'run_a', projectId: 'p', title: '演示', status: 'passed', headVersion: 2 },
  steps: [
    { seq: 1, stepId: 's1', tool: 'pipeline.run.start', caller: 'built-in', status: 'succeeded', mutationId: null, attempts: 1, artifactIds: [], costMicros: 0, startedAt: 1, finishedAt: 2 },
    { seq: 2, stepId: 's2', tool: 'composition.patch', caller: 'built-in', status: 'failed', mutationId: 'm', attempts: 1, artifactIds: [], costMicros: 0, error: { code: 'CLIP_LOCKED', message: 'locked' }, startedAt: 3, finishedAt: 4 },
  ],
  versions: [
    { version: 1, parentVersion: null, durationMs: 4000, locked: [], reviews: [1], renders: [
      { renderId: 'r1', preset: 'still', atSec: 1, engine: 'ffmpeg', artifactId: 'still1', rejected: false, issues: [] },
      { renderId: 'r2', preset: 'draft', atSec: null, engine: 'ffmpeg', artifactId: 'draft1', rejected: false, issues: [] },
    ] },
    { version: 2, parentVersion: 1, durationMs: 4000, locked: ['a'], reviews: [2], renders: [
      { renderId: 'r3', preset: 'draft', atSec: null, engine: 'ffmpeg', artifactId: 'draft2', rejected: false, issues: [] },
      { renderId: 'r4', preset: 'final', atSec: null, engine: 'ffmpeg', artifactId: 'final2', rejected: false, issues: [] },
      { renderId: 'r5', preset: 'final', atSec: null, engine: 'ffmpeg', artifactId: 'bad', rejected: true, issues: [] },
    ] },
    { version: 3, parentVersion: 2, durationMs: 4000, locked: [], reviews: [], renders: [] },
  ],
  rounds: [
    { id: 'rv1', round: 1, version: 1, reviewer: 'agent', verdict: 'revise', findings: [] },
    { id: 'rv2', round: 2, version: 2, reviewer: 'agent', verdict: 'pass', findings: [] },
  ],
  spend: { confirmedTasks: 0, pendingTasks: 0, maxTasks: 3, maxRounds: 3 },
  blocker: null,
  resumeFrom: null,
} as unknown as PipelineTrace;

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('pipeline runs (Canvas drawer)', () => {
  it('picks the best non-rejected video render per version, newest verdict attached', () => {
    expect(pickVersionRenders(trace)).toEqual([
      { version: 1, artifactId: 'draft1', preset: 'draft', verdict: 'revise' },
      { version: 2, artifactId: 'final2', preset: 'final', verdict: 'pass' },
    ]);
  });

  it('groups versions into one batch per run and skips artifacts already on the canvas', () => {
    const renders = pickVersionRenders(trace);
    const existing = [{ id: 'n1', batchId: pipelineBatchId('run_a'), batchIndex: 0, metadata: { pipelineRender: { runId: 'run_a', version: 1, artifactId: 'draft1', preset: 'draft' } } }];
    const plan = planPipelineVersionNodes(existing, 'run_a', renders);
    expect(plan.batchId).toBe('pipeline-run_a');
    expect(plan.missing.map(item => item.artifactId)).toEqual(['final2']);
    expect(plan.latestVersion).toBe(2);
  });

  it('reads runs and traces with the agent token and surfaces agent errors', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['x-flovart-agent-token']).toBe('t');
      if (url.endsWith('/pipeline/runs?limit=20')) return okJson({ ok: true, runs: [{ runId: 'run_a' }] });
      if (url.endsWith('/pipeline/runs/run_a')) return okJson({ ok: true, trace });
      return new Response(JSON.stringify({ ok: false, error: { code: 'RUN_NOT_FOUND', message: '找不到 run：x' } }), { status: 404 });
    }) as unknown as typeof fetch;
    const connection = { url: 'http://127.0.0.1:4000', token: 't' };
    expect(await fetchPipelineRuns(connection, {}, fetchImpl)).toEqual([{ runId: 'run_a' }]);
    expect((await fetchPipelineTrace(connection, 'run_a', fetchImpl)).run.id).toBe('run_a');
    await expect(fetchPipelineTrace(connection, 'x', fetchImpl)).rejects.toThrow('找不到 run：x');
  });
});

describe('AgentPipelineRunsSection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/pipeline/runs?')) {
        return okJson({ ok: true, runs: [{ runId: 'run_a', projectId: 'p', title: '演示', status: 'blocked', headVersion: 2, blocker: { code: 'PROVIDER_FAILED', message: 'TTS 失败' }, stepCount: 2, failedSteps: 1, lastVerdict: { round: 2, version: 2, verdict: 'pass', reviewer: 'agent' }, createdAt: 1, updatedAt: 2 }] });
      }
      return okJson({ ok: true, trace });
    }));
  });

  it('shows one card per run and expands into its steps', async () => {
    const { AgentPipelineRunsSection } = await import('../components/agent/AgentPipelineRunsSection');
    render(<AgentPipelineRunsSection language="zho" />);
    const card = await screen.findByTestId('pipeline-run-card');
    expect(card.textContent).toContain('演示');
    expect(card.textContent).toContain('已阻塞');
    expect(card.textContent).toContain('第 2 轮 通过');
    expect(card.textContent).toContain('PROVIDER_FAILED: TTS 失败');
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    await waitFor(() => expect(screen.getByTestId('pipeline-run-trace').textContent).toContain('CLIP_LOCKED'));
    expect(screen.getByTestId('pipeline-run-trace').textContent).toContain('v2 · 锁定 1 · 通过');
  });
});
