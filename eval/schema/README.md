# FlovartBench data model (E1)

The normative shape of every record is the module that produces it. The JSON
Schema in this directory is the reviewable contract for on-disk files; the
loader is the executable validator.

| Type | Produced by | Field of record |
| --- | --- | --- |
| `EvalTask` | `eval/tasks/<suite>/*.json` | `id`, `version`, `suite`, `instruction`, `fixture`, `expected`, `solution`, `runnerScope?`, `platforms?`, `knownGap?`, `timeout`, `split` |
| `EvalEnvironment` | `eval/environment/controlled-world.mjs` `createControlledWorld()` | the controlled world: project, revision, tasks, leases, provider ledger, artifacts, grants, safety counters, confirmations |
| `AgentIdentity` | `eval/recorders/trajectory.mjs` metadata | `runner`, plus `agentIdentity`/`hostSessionId` when a caller supplies them |
| `EvalTrial` | `eval/lib/engine.mjs` `runTrial()` | one execution of one task by one runner at one index |
| `TrajectoryEvent` | `eval/recorders/trajectory.mjs` | `trajectory.jsonl` lines: `tool_call`, `tool_result`, `approval`, `provider_event`, `error`, `note`, `final` |
| `WorldSnapshot` | `eval/environment/snapshot.mjs` `captureWorldSnapshot()` | `world-final.json`: workflow, runtime, artifacts, providerLedger, localAssets, safety, runtimeDiscovery |
| `NormalizedWorldSnapshot` | `eval/environment/snapshot.mjs` `normalizeWorldSnapshot()` | `world-normalized.json`: same shape, ids canonicalised, volatile fields dropped |
| `GraderResult` | `eval/graders/predicates.mjs` `evaluatePredicates()` | `{ passed: string[], failed: Array<{name, expected, reason}> }` |
| `SuiteResult` | `eval/lib/engine.mjs` `aggregate()` | `perSuite[suite]`, `dataset[]` in the report |
| `BenchmarkResult` | `eval/lib/report.mjs` `buildReport()` | `report.json` |
| `FailureClassification` | `eval/lib/engine.mjs` `FAILURE_CLASSES` | `failureClass` on each score |

## Invariants the schema encodes

- A task never contains a **mandatory reference trajectory**. `solution.steps`
  is a reference solution used to derive and validate the target final state; the
  grader never reads it back.
- `expected.predicates` must be non-empty, and every predicate name must exist in
  the registry. `expected.rejectionCodes` asserts **which** error was returned,
  so a rejection for the wrong reason does not score.
- Write steps (`workflow.apply`, `workflow.node.run`) carry an idempotency key, or
  declare `allowFailure` because the task is about being refused.
- `workflow.apply` uses the canonical `operations` + `mutationId` arguments, so
  the same step is expressible on CLI and MCP. A step that needs an argument no
  Agent surface exposes forces `runnerScope` instead of an eval-only shortcut.
- `knownGap` is an admission-time exclusion, never a pass.
