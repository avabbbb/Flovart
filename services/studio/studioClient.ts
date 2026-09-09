import type { FlovartArtifact, FlovartStudioCore, MaterializedHostSelection, StudioApplyRequest, StudioRunRequest } from './studioContract';

export type StableFlovartCommandExecutor = (command: string, args: Record<string, unknown>) => Promise<unknown>;

export interface FlovartStudioLinkOptions {
  registerHostResource: (materialized: MaterializedHostSelection) => Promise<void>;
  artifactGet: (args: { taskId?: string; artifactId?: string }) => Promise<FlovartArtifact | null>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Accepts either the browser dispatcher result or the CLI {data,error} envelope. */
export function commandData<T>(value: unknown): T {
  const response = record(value);
  if (response?.ok === false) {
    const error = record(response.error);
    throw new Error(`${String(error?.code || 'COMMAND_FAILED')}: ${String(error?.message || 'Flovart 命令失败')}`);
  }
  if (response && 'result' in response) return response.result as T;
  if (response && 'data' in response) return response.data as T;
  return value as T;
}

export function createFlovartStudioCore(
  execute: StableFlovartCommandExecutor,
  link: FlovartStudioLinkOptions,
): FlovartStudioCore {
  const command = async <T>(name: string, args: Record<string, unknown> = {}) => commandData<T>(await execute(name, args));
  return {
    ensure: () => command('ensure'),
    inspect: projectId => command('workflow.inspect', projectId ? { projectId } : {}),
    selection: projectId => command('workflow.selection.get', projectId ? { projectId } : {}),
    registerHostResource: link.registerHostResource,
    apply: (request: StudioApplyRequest) => command('workflow.apply', request as unknown as Record<string, unknown>),
    run: (request: StudioRunRequest) => command('workflow.node.run', request as unknown as Record<string, unknown>),
    artifactGet: link.artifactGet,
  };
}

export function workflowResultRevision(value: unknown): number | undefined {
  const result = record(value);
  const revision = result?.draftVersion ?? result?.revision;
  return typeof revision === 'number' && Number.isFinite(revision) ? revision : undefined;
}

export function workflowResultTaskId(value: unknown): string | undefined {
  const result = record(value);
  const taskId = result?.taskId ?? result?.providerTaskId ?? result?.generationTaskId;
  return typeof taskId === 'string' && taskId ? taskId : undefined;
}

export function workflowResultArtifactId(value: unknown): string | undefined {
  const result = record(value);
  const artifact = record(result?.artifact);
  const artifactId = artifact?.artifactId ?? result?.artifactId;
  return typeof artifactId === 'string' && artifactId ? artifactId : undefined;
}
