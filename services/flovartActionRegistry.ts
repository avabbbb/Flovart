export type FlovartActionSource = 'claude-code' | 'skill' | 'extension' | 'external-client';
export type FlovartActionDomain = 'workflow' | 'assets';

export interface FlovartActionTarget {
  domain: FlovartActionDomain;
  id?: string;
}

export interface FlovartActionRequest {
  sessionId: string;
  traceId: string;
  source: FlovartActionSource;
  action: string;
  target?: FlovartActionTarget;
  payload?: Record<string, unknown>;
}

export interface FlovartActionOutputRefs {
  nodeIds?: string[];
  assetIds?: string[];
}

export interface FlovartActionResponse {
  ok: boolean;
  sessionId: string;
  traceId: string;
  action: string;
  result?: unknown;
  outputRefs?: FlovartActionOutputRefs;
  error?: {
    code: string;
    message: string;
  };
}

export interface FlovartActionDefinition {
  action: string;
  targetDomain: FlovartActionDomain;
  description: string;
}

const BUILTIN_ACTIONS: FlovartActionDefinition[] = [
  {
    action: 'workflow.describe',
    targetDomain: 'workflow',
    description: 'Describe the current Workflow graph for an agent or skill.',
  },
  {
    action: 'workflow.createNode',
    targetDomain: 'workflow',
    description: 'Create a new Workflow node from structured payload data.',
  },
  {
    action: 'workflow.updateNode',
    targetDomain: 'workflow',
    description: 'Patch an existing Workflow node.',
  },
  {
    action: 'workflow.removeNode',
    targetDomain: 'workflow',
    description: 'Remove an existing Workflow node.',
  },
  {
    action: 'workflow.selectNodes',
    targetDomain: 'workflow',
    description: 'Update the current Workflow node selection.',
  },
  {
    action: 'workflow.runNode',
    targetDomain: 'workflow',
    description: 'Run one Workflow node after the required approval gate.',
  },
  {
    action: 'generate.image',
    targetDomain: 'workflow',
    description: 'Generate an image using the current workspace model context.',
  },
  {
    action: 'generate.video',
    targetDomain: 'workflow',
    description: 'Generate a video using the current Workflow model context.',
  },
  {
    action: 'assets.list',
    targetDomain: 'assets',
    description: 'List saved assets grouped by category.',
  },
  {
    action: 'assets.saveOutput',
    targetDomain: 'assets',
    description: 'Persist a generated output into the asset library.',
  },
];

const BUILTIN_ACTION_MAP = new Map(BUILTIN_ACTIONS.map((definition) => [definition.action, definition]));

function createActionId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listFlovartActions(): FlovartActionDefinition[] {
  return BUILTIN_ACTIONS;
}

export function findFlovartAction(action: string): FlovartActionDefinition | null {
  return BUILTIN_ACTION_MAP.get(action) ?? null;
}

export function createFlovartActionRequest(input: {
  source: FlovartActionSource;
  action: string;
  sessionId?: string;
  traceId?: string;
  target?: FlovartActionTarget;
  payload?: Record<string, unknown>;
}): FlovartActionRequest {
  const definition = findFlovartAction(input.action);
  return {
    sessionId: input.sessionId || createActionId('session'),
    traceId: input.traceId || createActionId('trace'),
    source: input.source,
    action: input.action,
    target: input.target || (definition ? { domain: definition.targetDomain } : undefined),
    payload: input.payload,
  };
}

export function createFlovartActionSuccess(
  request: FlovartActionRequest,
  result?: unknown,
  outputRefs?: FlovartActionOutputRefs,
): FlovartActionResponse {
  return {
    ok: true,
    sessionId: request.sessionId,
    traceId: request.traceId,
    action: request.action,
    result,
    outputRefs,
  };
}

export function createFlovartActionError(
  request: FlovartActionRequest,
  code: string,
  message: string,
): FlovartActionResponse {
  return {
    ok: false,
    sessionId: request.sessionId,
    traceId: request.traceId,
    action: request.action,
    error: { code, message },
  };
}
