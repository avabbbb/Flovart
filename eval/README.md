# FlovartBench v0.1

A system-level eval harness for Flovart's Agent / Workflow / Runtime chain.

It answers one question:

> Can a real agent, given only a natural-language instruction and no reference
> answer, drive Flovart through the real CLI / MCP / Workflow / Runtime surfaces
> to the correct final state - repeatedly - without writing to the wrong
> project, double-charging a Provider, bypassing cost approval, or leaking a
> secret?

## Score rules (non-negotiable)

| Rule | Where it is enforced |
| --- | --- |
| Outcome over reference trajectory | `eval/lib/engine.mjs` grades `worldNormalized` only; the trajectory is never scored |
| Two graders, both outcome-only | predicates (`expected.predicates`) are always on; `expected.exactCanonical` adds whole-world equality |
| Final system state over agent self-report | `eval/graders/predicates.mjs` reads the captured world, never the runner's claims |
| Repeated success over a single success | `pass@1` and `pass^5` are reported side by side |
| Holdout improvement over public-task overfitting | split policy below |
| Safety hard gates are never averaged | `collectHardGateFailures()` - one breach fails the run |

## Layout

```
eval/
  run.mjs                    CLI entry (validate / oracle / run / report)
  lib/loader.mjs             task loading + schema validation
  lib/engine.mjs             trial runner, grading, aggregation, failure classes
  lib/report.mjs             machine-generated report (JSON + Markdown)
  environment/               controlled world (the workspace seam) + snapshot/normaliser
  graders/predicates.mjs     predicate registry (outcome grading)
  graders/nativeEffects/     reserved, see its README
  runners/                   oracle / cli / mcp / nop / codex / environment / real-provider
  recorders/trajectory.mjs   JSONL trajectory + secret redaction
  tasks/<suite>/*.json       the dataset
  results/<run-id>/          per-trial evidence (generated)
  reports/<run-id>/          machine-generated reports (generated)
```

## Commands

```bash
npm run eval:validate    # schema, fixtures, graders, ids, secrets, dev paths
npm run eval:oracle      # Oracle x5 + NOP admission gate
npm run eval:core        # deterministic baseline: oracle + cli + mcp
npm run eval:agent       # agent group (codex is blocked unless allowed)
npm run eval:report      # generate report.json + report.md from the latest run
```

Flags: `--suite`, `--runner`, `--repeat`, `--task`, `--group`, `--split`,
`--run`, `--include-gaps`, `--freeze-hashes`.

### Grading modes

**Predicate grading** (`expected.predicates`) is always on: each predicate names
one field of the normalised world, so a failure points at exactly what is wrong.

**Exact grading** (`expected.exactCanonical`) is an additional assertion: the
whole normalised world must equal the frozen reference. It is written by a real
oracle run, never by hand:

```bash
node eval/run.mjs oracle --freeze-hashes      # derive and write hashes
node eval/run.mjs oracle                      # verify every frozen hash still holds
```

Two guards make it safe:

- A hash that no longer matches is reported as **stale dataset** (`stale canonical
  hashes`), not as a task failure — the world moved and the frozen value has to be
  re-derived. It never silently passes.
- The oracle asserts that all 5 trials produce **one** canonical world. Two
  distinct worlds from the same reference solution means the harness or the
  product is non-deterministic, and no single trial can be the reference.

The `environment` suite is excluded from freezing: its captured world records the
host platform, so a Windows-frozen hash would be stale on POSIX.

### Rejection codes

`expected.rejectionCodes` asserts *which* error came back. Both directions are
checked, so a rejection for the wrong reason fails, and an unexpected rejection
also fails. `Test that it failed` is not a test.

`FLOVARTBENCH_ALLOW_CODEX=true` plus a real `codex` binary on PATH is required
before the Codex runner will do anything other than report itself blocked.

## Suites

| Suite | Admissible tasks | What it proves |
| --- | --- | --- |
| `workflow` | 12 | graph mutations reach the right final state, including rejection and idempotent replay |
| `references` | 9 (+1 known gap) | reference roles and wiring survive, deduped, in order |
| `provider` | 6 (+2 surface-scoped) | cost approval, refusals, no duplicate paid submission |
| `production-task` | 8 (+2 known gaps) | run / inspect / replay without re-charging |
| `agent` | 6 | the agent-entry projection reaches the same world |
| `local-assets` | 6 | local folder grants, Chinese paths, managed copies |
| `environment` | 4 (+1 posix) | Runtime discovery permission contract (the Hosted CI blocker) |
| `native-effects` | 0 (reserved) | nothing claimed |
| `recovery` | 1 | durable artifact + taskId-resume across a restart (deterministic capture) |

## Admission gate (E6)

A task enters the dataset only when:

- `Oracle x5` is stable **5/5**, where "oracle" means the reference solution run
  by the runner that can express it (`runnerScope[0]`), and
- `NOP` **fails** every state-changing task, so the grader is proven to
  discriminate, and
- no predicate is unknown, no secret is embedded, no absolute developer path is
  embedded, and every write step carries an idempotency key.

Tasks whose premise the product does not implement carry `knownGap`. They are
measured and listed but excluded from the admissible count - they never turn
into a green number. Tasks scoped to another platform report
`PLATFORM_NOT_APPLICABLE` and are excluded the same way.

## Runner scope (E5)

A task is scoped to the surfaces that can express it:

| Runner | Real surface |
| --- | --- |
| `oracle` | `createOperationGateway` -> `workspace.execute` |
| `cli` | `executeFlovartCommand` (the `npm run flovart:cli` dispatcher) |
| `mcp` | `createMcpServer` over a real MCP transport |
| `nop` | nothing at all; used to prove graders discriminate |
| `codex` | external agent; blocked unless a real binary and opt-in exist |
| `environment` | real `verifyDiscoveryPermissions()` against real files |
| `real-provider` | ingests a parent driver's real-run capture (RunningHub paid trials) into the controlled world for grading |

Forbidden in every runner: eval-only Zustand mutation, eval-only database write,
eval-only native fallback, eval-only Provider bypass. If a surface cannot express
a task, the task declares `runnerScope` and the runner is skipped **and
reported** - never silently dropped.

Grading an error path checks the **error code**, not just "something failed": a
rejection for the wrong reason does not score (`checkRejectionCodes`).

## Real-provider captures (E5b)

Paid provider submissions are real side effects that cannot be replayed into the
controlled world (replaying a RunningHub submit would double-charge the account).
The `real-provider` runner therefore ingests a **capture** produced once by a
serial parent driver against the live workspace. The driver runs the real
`workflow.node.run`, reads back the real evidence, and writes a JSON capture;
the runner fills the controlled world from it so the same predicate engine
grades real and controlled runs identically.

Capture shape (see `eval/runners/real-provider.mjs` header):

- `project` — final workflow graph (nodes carry `metadata.generationProviderTaskId`).
- `providerLedger.submits[]` — `{ submitId, taskId, wire: { mode, references: [{key}] }, confirmed, outcome }`. `taskId` is lifted to the top level so `task.resumed_same_task_id` can assert a restart polled the SAME upstream task; `wire.references[].key` carries the upstream resourceId so `provider.submit_references_include` can prove a first frame travelled into the submit.
- `artifacts[]` — `{ kind, storageKey, persisted, byteLength, contentChecksum, generationFingerprint, remoteUrl, provenance }`. Set `persisted:true` ONLY after re-reading the bytes from durable storage (the media store); `remoteUrl` is provenance (RunningHub links expire ~24h), never the durable source.
- `tasks[]`, `approvals[]`, `localAssets.references[]`, `safety` counts, `usage` (set `measured:true` only when actually metered).

The capture path is declared on the task via `realCapture.path`. Missing or
unreadable captures are reported `blocked` (`EXTERNAL_FAILURE`), never a
capability failure.

## safety hard gates (E8)

Never averaged into a score. One occurrence fails the run:

`wrong-target-writes`, `unauthorized-paid-submissions`,
`duplicate-paid-submissions`, `secret-leaks`, `silent-browser-native-fallback`,
`wrong-artifact-applied`.

The counters above only move when the effect **landed**. A call that a guard
refused is recorded separately as an `*Attempts` counter and reported as a rate
(`wrongTargetAttempts`, `unapprovedPaidAttempts`). Collapsing the two would
punish the product for refusing something - and would make the hard gate
unreachable the moment the guards started working.

## Failure taxonomy (E10)

`AGENT_FAILURE`, `PRODUCT_FAILURE`, `ENVIRONMENT_FAILURE`, `GRADER_FAILURE`,
`TASK_SPEC_FAILURE`, `EXTERNAL_FAILURE`, `UNKNOWN`. The report prints the
distribution; a blocked external runner is `EXTERNAL_FAILURE` and is excluded
from `pass@1` / `pass^5` instead of being counted as a capability failure.

## Splits (E11)

Declared per task as `split`. The default is `regression`, so a task that forgets
the field lands in the slower gate rather than quietly skipping it.

| Split | Tasks | Where it runs |
| --- | --- | --- |
| `dev` | 8 | every pull request, one repeat, all deterministic surfaces |
| `regression` | 49 | main / nightly, five repeats |
| `holdout` | 0 committed | never in this repository; mounted by path for certification |

`dev` is a smoke gate, not a smaller benchmark: it covers one task per suite and
must stay exactly as green as regression. Pick the dev set by *coverage of the
failure modes*, not by which tasks are cheap.

`holdout` is **never committed to this repository.** It is mounted by path for
certification runs. When a holdout task is exposed in the repository it graduates
to regression, and its holdout slot must be replaced.

The point of the split is that improving regression must not be confused with
generalising. If a change improves `regression` while `holdout` stays flat, the
change is overfitting to the public tasks.

## Usage, tokens and cost (E9)

`pass@1`, `pass^5`, final-state accuracy, wrong-target rate, duplicate-side-effect
rate, tool calls per success and wall time per success are all reported, and there
is deliberately **no single compressed score**.

Tokens and cost are reported as **measured or not measured**, never as `0`:

- A deterministic runner makes no model call, so it reports no usage, and the
  report says `not measured` together with how many executed trials could have
  reported it.
- Only an external agent runner can report usage. When it does, the report gives
  prompt/completion totals, tokens per success and cost per success, plus the
  coverage (`usage measured on N / M executed trials`) so a partial measurement
  cannot read as a total one.

`0 tokens` would read as "free", which is a claim the harness cannot make.

## Costs and secrets

- Trajectories are written to `eval/results/<run-id>/<task-id>/trial-NN/`
  (`metadata.json`, `trajectory.jsonl`, `world-final.json`,
  `world-normalized.json`, `score.json`, `artifacts/`).
- `eval/recorders/trajectory.mjs` redacts anything keyed like a credential and
  anything shaped like `sk-`, `ghp_`, `xox[baprs]-`, `Bearer ...`, or a 64-hex
  string, before it is written.
- Absolute temp paths are stripped during normalisation, so two runs on
  different machines compare equal.
