export type FlovartActionSource = 'claude-code' | 'skill' | 'extension' | 'external-client';
export type FlovartActionDomain = 'canvas' | 'storyboard' | 'assets';

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
  elementIds?: string[];
  shotIds?: string[];
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
    action: 'canvas.describe',
    targetDomain: 'canvas',
    description: 'Describe the current canvas state for an agent or skill.',
  },
  {
    action: 'canvas.addElement',
    targetDomain: 'canvas',
    description: 'Create a new canvas element from structured payload data.',
  },
  {
    action: 'canvas.updateElement',
    targetDomain: 'canvas',
    description: 'Patch an existing canvas element.',
  },
  {
    action: 'canvas.removeElement',
    targetDomain: 'canvas',
    description: 'Remove an existing canvas element.',
  },
  {
    action: 'canvas.select',
    targetDomain: 'canvas',
    description: 'Update the current canvas selection.',
  },
  {
    action: 'selection.describe',
    targetDomain: 'canvas',
    description: 'Describe the current canvas selection.',
  },
  {
    action: 'generate.image',
    targetDomain: 'canvas',
    description: 'Generate an image using the current workspace model context.',
  },
  {
    action: 'storyboard.listShots',
    targetDomain: 'storyboard',
    description: 'List storyboard shots for the active project.',
  },
  {
    action: 'storyboard.createShot',
    targetDomain: 'storyboard',
    description: 'Create a storyboard shot from an agent request.',
  },
  {
    action: 'storyboard.updateShot',
    targetDomain: 'storyboard',
    description: 'Patch a storyboard shot.',
  },
  {
    action: 'storyboard.attachOutput',
    targetDomain: 'storyboard',
    description: 'Attach a canvas element output to a storyboard shot.',
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
