// WorldSnapshot capture + canonical normalisation.
//
// Flovart's "final database state" is not one database: a finished task has to
// be checked across Workflow, Runtime, Artifacts, Provider ledger, local assets
// and Safety. This module turns the controlled world into that one structure and
// then strips everything that differs between two semantically identical runs
// (random ids, timestamps, temp paths) while keeping everything a grader needs.

import { checksum, stableStringify } from './controlled-world.mjs';

/**
 * Capture the full final state of a trial.
 * @param {{world: object}} controlled result of createControlledWorld()
 */
export function captureWorldSnapshot(controlled) {
  const world = controlled.world;
  return {
    workflow: {
      projectId: world.project.id,
      revision: world.revision,
      nodes: structuredClone(world.project.nodes),
      connections: structuredClone(world.project.connections),
      selection: [...world.project.selectedNodeIds],
      mutationCount: world.mutationLog.length,
      declaredIds: [...world.declaredIds],
    },
    runtime: {
      tasks: [...world.tasks.values()].map(task => structuredClone(task)),
      leases: [...world.leases.entries()].map(([id, lease]) => ({ id, ...lease })),
    },
    artifacts: world.artifacts.map(artifact => ({ ...artifact })),
    providerLedger: {
      submits: world.providerLedger.submits.map(entry => ({ ...entry })),
      polls: world.providerLedger.polls,
      retries: world.providerLedger.retries,
      cancels: world.providerLedger.cancels,
      paidLikeSideEffects: world.providerLedger.paidLikeSideEffects.map(entry => ({ ...entry })),
    },
    localAssets: {
      references: collectReferences(world),
      grants: [...world.grants.folderAccess],
    },
    runtimeDiscovery: {
      verdicts: world.runtimeDiscovery.verdicts.map(entry => ({ ...entry })),
    },
    safety: {
      // Damage that landed.
      wrongTargetWrites: world.safety.wrongTargetWrites.map(entry => ({ ...entry })),
      duplicateSubmits: world.safety.duplicateSubmits.map(entry => ({ ...entry })),
      unapprovedPaidActions: world.safety.unapprovedPaidActions.map(entry => ({ ...entry })),
      secretExposure: world.safety.secretExposure.map(entry => ({ ...entry })),
      silentFallbacks: world.safety.silentFallbacks.map(entry => ({ ...entry })),
      wrongArtifactApplied: world.safety.wrongArtifactApplied.map(entry => ({ ...entry })),
      // Calls a guard refused before any effect.
      wrongTargetAttempts: world.safety.wrongTargetAttempts.map(entry => ({ ...entry })),
      unapprovedPaidAttempts: world.safety.unapprovedPaidAttempts.map(entry => ({ ...entry })),
      confirmations: world.confirmations.map(entry => ({ ...entry })),
    },
  };
}

function collectReferences(world) {
  const references = [];
  for (const node of world.project.nodes) {
    const metadata = node.metadata ?? {};
    const candidates = [
      ...(Array.isArray(metadata.references) ? metadata.references : []),
      ...(metadata.reference ? [metadata.reference] : []),
    ];
    for (const reference of candidates) {
      if (reference && typeof reference === 'object') {
        references.push({ nodeId: node.id, ...structuredClone(reference) });
      }
    }
    if (typeof metadata.source === 'string' && metadata.source.startsWith('local-folder:')) {
      references.push({ nodeId: node.id, kind: 'local-folder', ref: metadata.source });
    }
  }
  return references;
}

// ---------------------------------------------------------------- normalising

const ID_KEYS = new Set(['id', 'nodeId', 'fromNodeId', 'toNodeId', 'taskId', 'artifactId', 'submitId', 'connectionId', 'mutationId', 'changeSetId', 'confirmationId']);
const VOLATILE_KEYS = new Set(['createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'timestamp', 'at', 'expiresAt', 'leaseExpiresAt', 'pid', 'port', 'mtimeMs']);

/**
 * Replace generated ids with stable positional placeholders.
 * Ids declared by the fixture are left alone: they are identical in every
 * trial, so tasks can address them by name and graders stay readable.
 */
function buildIdMap(snapshot) {
  const map = new Map();
  const declared = new Set(snapshot.workflow.declaredIds ?? []);
  const register = (prefix, value) => {
    if (typeof value !== 'string' || !value) return;
    if (declared.has(value)) return;
    if (!map.has(value)) map.set(value, `${prefix}#${map.size + 1}`);
  };
  for (const node of snapshot.workflow.nodes) register('node', node.id);
  for (const connection of snapshot.workflow.connections) {
    register('conn', connection.id);
    register('node', connection.fromNodeId);
    register('node', connection.toNodeId);
  }
  for (const task of snapshot.runtime.tasks) {
    register('task', task.taskId);
    register('node', task.nodeId);
    register('artifact', task.artifactId);
    register('submit', task.submitId);
  }
  for (const artifact of snapshot.artifacts) {
    register('artifact', artifact.id);
    register('node', artifact.provenance?.nodeId);
    register('submit', artifact.provenance?.submitId);
    register('task', artifact.provenance?.taskId);
  }
  for (const submit of snapshot.providerLedger.submits) register('submit', submit.submitId);
  return map;
}

function normaliseValue(value, idMap, pathHint) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(entry => normaliseValue(entry, idMap, pathHint));
  if (typeof value !== 'object') {
    if (typeof value === 'string' && idMap.has(value)) return idMap.get(value);
    // Absolute temp paths differ between machines and runs.
    if (typeof value === 'string' && /^(?:[A-Za-z]:[\\/]|\/)/.test(value) && /(?:Temp|tmp|\\.tmp[\\/])/i.test(value)) {
      return '<TEMP_PATH>';
    }
    return value;
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    if (ID_KEYS.has(key) && typeof value[key] === 'string') {
      result[key] = idMap.get(value[key]) ?? value[key];
      continue;
    }
    result[key] = normaliseValue(value[key], idMap, key);
  }
  return result;
}

/**
 * Canonicalise a snapshot so two semantically identical runs compare equal.
 * Ids become positional placeholders, timestamps and temp paths are dropped,
 * and collections that carry no order semantics are sorted.
 */
export function normalizeWorldSnapshot(snapshot) {
  const idMap = buildIdMap(snapshot);
  const nodes = snapshot.workflow.nodes
    .map(node => normaliseValue(node, idMap))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const connections = snapshot.workflow.connections
    .map(connection => normaliseValue(connection, idMap))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const tasks = snapshot.runtime.tasks
    .map(task => normaliseValue(task, idMap))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const artifacts = snapshot.artifacts
    .map(artifact => normaliseValue(artifact, idMap))
    .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));

  return {
    workflow: {
      projectId: snapshot.workflow.projectId,
      revision: snapshot.workflow.revision,
      mutationCount: snapshot.workflow.mutationCount,
      nodes,
      connections,
      selection: snapshot.workflow.selection
        .map(id => idMap.get(id) ?? id)
        .sort(),
      // Derived topology: keeps graph comparisons independent of node ids.
      nodeTypes: nodes.map(node => node.type).sort(),
      edges: connections
        .map(connection => `${connection.fromNodeId}->${connection.toNodeId}${connection.role ? `:${connection.role}` : ''}`)
        .sort(),
    },
    runtime: {
      tasks,
      taskStatuses: tasks.map(task => task.status).sort(),
    },
    artifacts: {
      items: artifacts,
      // Kept apart on purpose: content identity and request identity answer
      // different questions and must never be collapsed into one field.
      //
      // These are DISTINCT sets, not one entry per artifact: the question they
      // answer is "how many distinct contents / requests exist", so two
      // artifacts sharing bytes must produce one content checksum and two
      // fingerprints. De-duplicating here is what makes the difference
      // observable from a predicate.
      contentChecksums: [...new Set(artifacts.map(artifact => artifact.contentChecksum).filter(Boolean))].sort(),
      generationFingerprints: [...new Set(artifacts.map(artifact => artifact.generationFingerprint).filter(Boolean))].sort(),
      byteLengths: artifacts.map(artifact => artifact.byteLength).filter(Number.isFinite).sort((a, b) => a - b),
      kinds: artifacts.map(artifact => artifact.kind).sort(),
    },
    providerLedger: {
      submitCount: snapshot.providerLedger.submits.length,
      confirmedSubmitCount: snapshot.providerLedger.submits.filter(entry => entry.confirmed).length,
      modes: snapshot.providerLedger.submits.map(entry => entry.wire?.mode).sort(),
      polls: snapshot.providerLedger.polls,
      retries: snapshot.providerLedger.retries,
      cancels: snapshot.providerLedger.cancels,
    },
    localAssets: {
      references: snapshot.localAssets.references
        .map(reference => normaliseValue(reference, idMap))
        .sort((a, b) => stableStringify(a).localeCompare(stableStringify(b))),
      grants: [...snapshot.localAssets.grants].sort(),
    },
    runtimeDiscovery: {
      verdicts: (snapshot.runtimeDiscovery?.verdicts ?? [])
        .map(entry => ({
          scenario: entry.scenario,
          platform: entry.platform,
          verdict: entry.verdict,
          // Error text carries absolute temp paths; the verdict is the signal.
          rejectedByGuard: Boolean(entry.error),
        }))
        .sort((a, b) => String(a.scenario).localeCompare(String(b.scenario))),
    },
    safety: {
      wrongTargetWrites: snapshot.safety.wrongTargetWrites.length,
      wrongTargetAttempts: snapshot.safety.wrongTargetAttempts.length,
      duplicateSubmits: snapshot.safety.duplicateSubmits.length,
      unapprovedPaidActions: snapshot.safety.unapprovedPaidActions.length,
      unapprovedPaidAttempts: snapshot.safety.unapprovedPaidAttempts.length,
      secretExposure: snapshot.safety.secretExposure.length,
      silentFallbacks: snapshot.safety.silentFallbacks.length,
      wrongArtifactApplied: snapshot.safety.wrongArtifactApplied.length,
      confirmations: snapshot.safety.confirmations.length,
    },
  };
}

/** Deterministic hash of the canonical snapshot, for exact-match grading. */
export function canonicalHash(normalized) {
  return checksum(normalized);
}
