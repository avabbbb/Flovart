# FlovartBench Report

- Run id: `2026-09-15_02-03-30-core`
- Generated: 2026-09-15T02:03:58.292Z
- Commit: `9a1534b035350152c87d93a5f6e07f7452f3f66f`

## Environment
- Node v22.22.2 / win32 x64
- CI: no (local)
- Fingerprint: `320bb1f377ba810d`

## Tasks & Trials
- Tasks executed: 43 / 43
- Trials: 615 (successful 615, blocked 0)
- Repeat per task: 5

## Dataset
| Suite | Tasks | Trials | pass@1 |
| --- | --- | --- | --- |
| workflow | 12 | 180 | 100.0% |
| references | 9 | 135 | 100.0% |
| provider | 8 | 90 | 100.0% |
| production-task | 8 | 120 | 100.0% |
| local-assets | 6 | 90 | 100.0% |

- Split coverage in this run: dev: 6 task(s), regression: 37 task(s)
- Holdout is not committed to this repository and was not part of this run, so these numbers say nothing about generalisation.

## Grading
- Predicate grading: always on (615 trial(s))
- Tasks with a frozen canonical hash: 43 (615 trial(s) also graded on whole-world equality)
- Holdout tasks are not committed to this repository and are not graded here.

## Oracle QA
- Tasks checked: 57
- Oracle 5/5 stable: 53 / 57
- NOP correctly failed: 53 / 53
- Admission: PASS

## Deterministic Baseline
- pass@1: 100.0% (615/615)
- pass^5: 100.0% (43/43)
- Final-state accuracy (mean predicate pass rate): 100.0%
- Blocked trials: 0

## Safety
- Hard gate: PASS

| Counter | Value |
| --- | --- |
| wrongTargetWrites | 0 |
| duplicateSubmits | 0 |
| unapprovedPaidActions | 0 |
| secretExposure | 0 |
| silentFallbacks | 0 |
| wrongArtifactApplied | 0 |
| wrongTargetAttempts | 15 |
| unapprovedPaidAttempts | 20 |

## Agent Baseline
- pass@1: 100.0%
- pass^5: 100.0%
- Certified external agent runs: 0 / 120
- Stand-in (non-certified) trials: 30 - these do not count as agent results.
- Agent-run failures: EXTERNAL_FAILURE=30

## Environment Transfer
- pass@1: 100.0% (20/20 executed)
- pass^5: 100.0% (4/4)
- Excluded as not applicable on this platform: 5 trial(s)

## Efficiency
- Tool calls per success: 1.22
- Wall time per success: 1.0 ms
- Tokens / cost: not measured - none of the 615 executed trial(s) reported usage. Only an external agent runner can report tokens; a deterministic runner makes no model call.

## Failure Analysis
| Class | Count |
| --- | --- |
| AGENT_FAILURE | 0 |
| PRODUCT_FAILURE | 0 |
| ENVIRONMENT_FAILURE | 0 |
| GRADER_FAILURE | 0 |
| TASK_SPEC_FAILURE | 0 |
| EXTERNAL_FAILURE | 0 |
| UNKNOWN | 0 |

## Product Bugs (suspected)
- None detected in this run.

## Hosted CI
- Not recorded in this run.

## Remaining External Gates
- real Codex agent run: not-run - requires FLOVARTBENCH_ALLOW_CODEX=true and a codex binary
- real paid Provider submission: not-run - requires funded provider credentials
- host installer / auto-update: not-run - requires a signed build
- real account login: not-run - requires hosted account credentials

## Reproduce
```bash
npm run eval:validate
npm run eval:oracle
npm run eval:core
npm run eval:agent
npm run eval:report
```
