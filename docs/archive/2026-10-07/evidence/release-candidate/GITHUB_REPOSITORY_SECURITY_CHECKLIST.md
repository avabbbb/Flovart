# GitHub Repository Security Checklist

This checklist separates repository settings from source-controlled workflow
configuration. A green local workflow file is not proof that the corresponding
GitHub setting is enabled.

## Read-only audit observed for `avabbbb/Flovart`

Snapshot date: 2026-09-02. The repository API reported the repository as
public with admin viewer permission; no setting was changed by this pass.
The remote `main` observed at snapshot time was
`c60b452719fc3b0ddd32225556fbd86b73b5f299` (`chore: daily traffic snapshot`),
while the reviewed candidate remains local and unpublished. The public
release remains `v0.2.0-test`.
The `security_and_analysis` response reported Dependabot security updates,
Secret Scanning, non-provider secret patterns, push protection, and validity
checks as `disabled`. Rulesets was an empty list, Actions were enabled with
`allowed_actions: all`, and the main branch protection endpoint reported the
branch as unprotected.

| Setting | Observed state | Status |
| --- | --- | --- |
| Repository visibility | Public | Observed |
| Automated security fixes | `enabled: false` | External owner action required |
| Dependabot vulnerability alerts | API reported disabled | External owner action required |
| Code scanning default setup | `not-configured` | External owner action required or confirm advanced workflow coverage |
| Existing CodeQL alerts | Read-only API audit on 2026-09-02 reported 13 open alerts on remote SHA `c60b452719fc3b0ddd32225556fbd86b73b5f299`: 1 critical SSRF, 9 high and 3 medium. Final local application candidate `712031d88a427fb04316e590f74cffef67f435b9` fixes the observed sites locally, but has not had a Hosted scan; see `RC_CODEQL_TRIAGE.md` | P0/P1 external security gate: run Hosted CodeQL on the exact candidate and triage the critical DSH proxy finding |
| Actions enabled | `true`, allowed actions `all` | Review and restrict for production policy |
| SHA pinning | `false` | Security policy decision required |
| `main` branch protection | API reported branch not protected | External owner action required |
| Repository rulesets | empty | External owner action required if rulesets are desired |
| Secret scanning / push protection | Secret-scanning API reported scanning disabled | External owner action required |
| Hosted workflow run for this candidate | Candidate `712031d88a427fb04316e590f74cffef67f435b9` is not on remote `main` | External gate |
| Hosted CI probe on remote `main` | Run `33598287044` at `c60b452719fc3b0ddd32225556fbd86b73b5f299` failed at the older remote Docs contract; its Critical suite 10x job passed | Does not certify the local candidate; publish candidate and rerun |
| Hosted Security probe on remote `main` | Run `33598299717` at the same SHA passed secret audit and both CodeQL jobs; dependency review was skipped for manual dispatch | Environment evidence only; candidate rerun required |

No repository setting was changed by this pass. The existing API responses are
evidence for review only; a missing or permission-limited endpoint is not
converted into a stronger claim than the response supports.

## Source-controlled controls

- `.github/workflows/security.yml` runs the tracked secret audit, CodeQL for
  JavaScript/TypeScript and Rust, and high-severity dependency review on pull
  requests.
- `.github/workflows/ci.yml` runs docs, release invariants, secret audit,
  typecheck, tests, builds, Rust tests, and the repeated critical suite.
- `.github/workflows/build-desktop.yml` runs a tag release gate, calls the
  hosted security workflow, creates a draft first, emits checksums/SBOM, and
  only finalizes after the build matrix succeeds.
- Manual `workflow_dispatch` release finalization defaults to
  `publish=false`.

## Owner confirmation before production launch

- [ ] Enable Dependabot alerts and automated security fixes where acceptable.
- [ ] Enable secret scanning and push protection.
- [ ] Enable/confirm CodeQL or the advanced CodeQL workflow on the default branch.
- [ ] Restrict Actions permissions to the minimum required and review third-party actions.
- [ ] Decide whether SHA pinning is required and document exceptions.
- [ ] Protect `main` with required checks, review requirements, and no accidental direct release bypass.
- [ ] Protect the release environment and production signing secrets.
- [ ] Run the security workflow and the candidate desktop workflow on the final pushed SHA.
- [ ] Confirm the hosted run produced the expected attestation/SBOM evidence.
