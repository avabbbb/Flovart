// Task loading and validation.
//
// A task is instruction + environment + verifier. It never contains a mandatory
// reference trajectory: the reference solution is used to derive and validate
// the target final state, not to force a specific tool path.

import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listPredicates } from '../graders/predicates.mjs';

const TASK_DIRS = {
  workflow: 'workflow',
  references: 'references',
  provider: 'provider',
  'production-task': 'production-task',
  agent: 'agent',
  'local-assets': 'local-assets',
  environment: 'environment',
};

export const SPLITS = ['dev', 'regression', 'holdout'];

/**
 * Read task files out of a directory tree.
 * The holdout dataset is mounted by path at certification time and is never
 * committed to this repository, so reading it is the same code path as reading
 * the public suites - there is no second, weaker loader.
 */
async function collectTaskFiles(root, { suite, onlySuites } = {}) {
  const files = [];
  const suiteDirs = Object.entries(TASK_DIRS).filter(([name]) => !suite || name === suite);
  for (const [name, dir] of suiteDirs) {
    const suiteRoot = join(root, dir);
    let entries = [];
    try {
      entries = await readdir(suiteRoot);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      files.push({ file: join(suiteRoot, entry), suite: name });
    }
  }
  // A mounted holdout may also be a flat directory of task files, which is
  // easier to hand to an evaluator without also handing them our layout.
  if (!onlySuites) {
    let flat = [];
    try {
      flat = await readdir(root, { withFileTypes: true });
    } catch {
      flat = [];
    }
    for (const entry of flat) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      files.push({ file: join(root, entry.name), suite: null });
    }
  }
  return files;
}

export async function loadTasks(evalRoot, { suite, split, holdoutDir } = {}) {
  const files = await collectTaskFiles(join(evalRoot, 'tasks'), { suite, onlySuites: true });
  if (holdoutDir) {
    // Holdout files are never written back to, so they are loaded read-only and
    // always tagged `holdout` regardless of what they declare.
    files.push(...await collectTaskFiles(holdoutDir, {}));
  }

  const tasks = [];
  for (const { file, suite: suiteName } of files) {
    const raw = await readFile(file, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${basename(file)} is not valid JSON: ${error.message}`);
    }
    const isHoldout = holdoutDir && file.startsWith(holdoutDir);
    const declared = Array.isArray(parsed.tasks) ? parsed.tasks : [parsed];
    for (const task of declared) {
      // __path lets tooling (e.g. --freeze-hashes) write back to the right file.
      // Holdout tasks carry no writable path on purpose: their hashes are frozen
      // by whoever owns the private dataset, not by a public run.
      tasks.push({
        ...task,
        suite: task.suite ?? suiteName ?? parsed.suite,
        ...(isHoldout ? {} : { __file: basename(file), __path: file }),
        ...(isHoldout ? { __holdout: true } : {}),
      });
    }
  }

  // The public repo carries dev + regression. Holdout datasets live outside the
  // repository (see eval/README.md) and are mounted by path when certified.
  const withSplit = tasks.map(task => ({
    ...task,
    // A mounted holdout is holdout no matter what the file says; anything else
    // defaults to regression, because a task with no declared split is one that
    // has been admitted and belongs in the slower gate.
    split: task.__holdout ? 'holdout' : (task.split ?? 'regression'),
  }));
  return split ? withSplit.filter(task => task.split === split) : withSplit;
}

export const REQUIRED_FIELDS = ['id', 'version', 'suite', 'instruction', 'expected'];

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\b[0-9a-f]{64}\b/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
];

const ABSOLUTE_PATH_PATTERN = /(?:^[A-Za-z]:[\\/]|^\\\\|^\/Users\/|^\/home\/)/;

export function validateTask(task, { index, allIds }) {
  const errors = [];
  const where = task.id ?? `#${index}`;

  for (const field of REQUIRED_FIELDS) {
    if (task[field] === undefined || task[field] === null || task[field] === '') {
      errors.push(`${where}: missing required field "${field}"`);
    }
  }

  if (!task.expected?.predicates || Object.keys(task.expected.predicates).length === 0) {
    errors.push(`${where}: expected.predicates must not be empty`);
  }

  const known = new Set(listPredicates());
  for (const name of Object.keys(task.expected?.predicates ?? {})) {
    if (!known.has(name)) errors.push(`${where}: unknown predicate "${name}"`);
  }

  // Exact grading is an addition to predicate grading, not a replacement, so a
  // frozen hash must be a real canonical hash or it silently degrades to
  // "predicates only".
  if (task.expected?.exactCanonical !== undefined
      && !/^fnv1a_[0-9a-f]{16}$/.test(String(task.expected.exactCanonical))) {
    errors.push(`${where}: expected.exactCanonical must be a canonical hash (fnv1a_ + 16 hex)`);
  }

  if (!task.solution?.steps || task.solution.steps.length === 0) {
    errors.push(`${where}: solution.steps must not be empty (oracle needs a reference solution)`);
  }

  const canonicalArgs = new Set(['projectId', 'nodeId', 'expectedRevision', 'mutationId', 'clientId', 'intent', 'operations', 'approvalId', 'confirmed', 'mode', 'prompt', 'paidLike', 'references', 'taskId']);
  for (const [stepIndex, step] of (task.solution?.steps ?? []).entries()) {
    if (!step.command) errors.push(`${where}: step ${stepIndex} missing command`);
    const isWrite = step.command === 'workflow.apply' || step.command === 'workflow.node.run';
    if (isWrite && !step.idempotencyKey && !step.allowFailure) {
      errors.push(`${where}: step ${stepIndex} (${step.command}) requires idempotencyKey`);
    }
    // The canonical Agent surface names the batch `operations`, not `ops`.
    if (step.command === 'workflow.apply') {
      if (!Array.isArray(step.args?.operations) || step.args.operations.length === 0) {
        errors.push(`${where}: step ${stepIndex} (workflow.apply) requires a non-empty args.operations`);
      }
      if (!step.args?.mutationId) {
        errors.push(`${where}: step ${stepIndex} (workflow.apply) requires args.mutationId`);
      }
    }
    // runtime.* steps belong to the environment suite and describe a deployment
    // condition rather than an Agent tool call, so they have their own vocabulary.
    if (!String(step.command).startsWith('runtime.')) {
      for (const key of Object.keys(step.args ?? {})) {
        if (!canonicalArgs.has(key)) {
          errors.push(`${where}: step ${stepIndex} (${step.command}) uses a non-canonical argument "${key}"`);
        }
      }
    }
  }

  if (task.id && allIds) {
    if (allIds.has(task.id)) errors.push(`${where}: duplicate task id`);
    else allIds.add(task.id);
  }

  // Internal bookkeeping fields (`__file`, `__path`) are added by the loader and
  // are not part of the task definition, so they must not be scanned as content.
  const serialised = JSON.stringify(
    Object.fromEntries(Object.entries(task).filter(([key]) => !key.startsWith('__'))),
  );
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialised)) {
      errors.push(`${where}: task definition appears to contain a secret`);
      break;
    }
  }
  const pathMatches = serialised.match(/"[^"]*"/g) ?? [];
  for (const literal of pathMatches) {
    if (ABSOLUTE_PATH_PATTERN.test(literal.slice(1, -1)) && !literal.includes('local-folder:')) {
      errors.push(`${where}: task embeds an absolute developer path ${literal}`);
      break;
    }
  }

  return errors;
}

export async function validateAll(evalRoot, { suite, holdoutDir } = {}) {
  const tasks = await loadTasks(evalRoot, { suite, holdoutDir });
  const allIds = new Set();
  const errors = [];
  const committed = [];
  for (const [index, task] of tasks.entries()) {
    // The holdout set only has value while it is private. A committed holdout
    // task is a contradiction: it is public the moment it is in the repository,
    // so it must be reported as regression instead of pretending otherwise.
    if (!task.__holdout && task.split === 'holdout') {
      errors.push(`${task.id}: a committed task cannot declare split "holdout" - holdout datasets are mounted by path`);
    }
    if (task.__holdout) committed.push(task.id);
    errors.push(...validateTask(task, { index, allIds }));
  }
  return { tasks, errors, count: tasks.length, holdoutIds: committed };
}

export function taskById(tasks, id) {
  return tasks.find(task => task.id === id) ?? null;
}

export const __module = pathToFileURL(import.meta.url).href;
