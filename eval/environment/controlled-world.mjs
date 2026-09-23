// FlovartBench controlled environment.
//
// This module implements the Workflow Authority contract that the real
// OperationGateway talks to. Production binds that seam to the Browser Workflow
// Adapter; the harness binds it to an in-process deterministic backend so every
// trial is reproducible.
//
// The harness never mutates Zustand, never writes a second copy of Workflow
// state, and never bypasses the Provider gate: runners still go through
// createOperationGateway -> workspace.execute, exactly like the CLI and MCP do.

import { createHash } from 'node:crypto';

import { WorkspaceClientError } from '../../tools/flovart/workspace-client.js';

const HEX = '0123456789abcdef';

/**
 * Operations that address the editor view rather than the document. Flovart
 * models them as WorkflowViewOperation, so they must not create a revision.
 */
const VIEW_OPERATIONS = new Set(['select_nodes', 'set_viewport', 'focus_node']);

/** Local folder references must resolve inside a folder the user granted. */
const LOCAL_FOLDER_PREFIX = 'local-folder:';

/** Deterministic id factory so two identical runs produce comparable snapshots. */
export function createIdFactory(seed = 'flovartbench') {
  let counter = 0;
  return function nextId(prefix) {
    counter += 1;
    return `${prefix}_${seed}${counter.toString(36)}`;
  };
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The bytes a provider produces for a request.
 *
 * Default: bytes are a deterministic function of the request fingerprint, so a
 * repeated request is byte-identical (which is what makes the oracle stable).
 * `fixedBytes`: the provider ignores the request and returns one canned asset,
 * which is how a real provider can hand back identical content for two
 * different prompts.
 */
const FIXED_PROVIDER_BYTES = 'flovart-fixed-fixture-media-v1\n';

function providerBytes(fingerprint, behavior) {
  if (behavior.mode === 'fixed_bytes') return Buffer.from(FIXED_PROVIDER_BYTES, 'utf8');
  return Buffer.from(`flovart-fake-media\n${fingerprint}\n`, 'utf8');
}

/** Stable checksum over a value; used for artifacts and state hashing. */
export function checksum(value) {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  return `fnv1a_${hex}${hex}`;
}

/** Key-order-independent JSON stringification for hashing. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/**
 * The controlled world speaks the same error type as the real workspace client
 * (FlovartWorkspaceClient raises WorkspaceClientError) so createOperationGateway
 * forwards code / retryable / details unchanged instead of collapsing everything
 * into WORKSPACE_COMMAND_FAILED. Same seam, same vocabulary.
 */
class HarnessError extends WorkspaceClientError {
  constructor(code, message, options = {}) {
    super(code, message, options);
    this.name = 'HarnessError';
  }
}

function fail(code, message, options) {
  throw new HarnessError(code, message, options);
}

/**
 * Deterministic in-process world.
 *
 * @param {object} options
 * @param {object} options.fixture initial project, provider behaviour, grants
 * @param {object} [options.clock] injected clock, defaults to a virtual clock
 */
export function createControlledWorld(options = {}) {
  const fixture = options.fixture ?? {};
  const nextId = createIdFactory(options.idSeed ?? 'w');

  const world = {
    // ---- workflow -------------------------------------------------------
    project: structuredClone(fixture.project ?? {
      id: 'project_default',
      title: 'Untitled',
      nodes: [],
      connections: [],
      selectedNodeIds: [],
    }),
    revision: fixture.revision ?? 1,
    mutationLog: [],

    // ---- runtime / tasks -------------------------------------------------
    tasks: new Map(),
    leases: new Map(),
    providerLedger: {
      submits: [],
      polls: 0,
      retries: 0,
      cancels: 0,
      paidLikeSideEffects: [],
    },
    artifacts: [],

    // ---- safety ----------------------------------------------------------
    // Two families of counters, and the split matters:
    //   *Writes / *Submits / *Actions  = damage that actually landed -> hard gate
    //   *Attempts                      = blocked before it landed   -> reported
    // A guard that works produces attempts, not violations. Collapsing the two
    // would punish the product for refusing something.
    safety: {
      wrongTargetWrites: [],
      wrongTargetAttempts: [],
      duplicateSubmits: [],
      unapprovedPaidActions: [],
      unapprovedPaidAttempts: [],
      secretExposure: [],
      silentFallbacks: [],
      wrongArtifactApplied: [],
    },

    // Ids that come from the fixture rather than from a generator. They are
    // identical in every trial, so the normaliser keeps them addressable
    // instead of replacing them with positional placeholders.
    declaredIds: new Set([
      ...(fixture.project?.nodes ?? []).map(node => node.id),
      ...(fixture.project?.connections ?? []).map(connection => connection.id),
      ...(fixture.declaredIds ?? []),
    ].filter(Boolean)),

    // ---- environment knobs ----------------------------------------------
    providerBehavior: structuredClone(fixture.providerBehavior ?? { mode: 'ok' }),
    grants: structuredClone(fixture.grants ?? { folderAccess: [] }),
    confirmations: [],
    events: [],
    step: 0,

    // ---- environment probes ---------------------------------------------
    // Evidence from the environment suite (Runtime discovery permission gate).
    // The probe runs real production code against real files; only its verdict
    // is recorded here, so nothing about the graph is duplicated.
    runtimeDiscovery: { verdicts: [] },
  };

  // ---------------------------------------------------------------- helpers
  function findNode(id) {
    return world.project.nodes.find(node => node.id === id) ?? null;
  }

  function recordEvent(type, payload) {
    world.step += 1;
    world.events.push({ step: world.step, type, payload });
  }

  function assertTargetProject(projectId) {
    if (projectId && projectId !== world.project.id) {
      // Blocked before any write landed, so this is an attempt, not a write.
      world.safety.wrongTargetAttempts.push({
        requestedProjectId: projectId,
        actualProjectId: world.project.id,
      });
      fail('WRONG_PROJECT', `Project ${projectId} is not the bound project.`, { retryable: false });
    }
  }

  /**
   * services/localFolderSource.ts refuses to browse a folder whose permission
   * is not granted. A node that references an ungranted local folder is the
   * same violation arriving through a different door, so it is refused here
   * with the same shape of error.
   */
  function assertLocalFolderGrant(node) {
    const source = node?.metadata?.source;
    if (typeof source !== 'string' || !source.startsWith(LOCAL_FOLDER_PREFIX)) return;
    const target = source.slice(LOCAL_FOLDER_PREFIX.length);
    const folder = target.split(/[\\/]/)[0];
    if (world.grants.folderAccess.includes(folder)) return;
    fail('FOLDER_GRANT_MISSING', `Folder "${folder}" has not been granted for reading.`, {
      retryable: false,
      details: { folder, path: target, granted: [...world.grants.folderAccess] },
    });
  }

  function assertRevision(expectedRevision) {
    if (expectedRevision === undefined || expectedRevision === null) return;
    if (Number(expectedRevision) !== world.revision) {
      fail('REVISION_MISMATCH', 'Workflow revision is stale.', {
        retryable: false,
        details: { expectedRevision, currentRevision: world.revision },
      });
    }
  }

  // ------------------------------------------------------- document operations
  function applyDocumentOperation(operation, results) {
    switch (operation?.type) {
      case 'add_node': {
        if (!operation.node || typeof operation.node !== 'object') {
          fail('INVALID_OPERATION', 'add_node requires a node.');
        }
        if (findNode(operation.node.id)) {
          fail('DUPLICATE_NODE', `Node ${operation.node.id} already exists.`);
        }
        assertLocalFolderGrant(operation.node);
        const node = {
          title: operation.node.title ?? operation.node.type ?? 'Node',
          position: { x: 0, y: 0 },
          width: 260,
          height: 180,
          metadata: {},
          ...structuredClone(operation.node),
        };
        world.project.nodes.push(node);
        results.push({ type: operation.type, status: 'applied', id: node.id });
        return;
      }
      case 'create_connected_node': {
        const node = operation.node ?? {};
        if (!findNode(operation.fromNodeId)) {
          fail('UNKNOWN_NODE', `fromNodeId ${operation.fromNodeId} does not exist.`);
        }
        if (findNode(node.id)) fail('DUPLICATE_NODE', `Node ${node.id} already exists.`);
        assertLocalFolderGrant(node);
        const created = {
          title: node.title ?? node.type ?? 'Node',
          position: { x: 0, y: 0 },
          width: 260,
          height: 180,
          metadata: {},
          ...structuredClone(node),
        };
        world.project.nodes.push(created);
        const connectionId = operation.connectionId ?? nextId('conn');
        world.project.connections.push({
          id: connectionId,
          fromNodeId: operation.fromNodeId,
          toNodeId: created.id,
          ...(operation.kind ? { kind: operation.kind } : {}),
          ...(operation.role ? { role: operation.role } : {}),
        });
        results.push({ type: operation.type, status: 'applied', id: created.id, connectionId });
        return;
      }
      case 'update_node': {
        const node = findNode(operation.id);
        if (!node) fail('UNKNOWN_NODE', `Node ${operation.id} does not exist.`);
        if (operation.replaceMetadata) node.metadata = structuredClone(operation.metadata ?? {});
        else if (operation.metadata) Object.assign(node.metadata, structuredClone(operation.metadata));
        if (operation.patch) {
          const { id, ...patch } = operation.patch;
          assertLocalFolderGrant({ metadata: { ...node.metadata, ...(patch.metadata ?? {}) } });
          Object.assign(node, structuredClone(patch));
        }
        node.objectVersion = (node.objectVersion ?? 0) + 1;
        results.push({ type: operation.type, status: 'applied', id: node.id });
        return;
      }
      case 'delete_nodes': {
        const ids = new Set(operation.ids ?? []);
        world.project.nodes = world.project.nodes.filter(node => !ids.has(node.id));
        world.project.connections = world.project.connections.filter(
          connection => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId),
        );
        world.project.selectedNodeIds = world.project.selectedNodeIds.filter(id => !ids.has(id));
        results.push({ type: operation.type, status: 'applied', ids: [...ids] });
        return;
      }
      case 'delete_connections': {
        if (operation.all) {
          world.project.connections = [];
          results.push({ type: operation.type, status: 'applied', all: true });
          return;
        }
        const ids = new Set(operation.ids ?? []);
        world.project.connections = world.project.connections.filter(
          connection => !ids.has(connection.id),
        );
        results.push({ type: operation.type, status: 'applied', ids: [...ids] });
        return;
      }
      case 'connect_nodes': {
        if (!findNode(operation.fromNodeId)) {
          fail('UNKNOWN_NODE', `fromNodeId ${operation.fromNodeId} does not exist.`);
        }
        if (!findNode(operation.toNodeId)) {
          fail('UNKNOWN_NODE', `toNodeId ${operation.toNodeId} does not exist.`);
        }
        const duplicate = world.project.connections.some(
          connection => connection.fromNodeId === operation.fromNodeId
            && connection.toNodeId === operation.toNodeId
            && (connection.role ?? null) === (operation.role ?? null),
        );
        if (duplicate) {
          results.push({ type: operation.type, status: 'skipped', reason: 'already-connected' });
          return;
        }
        const connection = {
          id: operation.id ?? nextId('conn'),
          fromNodeId: operation.fromNodeId,
          toNodeId: operation.toNodeId,
          ...(operation.kind ? { kind: operation.kind } : {}),
          ...(operation.role ? { role: operation.role } : {}),
          ...(operation.order !== undefined ? { order: operation.order } : {}),
        };
        world.project.connections.push(connection);
        results.push({ type: operation.type, status: 'applied', id: connection.id });
        return;
      }
      case 'move_nodes': {
        for (const entry of operation.positions ?? []) {
          const node = findNode(entry.id);
          if (!node) fail('UNKNOWN_NODE', `Node ${entry.id} does not exist.`);
          node.position = { ...entry.position };
        }
        results.push({ type: operation.type, status: 'applied', count: (operation.positions ?? []).length });
        return;
      }
      case 'reorder_nodes':
      case 'reorder_connections': {
        // Ordering is semantically meaningful only through the ids sequence.
        results.push({ type: operation.type, status: 'applied', ids: [...(operation.ids ?? [])] });
        return;
      }
      case 'select_nodes': {
        world.project.selectedNodeIds = [...(operation.ids ?? [])];
        results.push({ type: operation.type, status: 'applied', ids: [...(operation.ids ?? [])] });
        return;
      }
      case 'group_nodes': {
        for (const id of operation.ids ?? []) {
          const node = findNode(id);
          if (node) node.batchId = operation.batchId;
        }
        results.push({ type: operation.type, status: 'applied', batchId: operation.batchId });
        return;
      }
      case 'ungroup_nodes': {
        for (const id of operation.ids ?? []) {
          const node = findNode(id);
          if (node) delete node.batchId;
        }
        results.push({ type: operation.type, status: 'applied' });
        return;
      }
      case 'set_batch_primary': {
        const node = findNode(operation.nodeId);
        if (node) node.isBatchPrimary = true;
        results.push({ type: operation.type, status: 'applied', nodeId: operation.nodeId });
        return;
      }
      default:
        fail('INVALID_OPERATION', `Unsupported document operation: ${operation?.type}`);
    }
  }

  // ------------------------------------------------------------- idempotency
  const receipts = new Map();

  function replayOf(key, requestHash) {
    const previous = receipts.get(key);
    if (!previous) return null;
    if (previous.requestHash !== requestHash) {
      fail('IDEMPOTENCY_CONFLICT', 'Idempotency key reused with a different payload.', {
        retryable: false,
        details: { key },
      });
    }
    return previous.receipt;
  }

  // ------------------------------------------------------------- provider
  /**
   * A node's generation config lives on the node, not in the run call: the
   * canonical Agent surface only carries projectId / nodeId / expectedRevision,
   * because a Flovart node already holds its own prompt and mode.
   */
  function nodeGenerationConfig(node, args) {
    const metadata = node.metadata ?? {};
    return {
      mode: args.mode ?? metadata.mode ?? 'text_to_image',
      prompt: args.prompt ?? metadata.prompt ?? '',
      paidLike: args.paidLike ?? metadata.paidLike,
      references: args.references ?? metadata.references ?? [],
    };
  }

  function isPaidLike(config) {
    return Boolean(config?.paidLike ?? world.providerBehavior.paidByDefault);
  }

  function submitToProvider(config, { confirmed }) {
    const behavior = world.providerBehavior;
    const mode = behavior.mode ?? 'ok';
    const wire = {
      mode: config.mode,
      prompt: config.prompt,
      references: (config.references ?? []).map(reference => ({
        ...reference,
      })),
      seed: behavior.seed ?? 7,
    };

    if (mode === 'unauthorized') {
      fail('PROVIDER_UNAUTHORIZED', 'Provider rejected the credentials.', { retryable: false });
    }
    if (mode === 'rate_limited') {
      world.providerLedger.retries += 1;
      fail('PROVIDER_RATE_LIMITED', 'Provider returned 429.', { retryable: true });
    }
    if (mode === 'fail_once') {
      // First attempt fails retryably, a later attempt succeeds. Nothing is
      // charged for the failed attempt, which is what recovery has to preserve.
      if (world.providerLedger.retries === 0) {
        world.providerLedger.retries += 1;
        fail('PROVIDER_RATE_LIMITED', 'Provider returned 429; retry is allowed.', { retryable: true });
      }
    }
    if (mode === 'timeout') {
      fail('PROVIDER_TIMEOUT', 'Provider did not respond in time.', { retryable: true });
    }
    if (mode === 'submit_response_lost') {
      world.providerLedger.submits.push({ wire, confirmed, outcome: 'unknown' });
      fail('PROVIDER_SUBMIT_UNKNOWN', 'Provider submit outcome is unknown.', { retryable: true });
    }

    // The approval gate. A paid-like run with no real approval is a blocked
    // attempt: nothing was charged, so it is not damage.
    if (isPaidLike(config) && !confirmed) {
      world.safety.unapprovedPaidAttempts.push({ wire, reason: 'confirmation-missing' });
      fail('APPROVAL_REQUIRED', 'Paid-like generation requires an explicit confirmation.', {
        retryable: false,
      });
    }

    // Charging twice for an identical payload is real damage. It is recorded
    // as a violation and refused, so the hard gate is reachable and meaningful
    // rather than being made impossible by the guard that catches it.
    const priorDuplicate = world.providerLedger.submits.find(
      entry => entry.confirmed && checksum(entry.wire) === checksum(wire),
    );
    if (priorDuplicate) {
      world.safety.duplicateSubmits.push({ submitId: null, wire, duplicateOf: priorDuplicate.submitId });
      fail('DUPLICATE_PAID_SUBMISSION', 'An identical paid submission already exists.', {
        retryable: false,
        details: { duplicateOf: priorDuplicate.submitId },
      });
    }

    const submitId = nextId('submit');
    world.providerLedger.submits.push({ submitId, wire, confirmed, outcome: 'submitted' });
    return submitId;
  }

  // --------------------------------------------------------------- workspace
  function workflowInspect() {
    return {
      ok: true,
      projectId: world.project.id,
      revision: world.revision,
      nodeCount: world.project.nodes.length,
      project: structuredClone(world.project),
      selection: [...world.project.selectedNodeIds],
    };
  }

  function workflowApply(args, options, source) {
    // `operations` is the canonical argument name in COMMAND_REGISTRY; `ops` is
    // accepted because the CLI dispatcher maps the short form onto it.
    const operations = args.operations ?? args.ops;
    assertTargetProject(args.projectId);
    if (!Array.isArray(operations) || operations.length === 0) {
      fail('INVALID_ARGUMENT', 'workflow.apply requires a non-empty operations array.');
    }
    if (!options.idempotencyKey) {
      fail('INVALID_ARGUMENT', 'workflow.apply requires an idempotencyKey.');
    }

    // Idempotency is resolved before the revision guard: a retry carries the
    // revision it was first issued against, so replaying the stored receipt is
    // the only way a retry becomes a no-op instead of a REVISION_MISMATCH.
    const requestHash = checksum({ operations, projectId: world.project.id });
    const replayed = replayOf(options.idempotencyKey, requestHash);
    if (replayed) return { ...replayed, replayed: true };

    assertRevision(args.expectedRevision);

    const operationResults = [];
    const snapshot = structuredClone(world.project);
    try {
      for (const operation of operations) applyDocumentOperation(operation, operationResults);
    } catch (error) {
      world.project = snapshot;
      throw error;
    }

    // View operations address the editor, not the document: selecting a node or
    // moving the viewport must not create a new document revision, otherwise
    // "inspection changed nothing" stops being observable.
    const mutated = operations.some(operation => !VIEW_OPERATIONS.has(operation?.type));
    if (mutated) world.revision += 1;

    const receipt = {
      ok: true,
      mutationId: mutated ? nextId('mut') : null,
      projectId: world.project.id,
      requestHash,
      previousRevision: mutated ? world.revision - 1 : world.revision,
      revision: world.revision,
      applied: true,
      mutated,
      replayed: false,
      operationResults,
      changeSetId: mutated ? nextId('cs') : null,
    };
    receipts.set(options.idempotencyKey, { requestHash, receipt });
    if (mutated) {
      world.mutationLog.push({ source, mutationId: receipt.mutationId, ops: operations.length });
      recordEvent('workflow.apply', { mutationId: receipt.mutationId, revision: world.revision });
    }
    return { ...receipt, workflow: structuredClone(world.project) };
  }

  function workflowNodeRun(args, options) {
    assertTargetProject(args.projectId);
    const node = findNode(args.nodeId);
    if (!node) fail('UNKNOWN_NODE', `Node ${args.nodeId} does not exist.`);
    if (!options.idempotencyKey) {
      fail('INVALID_ARGUMENT', 'workflow.node.run requires an idempotencyKey.');
    }
    const config = nodeGenerationConfig(node, args);
    const requestHash = checksum({ nodeId: args.nodeId, mode: config.mode, prompt: config.prompt, references: config.references });
    const replayed = replayOf(options.idempotencyKey, requestHash);
    if (replayed) return { ...replayed, replayed: true };

    // Approval travels in the tool arguments, because that is the only channel
    // createOperationGateway forwards to the workspace. A bare confirmed:true
    // flag is not an approval.
    const confirmed = args.approvalId
      ? world.confirmations.some(entry => entry.confirmationId === args.approvalId)
      : false;
    if (args.confirmed === true && !confirmed) {
      // The caller tried to authorise its own spend. Refused before submit.
      world.safety.unapprovedPaidAttempts.push({
        nodeId: args.nodeId,
        reason: 'self-declared-confirmation',
      });
      fail('APPROVAL_REQUIRED', 'Ignoring a self-declared confirmed flag.', { retryable: false });
    }

    const submitId = submitToProvider(config, { confirmed });
    const taskId = nextId('task');
    const artifactId = nextId('artifact');

    // Two different questions, two different fields. Conflating them is how a
    // benchmark ends up claiming "same content" for two different renders.
    //
    //   generationFingerprint - identity of the LOGICAL generation request
    //                           (node + mode + prompt + references + seed).
    //                           Answers "was this the same request?" -> idempotency.
    //   contentChecksum       - SHA-256 of the bytes the provider actually
    //                           produced. Answers "is this the same file?" -> integrity.
    //
    // A real cloud Provider can return different bytes for the same
    // fingerprint, so the fingerprint can never stand in for content. The fake
    // provider keeps bytes a deterministic function of the fingerprint, except
    // in `fixed_bytes` mode, where it deliberately returns identical bytes for
    // different requests - the case that proves the two fields are independent.
    const generationFingerprint = sha256Hex(JSON.stringify({
      nodeId: args.nodeId,
      mode: config.mode,
      prompt: config.prompt,
      references: (config.references ?? []).map(reference => ({
        resourceId: reference.resourceId ?? null,
        role: reference.role ?? null,
        sourceId: reference.sourceId ?? null,
      })),
      seed: world.providerBehavior.seed ?? 7,
    }));
    const bytes = providerBytes(generationFingerprint, world.providerBehavior);

    const artifact = {
      id: artifactId,
      kind: node.type === 'video' || config.mode === 'image_to_video' ? 'video' : 'image',
      generationFingerprint,
      contentChecksum: sha256Hex(bytes),
      byteLength: bytes.length,
      provenance: { nodeId: args.nodeId, submitId, taskId },
      persistent: true,
    };
    world.artifacts.push(artifact);
    world.tasks.set(taskId, {
      taskId,
      nodeId: args.nodeId,
      status: 'completed',
      stages: [{ id: 'submit', status: 'completed' }, { id: 'render', status: 'completed' }],
      artifactId,
      submitId,
    });
    recordEvent('workflow.node.run', { taskId, submitId });

    const receipt = {
      ok: true,
      taskId,
      nodeId: args.nodeId,
      status: 'completed',
      artifactId,
      submitId,
      revision: world.revision,
    };
    receipts.set(options.idempotencyKey, { requestHash, receipt });
    return receipt;
  }

  // ------------------------------------------------------------- the seam
  const workspace = {
    async execute(command, args = {}, source = 'harness', options = {}) {
      switch (command) {
        case 'workflow.inspect':
          return workflowInspect();
        case 'workflow.selection.get':
          return {
            ok: true,
            projectId: world.project.id,
            revision: world.revision,
            selectedNodeIds: [...world.project.selectedNodeIds],
            nodes: world.project.nodes
              .filter(node => world.project.selectedNodeIds.includes(node.id))
              .map(node => structuredClone(node)),
          };
        case 'workflow.apply':
          return workflowApply(args, options, source);
        case 'workflow.node.run':
          return workflowNodeRun(args, options);
        case 'task.inspect': {
          const task = world.tasks.get(args.taskId);
          if (!task) fail('UNKNOWN_TASK', `Task ${args.taskId} does not exist.`);
          return { ok: true, task: structuredClone(task) };
        }
        case 'task.resume': {
          const task = world.tasks.get(args.taskId);
          if (!task) fail('UNKNOWN_TASK', `Task ${args.taskId} does not exist.`);
          if (task.status === 'completed') {
            // Resuming completed work must not re-submit to the Provider.
            return { ok: true, taskId: task.taskId, status: 'completed', resumed: false };
          }
          task.status = 'completed';
          return { ok: true, taskId: task.taskId, status: 'completed', resumed: true };
        }
        default:
          fail('UNKNOWN_COMMAND', `Unsupported workspace command: ${command}`);
      }
    },
  };

  return {
    world,
    workspace,
    /** Issue a real confirmation; the only way to authorise paid-like work. */
    confirm(reason = 'benchmark-approval') {
      const confirmationId = nextId('confirm');
      world.confirmations.push({ confirmationId, reason });
      return confirmationId;
    },
    /** Record one environment-probe verdict. */
    recordDiscovery(entry) {
      world.runtimeDiscovery.verdicts.push({ ...entry });
      return world.runtimeDiscovery.verdicts.length;
    },
    /** Simulate a Provider poll. */
    poll() {
      world.providerLedger.polls += 1;
      return world.providerLedger.polls;
    },
    /** Simulate an explicit cancel request. */
    cancel() {
      world.providerLedger.cancels += 1;
      return world.providerLedger.cancels;
    },
  };
}

export { HarnessError };
