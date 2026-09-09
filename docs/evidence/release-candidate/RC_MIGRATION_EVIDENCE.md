# Release Candidate Migration Evidence

## Workflow persistence migration

The current Workflow persistence envelope is versioned. Before a lower-version
state is normalized, the original envelope is written to a recoverable backup;
an invalid migration throws before replacing the source. Unknown plugin node
data is preserved, while invalid selections and broken connections are removed
from the normalized projection.

`tests/workflowMigration.test.ts` covers:

- legacy project normalization and unknown plugin preservation;
- missing optional collections and broken-edge filtering;
- a third resource-rich historical shape preserving Provider metadata,
  generation history, assets, artifact references and unknown plugin nodes;
- backup-before-failure and source preservation when backup fails;
- recovery of a truncated current envelope from the migration backup;
- store rehydration and current persistence-version writeback.

## Persistence soak

`tests/releaseCandidatePersistence.test.ts` covers:

- 30 persist/rehydrate restart cycles with a stable project hash;
- 100 revisioned mutations with one connection and 100 unique mutation receipts;
- exact state equality after rehydrate, including nodes, edges, revisions and
  change history.

The focused migration/persistence suite is the deterministic RC evidence for
the data layer. A corrupt/truncated current envelope now rehydrates from the
already-written backup instead of silently becoming an empty project list.
The packaged process-kill failure injection below now covers both the backup
write and the replacement-envelope write; the installed updater download
interruption and retry are recorded in `RC_UPDATER_EVIDENCE.md`. No production
data was touched during this RC run.

```text
npx vitest run tests/workflowMigration.test.ts tests/releaseCandidatePersistence.test.ts --reporter=dot
```

## Packaged update preservation

The real Windows installer updater was also exercised with a seeded disposable
profile. A test-signed `0.3.1` installation updated to `0.3.2` through the
local HTTPS feed, relaunched the replacement executable, and retained the
seeded project container (`rc-preserve-project`, title `RC 数据保留项目`; the
post-update WebView2 inspection reported `本地项目 1`). The exact installer
hashes and feed transcript are recorded in `RC_UPDATER_EVIDENCE.md`.

This run used the same persistence schema on both sides, so it proves
application-level preservation across an installed update but does not claim a
cross-schema migration. Production-equivalent signing and update certification
remain external release gates; packaged migration process-kill recovery is
covered below with a source-identical test build.

## Packaged cross-schema migration

A disposable test-only seeder NSIS package was built from an isolated worktree
with a Rust page-load hook. The hook wrote a resource-rich version-0 envelope
directly through IndexedDB, then the seeder was closed. The production candidate
NSIS package was installed and launched against the same disposable WebView2
`UserDataFolder`; after it exited, the seeder was launched again against that
same profile and read the store. Both packages used the installed WebView2
runtime `151.0.4129.107`.

The real report sequence was:

```text
seed: version=0, projectId=rc-webview2-legacy-project
production: installer exit=0, launch observed
read: version=1, projectId=rc-webview2-legacy-project
```

The read verified preservation of the project title, both node IDs and their
migrated widths (`320`), the connection ID `legacy-edge`, provider metadata,
generation history, and asset ID `legacy-asset`. This is a packaged,
cross-schema migration PASS through the production app's real WebView2 startup
path. The seeder hook and report server were test-only and were not copied into
the candidate source or runtime configuration.

The seeder hook and report server were test-only and were not copied into the
candidate source or runtime configuration. The seeder, report server,
disposable installers, profile, and test-created WebView2 policy were cleaned
up after the run.

## Packaged migration process-kill recovery

A source-identical instrumented NSIS package was launched with an isolated
WebView2 UserDataFolder and a CDP-only test hook. The hook synchronously
signalled a local test controller after the migration backup write, and again
after the replacement current-envelope write. The controller terminated the
exact Flovart process tree with taskkill /T /F, then relaunched the same
package and read the real IndexedDB store.

The report was:

    WebView2: 151.0.4129.107
    profile: C:\tmp\flovart-webview2-migration-20260902
    backup phase: process termination status=0
    backup restart: version=1, projectId=migration-crash-project, node=migration-crash-node
    current-envelope phase: process termination status=0
    current-envelope restart: version=1, projectId=migration-crash-project, node=migration-crash-node

Both interrupted writes therefore restarted without data loss and completed
the migration to version 1. This is a real packaged WebView2 failure-injection
pass using a source-identical test build; it does not certify production
Authenticode, production updater signing, or a clean-machine migration under a
production release key.
