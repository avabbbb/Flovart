// Real-provider runner.
//
// Paid provider trials cannot be replayed into the controlled world the way a
// workflow.apply write can: a real RunningHub submission is a paid side effect,
// and replaying it would charge the account a second time. Instead the trial is
// driven once against the live workspace by a serial parent driver, which
// captures the real evidence (provider ledger, artifact records, node metadata,
// durability re-reads) into a JSON capture. This runner ingests that capture
// into the controlled world so the SAME predicate engine grades it.
//
// The contract between the parent driver and this runner is the capture shape:
//
//   {
//     "project": { "id", "revision", "nodes": [...], "connections": [...] },
//     "providerLedger": {
//       "submits": [{ "submitId", "taskId", "wire": { "mode", "references": [] }, "confirmed", "outcome" }],
//       "polls": n, "retries": n, "cancels": n
//     },
//     "artifacts": [{ "artifactId", "kind", "storageKey", "persisted", "byteLength",
//                     "contentChecksum", "generationFingerprint", "remoteUrl",
//                     "provenance": { "nodeId" } }],
//     "tasks": [{ "taskId", "status", "providerTaskId" }],
//     "safety": { "wrongTargetWrites": n, "duplicateSubmits": n, ... },
//     "usage": { "promptTokens", "completionTokens", "costUsd", "measured": true }
//   }
//
// `persisted` must be set by the driver only AFTER re-reading the bytes back
// from durable storage (the media store), never inferred from the index row.
// A remoteUrl alone is provenance — RunningHub links expire in ~24h and are
// never the durable source of truth.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Normalise one captured submit into the controlled-world submit shape.
 * `taskId` is lifted to the top level because the resume predicate reads it
 * there; the wire keeps whatever the provider actually declared.
 */
function normaliseSubmit(submit, index) {
  const wire = isObject(submit?.wire) ? submit.wire : {};
  return {
    submitId: submit?.submitId ?? `submit_${index}`,
    taskId: submit?.taskId ?? wire.taskId ?? null,
    wire,
    confirmed: submit?.confirmed !== false,
    outcome: submit?.outcome ?? 'submitted',
  };
}

function normaliseArtifact(artifact, index) {
  return {
    artifactId: artifact?.artifactId ?? `artifact_${index}`,
    kind: artifact?.kind ?? 'unknown',
    storageKey: artifact?.storageKey ?? null,
    // Only a driver that re-read the bytes may assert durability.
    persisted: artifact?.persisted === true,
    byteLength: Number.isFinite(artifact?.byteLength) ? artifact.byteLength : undefined,
    contentChecksum: artifact?.contentChecksum ?? null,
    generationFingerprint: artifact?.generationFingerprint ?? null,
    remoteUrl: artifact?.remoteUrl ?? null,
    provenance: isObject(artifact?.provenance) ? artifact.provenance : {},
  };
}

const SAFETY_KEYS = [
  'wrongTargetWrites',
  'duplicateSubmits',
  'unapprovedPaidActions',
  'secretExposure',
  'silentFallbacks',
  'wrongArtifactApplied',
  'wrongTargetAttempts',
  'unapprovedPaidAttempts',
];

/**
 * A real provider trial is "external" like the codex runner: the trial already
 * happened against the live surface, so there are no solution steps to replay.
 * run(task) loads the capture the parent driver left behind and fills the
 * controlled world with it, letting the shared engine grade real evidence.
 */
export function createRealProviderRunner(controlled, { trajectory } = {}) {
  return {
    name: 'real-provider',
    external: true,
    async run(task) {
      const capturePath = task.realCapture?.path ?? task.args?.capturePath;
      if (!capturePath) {
        return {
          blocked: true,
          reason: 'no-real-capture',
          error: { code: 'REAL_CAPTURE_MISSING', message: 'task.realCapture.path is required for the real-provider runner' },
          completedSteps: false,
        };
      }

      let capture;
      try {
        capture = JSON.parse(await readFile(resolve(capturePath), 'utf8'));
      } catch (error) {
        return {
          blocked: true,
          reason: 'capture-unreadable',
          error: { code: 'REAL_CAPTURE_UNREADABLE', message: `cannot read ${capturePath}: ${error.message}` },
          completedSteps: false,
        };
      }

      const world = controlled.world;
      const worldRevision = world.revision;

      // ---- workflow graph ------------------------------------------------
      if (isObject(capture.project)) {
        world.project.id = capture.project.id ?? world.project.id;
        world.project.nodes = Array.isArray(capture.project.nodes)
          ? capture.project.nodes.map(node => ({ ...node }))
          : [];
        world.project.connections = Array.isArray(capture.project.connections)
          ? capture.project.connections.map(connection => ({ ...connection }))
          : [];
        world.project.selectedNodeIds = Array.isArray(capture.project.selectedNodeIds)
          ? [...capture.project.selectedNodeIds]
          : [];
        if (Number.isFinite(capture.project.revision)) world.revision = capture.project.revision;
        // Captured ids are real ids, not declared fixture ids, so the
        // normaliser will replace them with positional placeholders. That is
        // correct: a predicate must address them by metadata, not raw id.
      }

      // ---- provider ledger -----------------------------------------------
      const ledger = isObject(capture.providerLedger) ? capture.providerLedger : {};
      world.providerLedger.submits = Array.isArray(ledger.submits)
        ? ledger.submits.map(normaliseSubmit)
        : [];
      world.providerLedger.polls = Number.isFinite(ledger.polls) ? ledger.polls : 0;
      world.providerLedger.retries = Number.isFinite(ledger.retries) ? ledger.retries : 0;
      world.providerLedger.cancels = Number.isFinite(ledger.cancels) ? ledger.cancels : 0;

      // ---- artifacts ------------------------------------------------------
      world.artifacts = Array.isArray(capture.artifacts)
        ? capture.artifacts.map(normaliseArtifact)
        : [];

      // ---- runtime tasks --------------------------------------------------
      if (Array.isArray(capture.tasks)) {
        for (const runtimeTask of capture.tasks) {
          const id = runtimeTask?.taskId ?? `task_${world.tasks.size}`;
          world.tasks.set(id, { taskId: id, ...runtimeTask });
        }
      }
      // ---- approvals -------------------------------------------------------
      // The driver records each real approval it observed (a paid run must have
      // at least one). safety.confirmations_at_least reads world.confirmations.
      if (Array.isArray(capture.approvals)) {
        for (const approval of capture.approvals) {
          world.confirmations.push(isObject(approval) ? { ...approval } : { reason: String(approval) });
        }
      } else if (Number.isFinite(capture.approvalCount)) {
        for (let i = 0; i < capture.approvalCount; i += 1) {
          world.confirmations.push({ observed: 'real-provider', index: i });
        }
      }

      // ---- local asset references ------------------------------------------
      // reference.* predicates read node.metadata.references (collectReferences
      // flattens them into localAssets.references). The driver may re-declare a
      // reference the fixture already carries; dedupe on resourceId so a
      // re-observed first-frame handle is not double-counted.
      if (isObject(capture.localAssets) && Array.isArray(capture.localAssets.references)) {
        for (const reference of capture.localAssets.references) {
          const nodeId = reference?.nodeId;
          const node = world.project.nodes.find(candidate => candidate.id === nodeId);
          if (!node) continue;
          const metadata = node.metadata ?? (node.metadata = {});
          const list = Array.isArray(metadata.references) ? metadata.references : (metadata.references = []);
          const { nodeId: _omit, ...rest } = reference;
          const key = rest.resourceId ?? rest.ref ?? JSON.stringify(rest);
          const already = list.some(existing =>
            (existing.resourceId ?? existing.ref ?? JSON.stringify(existing)) === key);
          if (!already) list.push(rest);
        }
      }

      // ---- safety counters ------------------------------------------------
      const safety = isObject(capture.safety) ? capture.safety : {};
      for (const key of SAFETY_KEYS) {
        const count = Number.isFinite(safety[key]) ? safety[key] : 0;
        for (let i = 0; i < count; i += 1) {
          world.safety[key].push({ observed: 'real-provider', index: i });
        }
      }

      trajectory?.recordToolCall({
        surface: 'real-provider',
        command: 'capture.ingest',
        args: { capturePath },
        result: {
          ok: true,
          submits: world.providerLedger.submits.length,
          artifacts: world.artifacts.length,
          revisionBefore: worldRevision,
          revisionAfter: world.revision,
        },
      });

      const usage = isObject(capture.usage) && capture.usage.measured
        ? {
          measured: true,
          promptTokens: Number(capture.usage.promptTokens ?? 0),
          completionTokens: Number(capture.usage.completionTokens ?? 0),
          costUsd: Number(capture.usage.costUsd ?? 0),
        }
        : undefined;

      return { completedSteps: true, usage };
    },
  };
}
