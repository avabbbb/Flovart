import type { ManagedAgentConnection } from './managedAgentConnection';
import type { WorkflowNode } from '../components/workflow/types';

/**
 * Agent 视频流水线在 Canvas 侧的只读视图（docs/design/16-agent-video-pipeline.md §9）。
 * 数据来自本机 agent 的 GET /pipeline/*；写操作仍只走 pipeline 命令边界。
 */

export type PipelineRunStatus = 'active' | 'blocked' | 'passed' | 'archived' | 'stopped';
export type PipelineVerdict = 'pass' | 'revise' | 'reject' | string;

export interface PipelineRunSummary {
  runId: string;
  projectId: string;
  title: string;
  status: PipelineRunStatus;
  headVersion: number;
  blocker: { code?: string; message?: string; stepId?: string } | null;
  stepCount: number;
  failedSteps: number;
  lastVerdict: { round: number; version: number; verdict: PipelineVerdict; reviewer: string } | null;
  createdAt: number;
  updatedAt: number;
}

export interface PipelineTraceStep {
  seq: number;
  stepId: string;
  tool: string;
  caller: string;
  status: string;
  mutationId: string | null;
  attempts: number;
  artifactIds: string[];
  costMicros: number;
  error?: { code?: string; message?: string };
  startedAt: number;
  finishedAt: number | null;
}

export interface PipelineTraceRender {
  renderId: string;
  preset: 'still' | 'draft' | 'final' | string;
  atSec: number | null;
  engine: string;
  artifactId: string;
  rejected: boolean;
  issues: unknown[];
}

export interface PipelineTraceVersion {
  version: number;
  parentVersion: number | null;
  durationMs: number | null;
  locked: string[];
  renders: PipelineTraceRender[];
  reviews: number[];
}

export interface PipelineTraceRound {
  id: string;
  round: number;
  version: number;
  reviewer: string;
  verdict: PipelineVerdict;
  findings: unknown[];
}

export interface PipelineTrace {
  run: { id: string; projectId: string; title: string; status: PipelineRunStatus; headVersion: number };
  steps: PipelineTraceStep[];
  versions: PipelineTraceVersion[];
  rounds: PipelineTraceRound[];
  spend: { confirmedTasks: number; pendingTasks: number; maxTasks: number | null; maxRounds: number | null };
  blocker: PipelineRunSummary['blocker'];
  resumeFrom: { seq: number; tool: string; status: string } | null;
}

type Connection = Pick<ManagedAgentConnection, 'url' | 'token'>;

async function agentGet(connection: Connection, path: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(new URL(path, connection.url).toString(), {
    headers: { 'x-flovart-agent-token': connection.token },
  });
  if (!response.ok) {
    let message = 'Pipeline unavailable: ' + response.status;
    try {
      const body = await response.json() as { error?: { message?: string } | string };
      const detail = typeof body.error === 'string' ? body.error : body.error?.message;
      if (detail) message = detail;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }
  return response;
}

export async function fetchPipelineRuns(connection: Connection, { limit = 20 }: { limit?: number } = {}, fetchImpl: typeof fetch = fetch) {
  const response = await agentGet(connection, `/pipeline/runs?limit=${limit}`, fetchImpl);
  const body = await response.json() as { runs?: PipelineRunSummary[] };
  return body.runs || [];
}

export async function fetchPipelineTrace(connection: Connection, runId: string, fetchImpl: typeof fetch = fetch) {
  const response = await agentGet(connection, `/pipeline/runs/${encodeURIComponent(runId)}`, fetchImpl);
  const body = await response.json() as { trace: PipelineTrace };
  return body.trace;
}

export async function fetchPipelineArtifact(connection: Connection, artifactId: string, fetchImpl: typeof fetch = fetch) {
  const response = await agentGet(connection, `/pipeline/artifacts/${encodeURIComponent(artifactId)}`, fetchImpl);
  return response.blob();
}

const PRESET_RANK: Record<string, number> = { final: 3, draft: 2, still: 1 };

export interface PipelineVersionRender {
  version: number;
  artifactId: string;
  preset: string;
  verdict: PipelineVerdict | null;
}

/** 每个版本选一份最好的视频渲染（final > draft，跳过 rejected 与单帧 still），按版本升序。 */
export function pickVersionRenders(trace: Pick<PipelineTrace, 'versions' | 'rounds'>): PipelineVersionRender[] {
  return [...trace.versions]
    .sort((left, right) => left.version - right.version)
    .flatMap(version => {
      const best = version.renders
        .filter(render => !render.rejected && render.preset !== 'still')
        .sort((left, right) => (PRESET_RANK[right.preset] || 0) - (PRESET_RANK[left.preset] || 0))[0];
      if (!best) return [];
      const lastRound = trace.rounds.filter(round => round.version === version.version).sort((a, b) => b.round - a.round)[0];
      return [{ version: version.version, artifactId: best.artifactId, preset: best.preset, verdict: lastRound?.verdict ?? null }];
    });
}

export const pipelineBatchId = (runId: string) => `pipeline-${runId}`;

/**
 * 画布版本分组：同一 run 的各版本渲染放进一个自动批次（batchId = pipeline-<runId>，batchIndex = 版本号 - 1），
 * 叠放主图指向最新版本。已经在画布上的产物（按 artifactId）不再重复插入。
 */
export function planPipelineVersionNodes(existing: Pick<WorkflowNode, 'id' | 'batchId' | 'batchIndex' | 'metadata'>[], runId: string, renders: PipelineVersionRender[]) {
  const batchId = pipelineBatchId(runId);
  const present = new Set(existing.filter(node => node.batchId === batchId).map(node => node.metadata.pipelineRender?.artifactId).filter(Boolean));
  const missing = renders.filter(render => !present.has(render.artifactId));
  const latest = renders.length ? Math.max(...renders.map(render => render.version)) : 0;
  return { batchId, missing, latestVersion: latest };
}
