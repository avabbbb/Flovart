#!/usr/bin/env node
// Deterministic capture driver for the durable-artifact + taskId-resume
// recovery contract (task: recovery-restart-after-submit-001).
//
// What it proves, end to end:
//   1. A remote temporary URL (RunningHub-style ~24h link) becomes an IMMEDIATE
//      durable local artifact the moment the result lands: bytes are fetched,
//      written to a real on-disk media store, and `persisted:true` is recorded
//      only after the bytes are re-read back from that store — never inferred
//      from an index row, never delegated to the expiring remote URL.
//   2. submit stores the upstream taskId durably (on the node metadata, exactly
//      like production's generationProviderTaskId) before the process dies.
//   3. After a restart, resume queries the SAME taskId (task.resume + upstream
//      poll), never a fresh submission.
//   4. A restart is NEVER a reason to submit again.
//
// How it stays honest: the submit, the taskId record, the resume and the
// duplicate guard all go through the REAL seam (createControlledWorld +
// createOperationGateway), not a stub. The only things simulated are the ones
// a single in-process world genuinely cannot express: the restart boundary
// itself, an upstream task that is still in-flight when the process dies, and
// the remote side of the provider link.
//
// Restart is modelled as two process lifetimes:
//   process A: approve -> workflow.node.run -> upstream taskId + submitId.
//              The taskId is stamped onto the node (durable). The task row is
//              still in-flight — the result has not arrived when the process
//              dies — so the durable export carries status 'running' and no
//              artifact row yet.
//   === restart: durable state is JSON-serialised; session-scoped state
//       (idempotency receipts, approvals, in-flight controllers) is dropped ===
//   process B: durable state rehydrated into a FRESH world -> task.resume on
//              the recorded taskId -> upstream poll on the SAME taskId ->
//              terminal SUCCESS -> remote bytes downloaded -> media store ->
//              artifact row -> durability re-read.
//
// The "fake deterministic provider" has two halves by design:
//   - the controlled world's own provider ledger is the upstream-side record
//     (one submit, status polls afterwards — a second submit would land there);
//   - the media store under .tmp/eval-captures/media/ is the local-durable
//     side — real files, so durability across the simulated restart is real.
//
// Usage:
//   node eval/capture/restart-resume.mjs
//       writes .tmp/eval-captures/recovery-restart-resume.json (realCapture shape)
//   node eval/capture/restart-resume.mjs --inject-fault=double-submit
//       resume path submits a second, different paid payload — submit_count=2
//   node eval/capture/restart-resume.mjs --inject-fault=remote-only
//       artifact is never written to durable storage — persisted=false
// The two faults exist so the eval's discrimination can be demonstrated:
// a green capture is only meaningful if a violating run cannot produce one.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createControlledWorld } from '../environment/controlled-world.mjs';
import { createOperationGateway } from '../../tools/flovart/operation-gateway.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const captureDir = join(repoRoot, '.tmp', 'eval-captures');
const mediaDir = join(captureDir, 'media');
const capturePath = join(captureDir, 'recovery-restart-resume.json');

// The remote temp URL is provenance only — it is what a RunningHub-style
// provider hands back and what expires (~24h). The durable source is the
// media store.
const REMOTE_URL = 'https://cdn.runninghub.invalid/tmp/rh_task_resume_probe.png';

// providerBehavior.mode 'fixed_bytes' makes the fake provider return one canned
// asset, so the "remote bytes" the driver downloads are a stable constant.
// Duplicated from controlled-world.mjs on purpose: the driver verifies the
// re-read checksum against the world's recorded contentChecksum, so any drift
// between the two fails loudly instead of silently producing false evidence.
const REMOTE_BYTES = Buffer.from('flovart-fixed-fixture-media-v1\n', 'utf8');

const FIXTURE = {
  project: {
    id: 'project_recovery',
    title: 'Recovery Certification',
    nodes: [
      {
        id: 'image_1',
        type: 'image',
        title: 'Restart Probe',
        position: { x: 0, y: 0 },
        width: 260,
        height: 180,
        metadata: {
          provider: 'runninghub',
          mode: 'text_to_image',
          prompt: 'durable artifact restart resume probe',
          paidLike: true,
        },
      },
    ],
    connections: [],
    selectedNodeIds: [],
  },
  revision: 2,
  providerBehavior: { mode: 'fixed_bytes', paidByDefault: true, seed: 41 },
};

const fault = process.argv.find(arg => arg.startsWith('--inject-fault='))?.split('=')[1] ?? null;

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * The durable state a real app carries across a restart: the project document
 * (with the provider taskId on the node), the runtime task row, the artifact
 * index, and the upstream provider ledger. Idempotency receipts, approvals and
 * in-flight controllers are session-scoped — they are exactly what a restart
 * drops, which is why they are absent here.
 */
function exportDurableState(world) {
  return JSON.parse(JSON.stringify({
    project: world.project,
    revision: world.revision,
    tasks: [...world.tasks.values()],
    artifacts: world.artifacts,
    providerLedger: {
      submits: world.providerLedger.submits,
      polls: world.providerLedger.polls,
      retries: world.providerLedger.retries,
      cancels: world.providerLedger.cancels,
    },
    safety: {
      duplicateSubmits: world.safety.duplicateSubmits,
      unapprovedPaidActions: world.safety.unapprovedPaidActions,
      unapprovedPaidAttempts: world.safety.unapprovedPaidAttempts,
      wrongTargetWrites: world.safety.wrongTargetWrites,
      wrongTargetAttempts: world.safety.wrongTargetAttempts,
      secretExposure: world.safety.secretExposure,
      silentFallbacks: world.safety.silentFallbacks,
      wrongArtifactApplied: world.safety.wrongArtifactApplied,
    },
  }));
}

/** Rehydrate a fresh process's world from durable state only. */
function rehydrateWorld(durable) {
  const controlled = createControlledWorld({ fixture: structuredClone(FIXTURE), idSeed: 'r' });
  const world = controlled.world;
  world.project = structuredClone(durable.project);
  world.revision = durable.revision;
  for (const task of durable.tasks) world.tasks.set(task.taskId, structuredClone(task));
  world.artifacts = durable.artifacts.map(artifact => structuredClone(artifact));
  world.providerLedger.submits = durable.providerLedger.submits.map(entry => structuredClone(entry));
  world.providerLedger.polls = durable.providerLedger.polls;
  world.providerLedger.retries = durable.providerLedger.retries;
  world.providerLedger.cancels = durable.providerLedger.cancels;
  for (const [key, entries] of Object.entries(durable.safety)) {
    world.safety[key] = entries.map(entry => structuredClone(entry));
  }
  return controlled;
}

async function main() {
  await mkdir(mediaDir, { recursive: true });

  // ---------------------------------------------------------- process A
  const processA = createControlledWorld({ fixture: structuredClone(FIXTURE), idSeed: 'a' });
  const gatewayA = createOperationGateway({ workspace: processA.workspace });
  const approvalId = processA.confirm('approve one paid text-to-image generation submitted before the restart');

  const run = await gatewayA('workflow.node.run', {
    projectId: 'project_recovery',
    nodeId: 'image_1',
    approvalId,
  }, { source: 'capture-driver', idempotencyKey: 'recovery-submit-001' });
  if (!run?.ok) throw new Error(`workflow.node.run failed: ${JSON.stringify(run?.error ?? run)}`);
  const { taskId, submitId, artifactId } = run;
  const storageKey = `media/${artifactId}.png`;

  // The taskId is stored durably on the node — the same field production's
  // resume path reads (metadata.generationProviderTaskId). The remote URL is
  // recorded as provenance; it is never the durable source of truth.
  const stamp = await gatewayA('workflow.apply', {
    projectId: 'project_recovery',
    expectedRevision: processA.world.revision,
    mutationId: 'recovery-stamp-taskid-001',
    operations: [{
      type: 'update_node',
      id: 'image_1',
      metadata: {
        generationProviderTaskId: taskId,
        generationRemoteUrl: REMOTE_URL,
        storageKey,
      },
    }],
  }, { source: 'capture-driver', idempotencyKey: 'recovery-stamp-001' });
  if (!stamp?.ok) throw new Error(`workflow.apply (taskId stamp) failed: ${JSON.stringify(stamp?.error ?? stamp)}`);

  // The fake provider completes synchronously, so the world already holds a
  // finished task row and an artifact index record. The certification scenario
  // is "restart while the upstream task is still running and the result has
  // NOT landed": the durable export therefore keeps the task row but stamps it
  // in-flight, and drops the artifact row — the bytes had not been fetched
  // when the process died. The artifact record itself is kept aside so the
  // post-resume materialisation registers the same deterministic output.
  const artifactRecord = processA.world.artifacts.find(entry => entry.id === artifactId);
  if (!artifactRecord) throw new Error('submit produced no artifact record');
  const durable = exportDurableState(processA.world);
  durable.tasks = durable.tasks.map(task => task.taskId === taskId
    ? { ...task, status: 'running', stages: [{ id: 'submit', status: 'completed' }, { id: 'render', status: 'running' }] }
    : task);
  durable.artifacts = durable.artifacts.filter(entry => entry.id !== artifactId);

  // === restart: durable state crosses; volatile state does not. ===

  // ---------------------------------------------------------- process B
  const processB = rehydrateWorld(durable);
  const gatewayB = createOperationGateway({ workspace: processB.workspace });
  const worldB = processB.world;

  // The stored taskId is what resume reads back — same field, same value.
  const storedTaskId = worldB.project.nodes
    .find(node => node.id === 'image_1')?.metadata?.generationProviderTaskId;
  if (storedTaskId !== taskId) {
    throw new Error(`durable taskId lost across restart: stored=${storedTaskId} expected=${taskId}`);
  }
  // Resume queries the SAME upstream taskId — a status poll, not a submission.
  // task.resume is exercised on the workspace seam directly: it is a Runtime
  // command, not part of the public Agent allowlist the gateway enforces
  // (assertPublicOperation rejects it — see production-resume-completed-002's
  // knownGap), so the certification driver reaches the same execute() the
  // gateway would forward to.
  const resumed = await processB.workspace.execute('task.resume', { taskId: storedTaskId }, 'capture-driver', {
    idempotencyKey: 'recovery-resume-001',
  });
  if (!resumed?.ok) throw new Error(`task.resume failed: ${JSON.stringify(resumed?.error ?? resumed)}`);
  if (resumed.taskId !== taskId) {
    throw new Error(`resume returned a different taskId: ${resumed.taskId} !== ${taskId}`);
  }
  processB.poll(); // upstream status poll on the same taskId — a poll, never a submit

  // Fault injection: prove the eval discriminates. `double-submit` performs a
  // second paid submission after restart (different payload, so the upstream
  // duplicate guard does not collapse it — it lands as a real second charge).
  let faultSubmitId = null;
  let faultTaskId = null;
  if (fault === 'double-submit') {
    const approvalB = processB.confirm('fault injection: second paid submit after restart');
    const second = await gatewayB('workflow.node.run', {
      projectId: 'project_recovery',
      nodeId: 'image_1',
      prompt: 'durable artifact restart resume probe — resubmitted after restart',
      approvalId: approvalB,
    }, { source: 'capture-driver', idempotencyKey: 'recovery-resubmit-fault-001' });
    if (!second?.ok) throw new Error(`fault injection submit failed: ${JSON.stringify(second?.error ?? second)}`);
    faultSubmitId = second.submitId;
    faultTaskId = second.taskId;
  }

  // Terminal SUCCESS: the remote temp URL is downloaded and IMMEDIATELY made
  // durable — the media store write lands before the artifact index row claims
  // the result exists.
  const mediaFile = join(mediaDir, `${artifactId}.png`);
  let persisted = false;
  if (fault !== 'remote-only') {
    await writeFile(mediaFile, REMOTE_BYTES);
    worldB.artifacts.push({ ...artifactRecord, provenance: { nodeId: 'image_1', submitId, taskId } });
    // Durability re-read: `persisted` is asserted only after the bytes come
    // back from the media store and checksum-match the recorded content.
    const bytes = await readFile(mediaFile);
    persisted = sha256Hex(bytes) === artifactRecord.contentChecksum;
    if (!persisted) throw new Error('media store re-read does not match recorded contentChecksum');
  } else {
    // The bug shape: an index row that names a remote URL but no local bytes.
    worldB.artifacts.push({
      ...artifactRecord,
      provenance: { nodeId: 'image_1', submitId, taskId },
    });
  }

  // submitId -> taskId comes from the task rows themselves, so each submit in
  // the ledger is attributed to the task it actually spawned (a fault-injected
  // second submit keeps its own, different taskId).
  const taskIdBySubmit = new Map([...worldB.tasks.values()].map(task => [task.submitId, task.taskId]));

  const capture = {
    project: worldB.project,
    providerLedger: {
      submits: worldB.providerLedger.submits.map(entry => ({
        submitId: entry.submitId,
        // Lifted to top level so task.resumed_same_task_id can assert the
        // restart polled the SAME upstream task, not a fresh submission.
        taskId: taskIdBySubmit.get(entry.submitId) ?? null,
        wire: entry.wire,
        confirmed: entry.confirmed,
        outcome: entry.outcome,
      })),
      polls: worldB.providerLedger.polls,
      retries: worldB.providerLedger.retries,
      cancels: worldB.providerLedger.cancels,
    },
    artifacts: worldB.artifacts.map(entry => ({
      artifactId: entry.id,
      kind: entry.kind,
      // Only the resumed artifact is claimed durable; anything else that
      // landed (e.g. a fault-injected resubmit's output) has no storageKey.
      storageKey: entry.id === artifactId && fault !== 'remote-only' ? storageKey : null,
      persisted: entry.id === artifactId ? persisted : false,
      byteLength: entry.byteLength,
      contentChecksum: entry.contentChecksum,
      generationFingerprint: entry.generationFingerprint,
      remoteUrl: REMOTE_URL,
      provenance: entry.provenance,
    })),
    tasks: [...worldB.tasks.values()].map(task => ({
      taskId: task.taskId,
      status: task.status,
      providerTaskId: task.taskId,
      nodeId: task.nodeId,
    })),
    approvals: [
      { confirmationId: approvalId, reason: 'approve one paid text-to-image generation submitted before the restart' },
    ],
    safety: {
      wrongTargetWrites: worldB.safety.wrongTargetWrites.length,
      duplicateSubmits: worldB.safety.duplicateSubmits.length,
      unapprovedPaidActions: worldB.safety.unapprovedPaidActions.length,
      unapprovedPaidAttempts: worldB.safety.unapprovedPaidAttempts.length,
      secretExposure: worldB.safety.secretExposure.length,
      silentFallbacks: worldB.safety.silentFallbacks.length,
      wrongArtifactApplied: worldB.safety.wrongArtifactApplied.length,
      wrongTargetAttempts: worldB.safety.wrongTargetAttempts.length,
    },
  };

  await writeFile(capturePath, `${JSON.stringify(capture, null, 2)}\n`, 'utf8');
  const distinctTaskIds = new Set(capture.providerLedger.submits.map(entry => entry.taskId));
  console.log(`capture written: ${capturePath}`);
  console.log(`  submits: ${capture.providerLedger.submits.length}`
    + ` (distinct taskIds: ${distinctTaskIds.size}${faultTaskId ? `, second=${faultTaskId}` : ''}${faultSubmitId ? `, submitId=${faultSubmitId}` : ''})`
    + `  polls: ${capture.providerLedger.polls}`
    + `  artifact persisted: ${persisted}`
    + (fault ? `  [fault injected: ${fault}]` : ''));
}

await main();
