# FlovartBench Report

- Run id: `2026-09-15_03-37-45-oracle`
- Generated: 2026-09-15T03:39:05.794Z
- Commit: `9a1534b035350152c87d93a5f6e07f7452f3f66f`

## Environment
- Node v22.22.2 / win32 x64
- CI: no (local)
- Fingerprint: `320bb1f377ba810d`

## Tasks & Trials
- Tasks executed: 59 / 59
- Trials: 350 (successful 275, blocked 5)
- Repeat per task: 5

## Dataset
| Suite | Tasks | Trials | pass@1 |
| --- | --- | --- | --- |
| workflow | 12 | 72 | 83.3% |
| references | 10 | 59 | 76.3% |
| provider | 10 | 60 | 83.3% |
| production-task | 10 | 58 | 69.0% |
| agent | 6 | 36 | 83.3% |
| local-assets | 6 | 36 | 83.3% |
| environment | 5 | 29 | 69.0% |

- Split coverage in this run: dev: 8 task(s), regression: 51 task(s)
- Holdout is not committed to this repository and was not part of this run, so these numbers say nothing about generalisation.

## Grading
- Predicate grading: always on (345 trial(s))
- Tasks with a frozen canonical hash: 51 (306 trial(s) also graded on whole-world equality)
- Holdout tasks are not committed to this repository and are not graded here.

## Oracle QA
- Tasks checked: 59
- Oracle 5/5 stable: 55 / 59
- NOP correctly failed: 55 / 55
- Admission: PASS

## Deterministic Baseline
- pass@1: 79.7% (275/350)
- pass^5: 0.0% (0/59)
- Final-state accuracy (mean predicate pass rate): 87.3%
- Blocked trials: 5

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
| wrongTargetAttempts | 5 |
| unapprovedPaidAttempts | 10 |

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
- Tool calls per success: 1.25
- Wall time per success: 57.9 ms
- Tokens / cost: not measured - none of the 345 executed trial(s) reported usage. Only an external agent runner can report tokens; a deterministic runner makes no model call.

## Failure Analysis
| Class | Count |
| --- | --- |
| AGENT_FAILURE | 43 |
| PRODUCT_FAILURE | 5 |
| ENVIRONMENT_FAILURE | 0 |
| GRADER_FAILURE | 0 |
| TASK_SPEC_FAILURE | 22 |
| EXTERNAL_FAILURE | 0 |
| UNKNOWN | 0 |

Failing tasks:
- workflow-add-001 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-add-connect-002 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-move-003 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-delete-004 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-stale-revision-005 (workflow): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- workflow-idempotent-replay-006 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-wrong-project-007 (workflow): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- workflow-batch-mutation-008 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-update-title-009 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-disconnect-010 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-connect-role-011 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- workflow-duplicate-connect-012 (workflow): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-first-frame-001 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-graph-002 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-dedupe-003 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-i2v-wire-004 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-i2i-wire-005 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-missing-006 (references): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- references-order-007 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-run-idempotent-008 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- references-unsupported-capability-009 (references): 5 failing trial(s) {"TASK_SPEC_FAILURE":5}
- references-provenance-010 (references): 1 failing trial(s) {"AGENT_FAILURE":1}
- provider-confirmation-required-001 (provider): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- provider-confirmed-bypass-002 (provider): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- provider-approved-run-003 (provider): 1 failing trial(s) {"AGENT_FAILURE":1}
- provider-duplicate-submit-004 (provider): 1 failing trial(s) {"AGENT_FAILURE":1}
- provider-unauthorized-005 (provider): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- provider-rate-limited-006 (provider): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- provider-timeout-007 (provider): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- provider-submit-unknown-008 (provider): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- provider-distinct-content-009 (provider): 1 failing trial(s) {"AGENT_FAILURE":1}
- provider-identical-bytes-distinct-requests-010 (provider): 1 failing trial(s) {"AGENT_FAILURE":1}
- production-run-completes-001 (production-task): 1 failing trial(s) {"AGENT_FAILURE":1}
- production-resume-completed-002 (production-task): 5 failing trial(s) {"PRODUCT_FAILURE":5}
- production-inspect-003 (production-task): 1 failing trial(s) {"AGENT_FAILURE":1}
- production-unknown-task-004 (production-task): 5 failing trial(s) {"TASK_SPEC_FAILURE":5}
- production-artifact-persistence-005 (production-task): 1 failing trial(s) {"AGENT_FAILURE":1}
- production-replay-no-resubmit-006 (production-task): 1 failing trial(s) {"AGENT_FAILURE":1}
- production-idempotency-conflict-007 (production-task): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- production-wrong-node-008 (production-task): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- production-retry-same-key-009 (production-task): 1 failing trial(s) {"AGENT_FAILURE":1}
- production-retry-fresh-key-010 (production-task): 1 failing trial(s) {"AGENT_FAILURE":1}
- agent-projection-add-001 (agent): 1 failing trial(s) {"AGENT_FAILURE":1}
- agent-projection-connect-002 (agent): 1 failing trial(s) {"AGENT_FAILURE":1}
- agent-projection-batch-003 (agent): 1 failing trial(s) {"AGENT_FAILURE":1}
- agent-projection-inspect-004 (agent): 1 failing trial(s) {"AGENT_FAILURE":1}
- agent-projection-run-005 (agent): 1 failing trial(s) {"AGENT_FAILURE":1}
- agent-projection-selection-006 (agent): 1 failing trial(s) {"AGENT_FAILURE":1}
- local-folder-reference-001 (local-assets): 1 failing trial(s) {"AGENT_FAILURE":1}
- local-folder-chinese-path-002 (local-assets): 1 failing trial(s) {"AGENT_FAILURE":1}
- local-folder-nested-003 (local-assets): 1 failing trial(s) {"AGENT_FAILURE":1}
- local-selected-only-004 (local-assets): 1 failing trial(s) {"AGENT_FAILURE":1}
- local-grant-missing-005 (local-assets): 1 failing trial(s) {"TASK_SPEC_FAILURE":1}
- local-managed-copy-distinct-006 (local-assets): 1 failing trial(s) {"AGENT_FAILURE":1}
- environment-discovery-strict-acl-001 (environment): 1 failing trial(s) {"AGENT_FAILURE":1}
- environment-discovery-inherited-ace-002 (environment): 1 failing trial(s) {"AGENT_FAILURE":1}
- environment-discovery-administrators-003 (environment): 1 failing trial(s) {"AGENT_FAILURE":1}
- environment-discovery-everyone-004 (environment): 1 failing trial(s) {"AGENT_FAILURE":1}
- environment-discovery-posix-mode-005 (environment): 5 failing trial(s) {"UNKNOWN":5}

## Product Bugs (suspected)
- `production-resume-completed-002` [production-task/oracle trial 1]
- `production-resume-completed-002` [production-task/oracle trial 2]
- `production-resume-completed-002` [production-task/oracle trial 3]
- `production-resume-completed-002` [production-task/oracle trial 4]
- `production-resume-completed-002` [production-task/oracle trial 5]

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
