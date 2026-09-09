# Release Security Automation Evidence

## Local checks

The final local source/security recheck is bound to application/package source
commit `712031d88a427fb04316e590f74cffef67f435b9`.

The release candidate now exposes:

```text
npm run release:secret-audit
```

The audit reads Git-tracked and non-ignored untracked files, skips binary files
and oversized artifacts, detects high-confidence
private-key/access-token/literal-bearer/API-key patterns, and redacts matched
previews. The final candidate working tree result is:

```text
  scanned: 927
findings: 0
exit: 0
```

The clean dependency graph also passes the release dependency gate:

```text
npm audit --registry=https://registry.npmjs.org --audit-level=high
found 0 vulnerabilities
```

The runtime-only form (`--omit=dev`) also returns zero vulnerabilities. The
root dependency cleanup and exact resolved versions are recorded in
`RC_DEPENDENCY_AUDIT.md`.

`npm run release:red-team` also verifies the stable five-command Agent surface,
Skill projection parity, CLI `--help`, signing-key tracking rules and release
artifact markers, including the tag-only updater feed/sidecar verification
steps.

## Hosted workflow

`.github/workflows/security.yml` provides:

- tracked secret audit on pushes, pull requests, scheduled runs and manual runs;
- full npm dependency audit against the official registry after clean install;
- CodeQL for JavaScript/TypeScript and Rust;
- high-severity dependency review on pull requests.

`.github/workflows/ci.yml` and the tag release gate run the local secret audit as
part of their required checks.

The tag path also calls the reusable security workflow before the desktop build;
the retired manual release workflow contains no publishing action. Desktop
artifacts stay in a draft until the complete build matrix and final integrity
steps succeed.

## Boundary

The repository workflow does not itself enable GitHub secret scanning, push
protection, branch rules, production signing-key custody or hosted workflow
approval. Those are repository-owner/release-operations gates and remain
explicitly pending until their settings and run evidence are available.

## Read-only Hosted CodeQL status

The public repository API was queried on 2026-09-02. It reported 13 open CodeQL
alerts, all last observed on remote `main` SHA
`c60b452719fc3b0ddd32225556fbd86b73b5f299`: 1 critical, 9 high and 3 medium.
The candidate is detached and unpushed, so it has no Hosted CodeQL result. The
candidate source has already corrected several old alert sites and bounds the
research artifact-key sanitizer; that local diff is not a CodeQL closure.

The critical alert is `js/request-forgery` in the experimental DSH loopback
proxy. The candidate now accepts only an explicit-port `http://127.0.0.1`
origin and rebuilds the outbound URL from that fixed loopback literal; its
route allowlist and host-side token boundary are covered by local tests. This
remains an explicit security gate until the exact candidate gets a Hosted scan
and the finding is either fixed or formally reviewed.

See `RC_CODEQL_TRIAGE.md` for the complete alert-to-candidate disposition.
Therefore the local security result is `PASS`, while Hosted security remains
`PENDING / EXTERNAL`; this document does not claim a clean CodeQL release.

## Post-candidate secret recheck

After adding the CLI package-manifest regression test and its evidence, the
tracked/non-ignored source audit scanned `921` files and returned `0` findings.
The new CLI tarball smoke did not expose a credential and the test prefix was
disposable; production signing material and external Provider credentials were
not used.
## Exact clean candidate security boundary

The clean candidate d22406102260715e8a3c229b1eb84e48a913ef81 includes the CLI
package-manifest guard and isolated CLI smoke. The post-fix local secret audit
returned 921 files and 0 findings. Hosted CodeQL, repository security settings
and production signing remain external.

## Final exact candidate security boundary

The final clean candidate is `d539a9979cb7230f95783e3144d21ea9b6ac7685`.
Its local secret audit scanned 921 files and found 0 issues, while local
dependency, red-team and artifact checks passed. No production signing key or
Provider credential was used. The candidate is unpushed, so Hosted CodeQL,
repository security settings and hosted secret-scanning evidence remain
external and are not claimed as passed.

The desktop workflow now has an explicit stable-tag preflight that exits before
the Tauri action when `TAURI_SIGNING_PRIVATE_KEY` is absent. The manual/local
dry-run continues to use the unsigned local Tauri config. `release:red-team`
asserts the fail-closed marker so a future workflow edit cannot silently make
stable updater artifacts unsigned.

## Final candidate with signer preflight

The signer-preflight candidate is
`71f8395e071e237d6fb83c03e340d55d795b3df0`. Its local secret, dependency,
red-team and YAML checks pass. It is not on the remote repository, so Hosted
CodeQL, repository security settings and hosted secret-scanning evidence remain
unverified external gates.

## Current-worktree dependency registry correction

The nested DSH dependency audit was rerun with
`--registry=https://registry.npmjs.org --audit-level=moderate` and returned
`found 0 vulnerabilities`. The reusable Security workflow now uses the same
explicit registry; an earlier implicit-registry probe hit a local mirror's HTTP
405 response and was treated as an environment/configuration failure, not a
security pass or vulnerability finding.
