# Iris Evaluation Report

- Run id: `2026-10-19_05-20-31-core`
- Generated: 2026-10-19T05:22:01.745Z
- Commit: `35fa2656d9b9be23649acab1fe19f7fffe9680bb` (working tree dirty)

## Environment
- Node v24.18.0 / win32 x64
- CI: yes (runner)
- Fingerprint: `35b28561cdab48b3`

## Tasks & Trials
- Tasks executed: 45 / 45
- Trials: 645 (successful 645, blocked 0)
- Repeat per task: 5
- Excluded known gaps: references-unsupported-capability-009, production-resume-completed-002, production-unknown-task-004
- Surface-scoped exclusions: 6 task/runner pairs
  - provider-confirmed-bypass-002 / cli: the canonical Agent surface has no confirmed argument, so this scenario is only reachable through the internal workspace seam
  - provider-approved-run-003 / cli: the canonical Agent surface has no approvalId argument, so this scenario is only reachable through the internal workspace seam
  - provider-duplicate-submit-004 / cli: the canonical Agent surface has no approvalId argument, so this scenario is only reachable through the internal workspace seam
  - provider-confirmed-bypass-002 / mcp: the canonical Agent surface has no confirmed argument, so this scenario is only reachable through the internal workspace seam
  - provider-approved-run-003 / mcp: the canonical Agent surface has no approvalId argument, so this scenario is only reachable through the internal workspace seam
  - provider-duplicate-submit-004 / mcp: the canonical Agent surface has no approvalId argument, so this scenario is only reachable through the internal workspace seam

## Dataset
| Suite | Tasks | Trials | pass@1 |
| --- | --- | --- | --- |
| workflow | 12 | 180 | 100.0% |
| references | 9 | 135 | 100.0% |
| provider | 10 | 120 | 100.0% |
| production-task | 8 | 120 | 100.0% |
| local-assets | 6 | 90 | 100.0% |

- Split coverage in this run: dev: 6 task(s), regression: 39 task(s)
- Holdout is not committed to this repository and was not part of this run, so these numbers say nothing about generalisation.

## Grading
- Predicate grading: always on (645 trial(s))
- Tasks with a frozen canonical hash: 45 (645 trial(s) also graded on whole-world equality)
- Holdout tasks are not committed to this repository and are not graded here.

## Oracle QA
- QA source run: 2026-10-13_17-15-40-oracle
- Tasks checked: 48
- Oracle 5/5 stable: 45 / 48
- NOP correctly failed: 45 / 45
- Admission: PASS
- Known gap (excluded): references-unsupported-capability-009, 0/5 oracle, TASK_SPEC_FAILURE
- Known gap (excluded): production-resume-completed-002, 0/5 oracle, PRODUCT_FAILURE
- Known gap (excluded): production-unknown-task-004, 0/5 oracle, TASK_SPEC_FAILURE

## Deterministic Baseline
- pass@1: 100.0% (645/645 executed)
- pass^5: 100.0% (129/129 complete task/runner groups)
- Five-trial coverage: 129/129 groups; 0 incomplete
- Final-state accuracy (mean predicate pass rate): 100.0%
- Blocked trials: 0

## Safety
- Hard gate: PASS

| Counter | Value |
| --- | --- |
| 0 | < |
| 1 | c |
| 2 | i |
| 3 | r |
| 4 | c |
| 5 | u |
| 6 | l |
| 7 | a |
| 8 | r |
| 9 | > |

## Agent Baseline
- Reference source run: 2026-09-17_06-54-13-agent (2026-09-17T06:54:13.089Z)
- Separate-run reference; not a measurement of the current run or checkout.
- pass@1: 0.0%
- pass^5: n/a (legacy aggregate; complete five-trial coverage was not recorded)
- External runner trials executed: 1 / 1
- Transcript replay alone does not certify the live Browser final state.
- Agent-run failures: PRODUCT_FAILURE=1

## Environment Transfer
- Reference source run: 2026-09-15_02-03-12-environment (2026-09-15T02:03:12.099Z)
- Separate-run reference; not a measurement of the current run or checkout.
- pass@1: 100.0% (20/20 executed)
- pass^5: n/a (legacy aggregate; complete five-trial coverage was not recorded)
- Excluded as not applicable on this platform: 5 trial(s)

## Efficiency
- Tool calls per success: n/a
- Wall time per success: n/a ms
- Tokens / cost: not measured - none of the 0 executed trial(s) reported usage. Only an external agent runner can report tokens; a deterministic runner makes no model call.

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
