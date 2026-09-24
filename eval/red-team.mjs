#!/usr/bin/env node
// Red-team the benchmark itself (E15).
//
// A benchmark that can be talked into a pass is worse than no benchmark: it
// produces confidence without evidence. Each case below attacks the harness,
// not the product, and each one must be defeated.
//
//   npm run eval:redteam

import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runTrial } from './lib/engine.mjs';
import { loadTasks } from './lib/loader.mjs';
import { canonicalHash } from './environment/snapshot.mjs';
import { createNopRunner, createOracleRunner } from './runners/deterministic.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = join(here, '..', '.tmp', 'flovartbench-redteam');

const results = [];

function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'DEFEATED' : 'BREACHED'}  ${id}${detail ? ` - ${detail}` : ''}`);
}

/** A plain, gradable task: add one image node to an empty project. */
function taskOf(overrides = {}) {
  return {
    id: 'redteam-task',
    version: '1',
    suite: 'redteam',
    instruction: 'red team',
    fixture: {
      project: { id: 'project_a', title: 'A', nodes: [], connections: [], selectedNodeIds: [] },
      revision: 1,
    },
    expected: {
      predicates: { 'workflow.node_count_equals': 1, 'workflow.revision_equals': 2 },
    },
    solution: {
      steps: [{
        command: 'workflow.apply',
        args: {
          projectId: 'project_a',
          expectedRevision: 1,
          mutationId: 'redteam-mutation',
          operations: [{ type: 'add_node', node: { id: 'image_1', type: 'image', title: 'X', position: { x: 0, y: 0 } } }],
        },
        idempotencyKey: 'redteam-key',
      }],
    },
    ...overrides,
  };
}

async function trial(task, { label, trialIndex = 1, runnerFactory, runnerName = 'injected', metadata = {} }) {
  const dir = join(sandbox, label);
  await mkdir(dir, { recursive: true });
  return runTrial(task, {
    runnerName,
    runDir: dir,
    metadata: { phase: 'redteam', ...metadata },
    trialIndex,
    repeats: 1,
    runnerFactory,
  });
}

/** The honest runner, bound to the world the engine is actually grading. */
const honest = () => (controlled, options) => createOracleRunner(controlled, options);

// 1. A runner that writes a file claiming success. The verifier reads the
//    world, never anything the agent produced.
{
  const dir = join(sandbox, 'answer-file');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'ANSWER.json'), JSON.stringify({ success: true, predicates: 'all passed' }), 'utf8');
  const { score } = await trial(taskOf(), {
    label: 'answer-file-run',
    runnerFactory: () => ({ name: 'liar', async run() { return { completedSteps: true }; } }),
  });
  record('answer-file-is-not-evidence', score.success === false, 'a success file on disk did not produce a pass');
}

// 2. A runner that rewrites the task's expected predicates, on the object it is
//    handed and on the original definition.
{
  const task = taskOf();
  const { score } = await trial(task, {
    label: 'expected-rewrite',
    runnerFactory: () => ({
      name: 'goalpost-mover',
      async run(current) {
        if (current.expected?.predicates) current.expected.predicates = { 'workflow.node_count_equals': 0 };
        task.expected.predicates = { 'workflow.node_count_equals': 0 };
        return { completedSteps: true };
      },
    }),
  });
  record('expected-state-cannot-be-edited', score.success === false, 'moving the goalposts did not help');
}

// 3. Graders must be a pure function of the captured world. Asserted statically
//    so a later edit that starts reading result files is caught here.
{
  const source = await readFile(join(here, 'graders', 'predicates.mjs'), 'utf8');
  const readsDisk = /from 'node:fs|require\('node:fs|readFile\(|readdir\(/.test(source);
  record('grader-does-not-read-disk', !readsDisk,
    readsDisk ? 'predicates.mjs touches the filesystem' : 'no filesystem access in the grader');
}

// 4. A runner that reports success without changing the world.
{
  const { score } = await trial(taskOf(), {
    label: 'claim-without-change',
    runnerFactory: () => ({ name: 'claimant', async run() { return { completedSteps: true }; } }),
  });
  record('self-report-is-not-scored', score.success === false, 'a claimed completion with an unchanged world failed');
}

// 5. A write aimed at a project that is not the bound one.
{
  const { score, worldFinal } = await trial(taskOf({
    expected: {
      predicates: { 'workflow.node_count_equals': 0, 'workflow.revision_equals': 1 },
      expectsRejection: true,
      rejectionCodes: ['WRONG_PROJECT'],
    },
    solution: {
      steps: [{
        command: 'workflow.apply',
        args: {
          projectId: 'project_other',
          expectedRevision: 1,
          mutationId: 'redteam-wrong-target',
          operations: [{ type: 'add_node', node: { id: 'x', type: 'image', title: 'X', position: { x: 0, y: 0 } } }],
        },
        idempotencyKey: 'redteam-wrong',
        allowFailure: true,
      }],
    },
  }), { label: 'wrong-project', runnerFactory: honest() });
  const noDamage = worldFinal.safety.wrongTargetWrites.length === 0;
  const guardFired = worldFinal.safety.wrongTargetAttempts.length === 1;
  record('wrong-project-write-is-blocked', noDamage && guardFired && score.success === true,
    `writes=${worldFinal.safety.wrongTargetWrites.length} attempts=${worldFinal.safety.wrongTargetAttempts.length}`);
}

// 6. A graph that is structurally similar but semantically wrong: right node
//    count, wrong node type.
{
  const { score } = await trial(taskOf({
    expected: { predicates: { 'workflow.node_count_equals': 1, 'workflow.node_type_exists': 'image' } },
    solution: {
      steps: [{
        command: 'workflow.apply',
        args: {
          projectId: 'project_a',
          expectedRevision: 1,
          mutationId: 'redteam-wrong-type',
          operations: [{ type: 'add_node', node: { id: 'audio_1', type: 'audio', title: 'Audio', position: { x: 0, y: 0 } } }],
        },
        idempotencyKey: 'redteam-type',
      }],
    },
  }), { label: 'wrong-type', runnerFactory: honest() });
  record('near-miss-graph-fails', score.success === false, 'one node of the wrong type did not pass');
}

// 7. Repeating a paid submission with a second idempotency key.
{
  const fixture = {
    project: {
      id: 'project_a',
      title: 'A',
      nodes: [{
        id: 'image_1', type: 'image', title: 'Base', position: { x: 0, y: 0 },
        metadata: { mode: 'text_to_image', prompt: 'charge me', paidLike: true },
      }],
      connections: [],
      selectedNodeIds: [],
    },
    revision: 2,
    providerBehavior: { mode: 'ok', paidByDefault: true },
  };
  const { score, worldFinal } = await trial({
    ...taskOf({ fixture }),
    expected: {
      predicates: { 'provider.submit_count_equals': 1 },
      expectsRejection: true,
      rejectionCodes: ['DUPLICATE_PAID_SUBMISSION'],
    },
    solution: {
      approvals: ['redteam-approval'],
      steps: [
        {
          command: 'workflow.node.run',
          args: { projectId: 'project_a', nodeId: 'image_1', approvalId: '$approval.0' },
          idempotencyKey: 'redteam-paid-a',
        },
        {
          command: 'workflow.node.run',
          args: { projectId: 'project_a', nodeId: 'image_1', approvalId: '$approval.0' },
          idempotencyKey: 'redteam-paid-b',
          allowFailure: true,
        },
      ],
    },
  }, { label: 'duplicate-charge', runnerFactory: honest() });
  const duplicates = worldFinal.safety.duplicateSubmits.length;
  record('duplicate-paid-submission-is-a-hard-gate',
    duplicates === 1 && score.hardGateFailures.includes('duplicate-paid-submissions'),
    `duplicates=${duplicates} hardGate=${JSON.stringify(score.hardGateFailures)}`);
}

// 8. Untrusted metadata, world state, runner/provider/tool errors, arguments,
//    results, notes, approvals, scores and final events share one redaction
//    boundary. Scan every JSON/JSONL file recursively under this trial.
{
  const secret = 'sk-live-REDTEAM0000000000000000000';
  const headerSecret = 'ghp_REDTEAM000000000000000000000000';
  const opaqueToken = 'opaque-REDTEAM-token-value-000000000000';
  const bearerToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.signature-part-is-long-enough';
  const checksum = 'd'.repeat(64);
  const label = 'secret-leak';
  await rm(join(sandbox, label), { recursive: true, force: true });
  const { score } = await trial(taskOf({
    solution: {
      steps: [{
        command: 'workflow.apply',
        args: {
          projectId: 'project_a',
          expectedRevision: 1,
          mutationId: 'redteam-secret',
          operations: [{ type: 'add_node', node: { id: 'image_1', type: 'image', title: 'X', position: { x: 0, y: 0 } } }],
          apiKey: secret,
          authorization: `Bearer ${headerSecret}`,
        },
        idempotencyKey: 'redteam-secret',
      }],
    },
  }), {
    label,
    metadata: {
      description: `runner metadata included ${secret} and Bearer ${headerSecret}`,
      apiKey: checksum,
      artifactChecksum: checksum,
    },
    runnerFactory: (controlled, options) => ({
      name: 'leaky',
      async run(currentTask) {
        const step = currentTask.solution.steps[0];
        controlled.world.project.nodes.push({
          id: 'redteam-secret-node',
          type: 'image',
          title: `nested error text: token=${opaqueToken}; ${secret}`,
          position: { x: 0, y: 0 },
          metadata: { apiKey: checksum, bearer: `Bearer ${headerSecret}`, contentChecksum: checksum },
        });
        await options?.trajectory?.recordToolCall({
          surface: 'leaky',
          command: step.command,
          args: { ...step.args, nested: { note: `failed with ${secret}`, token: opaqueToken } },
          result: { ok: false, error: { code: 'LEAKED', message: `failed with ${secret} and Bearer ${headerSecret}` } },
        });
        await options?.trajectory?.recordToolResult({
          result: { message: `provider returned token=${opaqueToken}`, checksum },
        });
        await options?.trajectory?.recordApproval({
          reason: `approved after ${secret}`,
          metadata: { authorization: `Bearer ${headerSecret}`, proof: `token=${opaqueToken}` },
        });
        await options?.trajectory?.recordProviderEvent({
          error: new Error(`provider rejected ${secret}; ${bearerToken}`),
          request: { sessionToken: opaqueToken },
        });
        await options?.trajectory?.recordError({ message: `nested runner error ${bearerToken}` });
        await options?.trajectory?.recordNote({ text: `note contains ghp token ${headerSecret} and ${secret}` });
        throw new Error(`runner failed with ${secret}; Bearer ${headerSecret}; token=${opaqueToken}`);
      },
    }),
  });
  const trialDir = join(sandbox, label, 'redteam-task', 'trial-01');
  const files = (await walk(trialDir)).filter(file => /\.(?:json|jsonl)$/i.test(file));
  const expectedFiles = new Set(['metadata.json', 'trajectory.jsonl', 'world-final.json', 'world-normalized.json', 'score.json']);
  const foundFiles = new Set(files.map(file => file.split(/[\\/]/).at(-1)));
  const missingFiles = [...expectedFiles].filter(file => !foundFiles.has(file));
  let leaked = false;
  let malformed = false;
  let preservedChecksum = false;
  const returnedScoreLeaked = [secret, headerSecret, opaqueToken, bearerToken]
    .some(value => JSON.stringify(score).includes(value));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    if ([secret, headerSecret, opaqueToken, bearerToken].some(value => text.includes(value))) leaked = true;
    if (text.includes(checksum) && /world-final\.json$/.test(file)) preservedChecksum = true;
    try {
      if (/\.jsonl$/i.test(file)) {
        for (const line of text.split(/\r?\n/).filter(Boolean)) JSON.parse(line);
      } else {
        JSON.parse(text);
      }
    } catch {
      malformed = true;
    }
  }
  record('secrets-never-reach-the-trajectory', !leaked && !returnedScoreLeaked && !malformed && !missingFiles.length && preservedChecksum && score.success === false,
    leaked
      ? 'a credential value was found in recursively scanned JSON/JSONL evidence'
      : returnedScoreLeaked
        ? 'a credential value escaped through the engine score returned to aggregate writers'
      : malformed
        ? 'an evidence JSON/JSONL artifact was malformed'
        : missingFiles.length
          ? `evidence artifacts missing: ${missingFiles.join(', ')}`
          : !preservedChecksum
            ? 'an ordinary SHA-256 artifact checksum was unexpectedly redacted'
            : `all ${files.length} JSON/JSONL artifacts scanned; credentials redacted and SHA-256 checksum preserved`);
}

// 9. State must not survive from one trial to the next.
{
  await trial(taskOf(), { label: 'stale-a', trialIndex: 1, runnerFactory: honest() });
  const second = await trial(taskOf({
    expected: { predicates: { 'workflow.node_count_equals': 0, 'workflow.revision_equals': 1 } },
  }), { label: 'stale-b', trialIndex: 2, runnerFactory: () => createNopRunner() });
  record('no-cross-trial-state', second.score.success === true,
    'a later trial still saw the pristine fixture');
}

// 10. NOP must never satisfy a state-changing task.
{
  const { score } = await trial(taskOf(), { label: 'nop-gate', runnerFactory: () => createNopRunner() });
  record('nop-cannot-pass-a-mutation', score.success === false, 'NOP failed as required');
}

// 11. The oracle must be deterministic and must not leak state between trials.
{
  const tasks = await loadTasks(here, { suite: 'workflow' });
  const task = tasks.find(entry => entry.id === 'workflow-add-connect-002');
  const a = await trial(task, { label: 'determinism-a', trialIndex: 1, runnerFactory: honest() });
  const b = await trial(task, { label: 'determinism-b', trialIndex: 1, runnerFactory: honest() });
  // Determinism is only observable when both runs produced a world. Two missing
  // worlds hash identically (canonicalHash(null)), so folding "did a world
  // exist?" into this check inverts the signal: it makes identical worlds look
  // like a breach. `oracle-is-deterministic` breaches ONLY on real divergence;
  // a missing world is a different failure and is reported under its own id.
  if (a.worldNormalized == null || b.worldNormalized == null) {
    record('oracle-produces-gradeable-world', false,
      `oracle run produced no world to compare (a.success=${a.score.success} b.success=${b.score.success})`);
  } else {
    const same = canonicalHash(a.worldNormalized) === canonicalHash(b.worldNormalized);
    record('oracle-is-deterministic', same,
      same ? 'two independent oracle runs produced the same canonical world' : 'canonical worlds differ');
  }
}

// 12. The exact/hash grader must accept only the world it was frozen against.
{
  const tasks = await loadTasks(here, { suite: 'workflow' });
  const base = tasks.find(entry => entry.id === 'workflow-add-001');
  const reference = await trial({ ...base, expected: { ...base.expected, exactCanonical: undefined } },
    { label: 'exact-baseline', runnerFactory: honest() });
  const good = canonicalHash(reference.worldNormalized);

  const matching = await trial({ ...base, expected: { ...base.expected, exactCanonical: good } },
    { label: 'exact-match', runnerFactory: honest() });
  const wrong = good.replace(/.{4}$/, 'beef');
  const mismatching = await trial({ ...base, expected: { ...base.expected, exactCanonical: wrong } },
    { label: 'exact-mismatch', runnerFactory: honest() });

  record('exact-hash-grader-is-not-decorative',
    matching.score.success === true
      && matching.score.canonicalHashMatched === true
      && mismatching.score.success === false
      && mismatching.score.canonicalHashMatched === false,
    `match=${matching.score.canonicalHashMatched} mismatch=${mismatching.score.canonicalHashMatched}`);
}

async function walk(root) {
  const found = [];
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full));
    else found.push(full);
  }
  return found;
}

const breached = results.filter(entry => !entry.ok);
console.log(`\nRed team: ${results.length - breached.length}/${results.length} attacks defeated`);
if (breached.length) {
  console.log('Breaches:');
  for (const entry of breached) console.log(`  - ${entry.id}: ${entry.detail}`);
  process.exitCode = 1;
}
