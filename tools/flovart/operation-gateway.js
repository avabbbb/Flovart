import { AGENT_OPERATION_DEFINITIONS, AGENT_PUBLIC_COMMANDS, AGENT_PUBLIC_COMMAND_SET } from './agent-surface.js';
import { getLocalStatus } from './local-status.js';
import { FlovartWorkspaceClient, WorkspaceClientError } from './workspace-client.js';

export const CANONICAL_AGENT_OPERATIONS = Object.freeze([...AGENT_PUBLIC_COMMANDS]);

export const MCP_TOOL_NAMES = Object.freeze({
  status: 'flovart_status',
  'workflow.inspect': 'flovart_workflow_inspect',
  'workflow.selection.get': 'flovart_workflow_selection',
  'workflow.apply': 'flovart_workflow_apply',
  'workflow.node.run': 'flovart_workflow_run',
});

const WRITE_OPERATIONS = new Set(CANONICAL_AGENT_OPERATIONS.filter(command => AGENT_OPERATION_DEFINITIONS[command]?.mutation));

export class OperationGatewayError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'OperationGatewayError';
    this.code = code;
    this.retryable = Boolean(options.retryable);
    this.details = options.details ?? null;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

function callerFromContext(context = {}) {
  const agentIdentity = String(context.agentIdentity || context.caller?.agentIdentity || '').trim();
  const hostSessionId = String(context.hostSessionId || context.caller?.hostSessionId || '').trim();
  if (!agentIdentity && !hostSessionId) return undefined;
  if (!agentIdentity) {
    throw new OperationGatewayError('INVALID_ARGUMENT', 'hostSessionId requires agentIdentity.', { retryable: false });
  }
  return {
    agentIdentity,
    ...(hostSessionId ? { hostSessionId } : {}),
  };
}

function assertPublicOperation(command) {
  if (!AGENT_PUBLIC_COMMAND_SET.has(command)) {
    throw new OperationGatewayError(
      'UNKNOWN_COMMAND',
      `Operation is not part of the stable Agent surface: ${String(command)}`,
      { retryable: false },
    );
  }
}

function assertWriteEnvelope(command, idempotencyKey) {
  if (WRITE_OPERATIONS.has(command) && !String(idempotencyKey || '').trim()) {
    throw new OperationGatewayError(
      'INVALID_ARGUMENT',
      `${command} requires idempotencyKey so retries cannot duplicate visible Workflow changes.`,
      { retryable: false },
    );
  }
}

/**
 * The one narrow gateway shared by the model-facing projections. It owns no
 * Workflow state: status is read locally and Workflow operations are forwarded
 * to the existing Browser Workflow Adapter.
 */
export function createOperationGateway(options = {}) {
  let workspace = options.workspace || null;
  const status = options.status || (() => getLocalStatus(options.statusOptions));

  const getWorkspace = () => {
    if (!workspace) workspace = new FlovartWorkspaceClient(options.workspaceOptions);
    return workspace;
  };

  return async function executeOperation(command, args = {}, context = {}) {
    assertPublicOperation(command);
    const idempotencyKey = context.idempotencyKey || args.idempotencyKey || args['idempotency-key'];
    assertWriteEnvelope(command, idempotencyKey);

    if (command === 'status') return status();

    const caller = callerFromContext(context);
    const operationArgs = { ...args };
    delete operationArgs.idempotencyKey;
    delete operationArgs['idempotency-key'];
    // Public Agent operations are always Browser Workflow operations. The
    // session still rejects native/headless modes as a second safety boundary.
    operationArgs.workspaceMode = 'browser';

    try {
      return await getWorkspace().execute(command, operationArgs, context.source || 'mcp', {
        ...(idempotencyKey ? { idempotencyKey } : {}),
        ...(caller ? { caller } : {}),
      });
    } catch (error) {
      if (error instanceof OperationGatewayError || error instanceof WorkspaceClientError) throw error;
      throw new OperationGatewayError(
        'WORKSPACE_COMMAND_FAILED',
        error instanceof Error ? error.message : String(error),
        { retryable: true },
      );
    }
  };
}

export function canonicalOperationNames() {
  return [...CANONICAL_AGENT_OPERATIONS];
}
