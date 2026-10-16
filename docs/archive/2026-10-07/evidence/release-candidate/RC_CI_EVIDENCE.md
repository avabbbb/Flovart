# Release Candidate CI Evidence

## Current exact application/package source local gate (2026-09-02)

| Gate | Result |
| --- | --- |
| Candidate application/package source | `712031d88a427fb04316e590f74cffef67f435b9`, clean detached source worktree |
| Vitest | `154` files; `1,035` passed, `1` skipped (`1,036` total) |
| TypeScript | `npx tsc --noEmit` passed |
| Web build | `npm run build` passed; 4,306 modules transformed |
| Browser extension build | passed |
| DSH build and client loader contract | passed |
| Rust | `cargo test --manifest-path src-tauri/Cargo.toml --all-targets -j 1` passed; 41 tests (after Windows linker PDB-limit retry with `RUSTFLAGS=-C debuginfo=0`) |
| Root npm audit | full and `--omit=dev`: `0 vulnerabilities` |
| DSH npm audit | `0 vulnerabilities` at moderate severity |
| Docs/version/red-team/secret checks | candidate source passed with 137 docs; current working tree recheck passed with 138 docs; secret audit 927 files / 0 findings |
| Critical suite | `FLOVART_CRITICAL_REPEATS=10`: `10/10` |
| Diff hygiene | `git diff --check` passed |
| NSIS lifecycle | current clean-candidate package install, launch, graceful close, uninstall passed |

The same candidate also passed the focused updater-feed/sidecar verifier
(`4/4` tests) and the isolated valid test-signed feed check. The verifier is a
release-metadata integrity gate; it does not replace cryptographic updater
signature verification or production signing certification.

The exact local package is recorded in `RC_VERSION_TRUTH.md` and
`RC_INSTALLER_EVIDENCE.md`. The package is bound to the application source
commit above; no Hosted run exists for this detached source.

## Current v3 clean-candidate certification

The current clean detached source candidate is
`712031d88a427fb04316e590f74cffef67f435b9`. It was installed with fresh root
and nested DSH dependencies and passed:

```text
Vitest: 154 files, 1035 passed, 1 skipped
TypeScript: pass
Web build: pass, 4306 modules transformed
Browser extension: pass
DSH build/client-loader contract: pass
Rust all-target tests: 41 passed after cargo clean, -j 1, RUSTFLAGS=-C debuginfo=0
Critical suite: 10/10, 50 tests per repetition
Version/docs/red-team/secret checks: pass (docs 137 files; secret 927/0)
Root and dsh-plugin npm audit: 0 vulnerabilities
git diff --check: pass
```

The exact v3 NSIS package is `Flovart_0.3.2_x64-setup.exe`, `12,247,434`
bytes, SHA-256
`67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.
The SPDX-2.3 SBOM contains `663` packages and `1,377` relationships.
Artifact validation and isolated install/launch/graceful-close/uninstall
passed. The local build used `tauri.local.conf.json`, so the updater checker
correctly reports the expected absence of `latest.json`; test-signed updater
feed evidence is recorded separately and production signing remains external.

## Post-help-surface source recheck

The final parallel Vitest run completed with no failed files:

```text
Test Files  151 passed (151)
Tests       1024 passed | 1 skipped (1025)
Duration    56.52s
```

The source-only change labels retired provider/batch commands in conventional
CLI help; it does not alter Workflow, Provider, Browser or desktop packaging
authority. The focused provider-routing regression passed `6/6`, and the
critical suite passed `10/10` after this source commit.

The earlier v10 installed-package CDP probe is intentionally not promoted to a
generation PASS: the real app launched and logged Runtime readiness, and a
fixed-port process observation confirmed its isolated WebView2 child, but no
debug listener or `/json/version` endpoint opened within the bounded window.
Therefore no installed-package UI or Provider request was asserted. The
lifecycle installer smoke remains green.

## Final candidate quality rerun

After the historical v10 package was rebuilt from application/package source
commit `e7b8280014478e4fd3021f4f9a578b343bea11d2`, the final candidate source was
rechecked without changing application code:

- Full Vitest: `151` files passed; `1,024` tests passed and `1` skipped
  (`1,025` total; exit `0`).
- TypeScript, browser-extension build, DSH build/loader contract, and Rust
  `cargo test --all-targets` (`41` tests) passed.
- Critical suite: `10/10` (`50` tests per run) passed.
- Root high-severity npm audit and nested DSH moderate-severity audit both
  reported `0 vulnerabilities`.
- Version, docs (`135` files), red-team, secret (`920` files / `0` findings),
  artifact checker, and isolated v10 NSIS lifecycle gates passed.

This is local candidate evidence. It does not create Hosted CI, CodeQL,
provenance, production signing, real Provider, or real Codex evidence.

The installed first-user path was also exercised from a source-identical NSIS
package with an external test-only WebView2 CDP overlay. Home → 新建 Workflow →
first-run setup → editable Canvas → Fake Provider model discovery → one
product-language cost confirmation → one T2I artifact passed with zero page or
console errors. This test package is recorded separately in
`RC_PACKAGED_UI_EVIDENCE.md`; the exact no-debug historical v10 production
package keeps its `NOT_VERIFIED` UI observation boundary. The exact current
v12 package is bound to `71f8395e071e237d6fb83c03e340d55d795b3df0` and is
recorded at the start of this file.

## Local critical stability

The repository now exposes `npm run test:critical`, which runs the bounded
release-critical suite without shell-specific `npx` shims. It includes
migration, Browser/Agent session, bootstrap, Fake Provider resilience, Runtime
credential boundary, Skill package validation, and offline shell tests.

Observed clean-candidate run:

```text
FLOVART_CRITICAL_REPEATS=20 npm run test:critical
Critical suite green: 20/20 (about 68.8s)
9 test files and 50 tests passed on every repetition
```

An earlier first parallel attempt had one transient error classification in
the rate-limit case; the focused test was then `20/20`, the serial critical
suite was `10/10`, and the same default parallel runner was `20/20` with no
source change. The first failure remains recorded as an observation rather
than being hidden by a retry; no failure reproduced during the higher-count
follow-up.

The final candidate full gates also passed from the clean application/release
source, with the evidence snapshot anchored by `RC_VERSION_TRUTH.md`:

```text
Application/release source: ea0b78d26ddf00fdba590098a99c678c12db8efe
Evidence candidate: see RC_VERSION_TRUTH.md
Vitest: 151 files passed; 1021 passed, 1 skipped (1022 total)
TypeScript: npx tsc --noEmit passed
Web build: 4306 modules transformed, passed
Extension build: passed
DSH build: passed; client loader contract verified
Rust: cargo test --manifest-path src-tauri/Cargo.toml --all-targets passed
Diff check: git diff --check passed
```

The dependency security gate also passed after a clean install:

```text
npm ci --ignore-scripts --registry=https://registry.npmjs.org: passed
npm audit --registry=https://registry.npmjs.org --audit-level=high: 0 vulnerabilities
npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high: 0 vulnerabilities
```

## CI contract

`.github/workflows/ci.yml` runs docs contract, release red-team invariants,
tracked secret audit, typecheck, full Vitest, Web/extension/DSH builds, Rust
tests, and diff hygiene. Its separate `critical-stability` job runs the same
critical suite ten times.

The desktop workflow runs a tag-only release gate, calls the reusable hosted
security workflow, stages installers, emits SHA256 checksums, generates SPDX
JSON with Anchore Syft, and creates tag-only GitHub artifact attestations.
Artifacts remain a draft until the build matrix and integrity steps complete.
These hosted steps remain dependent on GitHub permissions and release secrets
and are not claimed as locally executed hosted attestations.

## Candidate hosted-run status

The candidate commit is detached and has not been pushed by this pass.
Therefore no GitHub-hosted run is evidence for this candidate. A hosted run of
the final pushed SHA is still required; this is an external repository action,
not a local test failure.

The source-controlled workflow now supports a safe manual dry-run: its
`workflow_dispatch` `publish` input defaults to `false`, so a successful build
remains a Draft until an explicit release approval sets it to `true`.

## Hosted environment probe (2026-09-02)

Two non-release workflows were dispatched against the remote `main` commit
`c60b452719fc3b0ddd32225556fbd86b73b5f299`. These runs validate the hosted
runner and remote workflow environment; they do not certify the unpublished
local candidate `3f9bee9306f44da3ea8be9c480ad4e5fc91acf65`.

| Run | Result | Evidence |
| --- | --- | --- |
| [CI 33598287044](https://github.com/avabbbb/Flovart/actions/runs/33598287044) | `FAIL` overall | The separate `Critical suite 10x` job passed, but the older remote `Docs contract` failed because its checker still required missing/stale `tools/flovart/skill/SKILL.md` and the five-command surface. |
| [Security 33598299717](https://github.com/avabbbb/Flovart/actions/runs/33598299717) | `PASS` | Tracked secret audit, CodeQL JavaScript/TypeScript and CodeQL Rust completed successfully; dependency review was skipped because the event was `workflow_dispatch`. |

The candidate fix was independently checked from a fresh detached checkout
with no generated Skill and no copied `node_modules`: `npm ci --ignore-scripts`
followed by `npm run docs:check` returned `Docs contract OK: 135 files
checked.` The generated projection is optional until packaging, so the Hosted
CI failure is a stale remote revision rather than a candidate pass.

The desktop workflow also runs scripts/check-release-artifacts.mjs after
staging installers and generating the platform SPDX document. The current
clean-candidate NSIS checksum and a local package-lock SPDX document both pass
the checker; the local SBOM contains 663 packages and 1,377 relationships.
The hosted Syft SBOM/provenance execution remains external because the reviewed
candidate has not been pushed.

## Post-candidate CLI distribution recheck

The full local recheck after closing an npm-package defect passed:

```text
Vitest: 152 files passed; 1,026 passed, 1 skipped (1,027 total)
TypeScript: npx tsc --noEmit passed
Web build: 4,306 modules transformed, passed
Extension build: passed
DSH build and client-loader contract: passed
Rust all-targets: 41 tests passed
Critical suite: 10/10 (50 tests per repetition)
Docs contract: 136 files checked
Version/red-team/diff checks: passed
Secret audit: 921 files, 0 findings
```

The separate `flovart-cli@0.3.2` tarball was installed into a disposable npm
prefix after the package allowlist was corrected. `flovart --help` and
`flovart status --json` both exited `0`; the package contained its executable,
reachable runtime modules, managed-agent and Skill projections. These checks
cover the CLI distribution surface and remain separate from the clean-source
Desktop NSIS artifact evidence above.

## Environment note

The current developer `node_modules` tree contains peer-version drift that
makes `npm sbom --package-lock-only` reject the installed tree because of
existing Radix/React peer declarations. The release workflow does not use that
command; it uses the pinned project scan action. A clean `npm ci` runner remains
the authoritative hosted check for dependency installation.

## Clean checkout contract probe

A separate detached worktree was created from the candidate without copied
`node_modules` or the ignored generated `tools/flovart/skill/` directory. After
`npm ci --ignore-scripts --registry=https://registry.npmjs.org`, the clean
checkout reported:

```text
Docs contract OK: 133 files checked.
generated-skill=absent-until-npm-pack
release-red-team: ok, failures=[]
```

This covers the Hosted CI failure seen on the older published SHA, where the
previous docs checker treated the ignored generated Skill as a required source
file. The corrected checker requires the three tracked Skill projections and
validates the generated copy only when packaging has produced it.

## Hosted failure reconciliation

Read-only inspection of the [published Build Desktop run](https://github.com/avabbbb/Flovart/actions/runs/33467223922)
for the older main SHA `9a1534b035350152c87d93a5f6e07f7452f3f66f1` found a
GitHub workflow validation error: the reusable security job requested
`pull-requests: read` but the caller granted `pull-requests: none`. The run
therefore ended in `startup_failure` before any build job started. The
candidate now grants `pull-requests: read` explicitly and the red-team check
asserts that permission. This fixes the observed workflow defect locally; the
candidate is not Hosted-certified until the exact candidate SHA is published
and rerun.

The published [CI run](https://github.com/avabbbb/Flovart/actions/runs/33467223765)
for the same older SHA also reported the previous dependency graph with
`32 vulnerabilities` and failed its docs contract because the tracked Skill
projection was stale/missing the current five-command surface. The clean
candidate refreshes the DSH dependency graph to zero audited vulnerabilities,
keeps the three tracked Skill projections aligned, and passes the local docs
contract. This is a local reconciliation only; the candidate still needs a
Hosted rerun.

The current `actions/attest@v4` contract also requires `artifact-metadata: write`
for the artifact attestation path. The candidate grants that permission at the
desktop workflow level and the red-team check asserts it; this still requires
one exact-candidate Hosted run for certification.

## Release workflow dry-run signing boundary

The production Tauri configuration was deliberately probed with signing
environment variables removed. It built the application payload and then
stopped at the expected updater-artifact boundary with:

```text
A public key has been found, but no private key. Make sure to set TAURI_SIGNING_PRIVATE_KEY environment variable.
```

The desktop workflow now selects `src-tauri/tauri.local.conf.json` for ordinary
push/manual dry runs and selects the production `src-tauri/tauri.conf.json`
only for a tag. The local dry-run rebuilt a real unsigned NSIS package and the
installer/artifact checks passed; tag builds still require the production
signing secret and updater artifact path. This preserves the production
signature gate instead of weakening it to make local CI green.

## Latest security-source recheck

The latest clean source candidate is
`1444453597e2cb9c7c5a3867f406e33391cd4a3a`. It replaces the unbounded
artifact-key regular expression in `tools/flovart/topic-research.js` with a
4096-character-bounded ASCII scan. The focused topic-research suite passed
`5/5`, including a 100,000-character hostile idempotency key. The source was
rebuilt into the current NSIS candidate and passed the artifact checker and
isolated installer lifecycle smoke:

```text
NSIS: Flovart_0.3.2_x64-setup.exe
bytes: 12247499
sha256: 2de7df820459f681521d99ebba4d6d4e18ace645e8df95821166e44d4f7ad26f
install: 0
launch: observed
close: graceful
uninstall: 0
```

The post-change full Vitest run passed `151` files with `1,023` tests passed and
`1` skipped (`1,024` total). TypeScript, Web build, Extension build, DSH build,
Rust `--all-targets`, and `FLOVART_CRITICAL_REPEATS=10 npm run test:critical`
(`10/10`, 9 files and 50 tests per repetition) also passed.

This is still local evidence. The exact candidate has no Hosted CodeQL result;
the 13-alert read-only snapshot and the critical DSH proxy disposition are
recorded in `RC_CODEQL_TRIAGE.md`.

## Prior source-fix recheck

The packaged WebView data-URL fix was verified from clean source commit
`ce0c235ef0bbfc0920600d75a37747cb733bad48`. The post-fix full suite passed
`151` files with `1,022` tests passed and `1` skipped; TypeScript, Web,
Extension, DSH, Rust and official-registry dependency checks also passed.
`FLOVART_CRITICAL_REPEATS=10 npm run test:critical` passed `10/10`, with
`9` files and `50` tests green in every repetition. Artifact, version, docs,
red-team, secret-audit and diff checks passed against the same clean candidate.

## DSH proxy and workflow permission hardening

The candidate then tightened the experimental DSH Workspace proxy so its
outbound target must be an explicit-port `http://127.0.0.1` URL. The proxy
rebuilds the target from that fixed loopback origin, copies only the
`director/status` query fields that the route owns, and keeps the Workspace
token host-side. The focused proxy suite passed `2/2`, including rejection of
localhost, IPv6, credentials, paths, invalid ports and query injection; the
DSH production build and client loader contract also passed.

The desktop workflow now grants only `contents: read` globally. Release
artifacts, attestations and finalization receive write permissions on their
specific jobs, and the red-team script parses the YAML to enforce that scope.
This reduces the token available to test/security jobs; it is still not a
Hosted CodeQL closure until the candidate is published and scanned.

The earlier detached candidate at this hardening stage was
`af1cae95faa171f4016c2bcf7c3381f007b05067`; it is superseded by the current
first-user-closure package recorded below.
Its rebuilt unsigned NSIS artifact is `Flovart_0.3.2_x64-setup.exe`,
`12,248,576` bytes, SHA-256
`063E89817C7F3900204409054B8CB089123CCA86C57CDDBB60142CC9FC1BDCB7`.
The artifact checker and isolated install/launch/graceful-close/uninstall
smoke passed against this exact package.

## Public documentation and first-user generation recheck

The public-documentation sweep now includes the root Chinese install guide,
both README variants and both Quick Start variants through Git-visible
discovery; the contract checker also validates documented installer and tag
versions against `VERSION`. The candidate docs gate reports `135 files`
checked with no retired public path or version-parity error.

The visible Chromium first-user smoke used a fresh browser context and the
local OpenAI-compatible Fake Provider over real HTTP. It opened `/#/app`,
dismissed optional onboarding, created an editable image workflow, connected
using only a service address and API Key, discovered three models, accepted
one product-language cost confirmation, and rendered the generated artifact
back on the Canvas. The sanitized recorder observed exactly one
`POST /v1/images/generations` for prompt `一只猫`, with zero references;
there were zero page errors and zero console errors. Evidence is in
`C:\tmp\flovart-c14-first-user-evidence.json` and the two screenshots named
there. This is local Fake Provider evidence and does not certify a real paid
Provider or a logged-in external Agent.

The same smoke exposed and fixed a real accessibility/copy defect: the
application translation helper resolved only top-level keys, so the compact
generation button exposed `promptBar.generate` instead of `生成`. The helper
now resolves nested translation paths; the browser smoke observes the
product-language button and confirmation without changing Provider or
Workflow authority.

## Candidate package after first-user closure

The application source commit is
`18b317348d0c32720b10b59c0f8e5450c239ce10`; the package was built from clean
evidence commit `e080a08387644d2fcc4a46a5e7dad5a9ce65273e`.
It produced `Flovart_0.3.2_x64-setup.exe`, `12,249,655` bytes, SHA-256
`827AF318C965542372B018C8D851F127C15CB80FC365182EACEC39B7ABE8D86D`.
The staged checksum/SPDX checker passed with zero errors, and the isolated
NSIS lifecycle smoke passed install `0`, real executable launch observed,
graceful close, uninstall `0`, and no remaining install directory. The
artifact is staged at
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v7`.

The application source change is intentionally small: `App.tsx` resolves
nested translation keys so the visible generation button has the product label
“生成”. The package was rebuilt after the browser smoke exposed the defect;
the package and browser evidence now share the clean source candidate above.

## Final clean-source package after dependency closure

The exact clean source commit
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee` passed the full local gate: 151
Vitest files (`1,023` passed, `1` skipped), TypeScript, Web build, extension
build, DSH build, Rust `--all-targets` (41 tests), root audits, nested DSH
audit, docs/version/red-team/secret checks, and critical stability `10/10`.

The release build from that clean source produced the Windows x64 NSIS package
`Flovart_0.3.2_x64-setup.exe`, `12,248,570` bytes, SHA-256
`2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`.
The staged checksum/SPDX checker passed with zero errors; the SPDX-2.3
document contains 663 packages and 1,377 relationships. Isolated silent
install, real executable launch, graceful close, uninstall and install-root
removal all passed. The machine-readable result is the v8 artifact under
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v8`.

The package is intentionally unsigned local RC evidence. Authenticode,
production updater signing, Hosted CI/CodeQL/provenance and public release
publication remain external gates.

## Final-source browser first-generation recheck

The visible Chromium first-user smoke was rerun against clean source commit
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee` with a fresh context and a real
localhost Fake Provider. It opened `/#/app`, left an unconfigured Canvas
editable, connected with service address plus API Key, discovered three
models, accepted one Chinese cost confirmation, rendered one image artifact,
and observed exactly one `POST /v1/images/generations`. The request had prompt
`一只猫`, zero references, and the recorder contained no API Key. Page errors
and console errors were both zero. Evidence was refreshed at
`C:\tmp\flovart-c14-first-user-evidence.json`; screenshots remain
`C:\tmp\flovart-c14-first-run.png` and
`C:\tmp\flovart-c14-first-generation.png`.

## Nested DSH dependency audit closure

The next clean-candidate install audited the separately locked DSH plugin graph
as well as the root graph. It exposed the development-only `esbuild` `0.21.x`
line in the DSH lockfile as a moderate advisory. The candidate now pins
`dsh-plugin` to `esbuild ^0.28.2`, and the DSH build plus
`npm audit --prefix dsh-plugin --audit-level=moderate` both pass with zero
vulnerabilities. The root CI and Security workflows now install and audit this
nested graph, so a future lockfile regression is visible in hosted gates.

This dependency-only closure is recorded in source commit
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`; the NSIS artifact must be rebuilt
from that exact clean source before it can replace the package evidence above.
## Exact clean candidate after CLI distribution closure

The clean candidate source d22406102260715e8a3c229b1eb84e48a913ef81 produced
the exact NSIS artifact recorded in RC_ARTIFACT_EVIDENCE.md. Artifact/SBOM
verification and the isolated install lifecycle passed. The same candidate
history contains the repaired flovart-cli@0.3.2 package and its manifest
regression; the installed help and structured offline status both exited 0.
No Hosted run is attached to this unpushed candidate.

## Final exact candidate recheck after warning cleanup

The clean candidate `d539a9979cb7230f95783e3144d21ea9b6ac7685` passed the full
Vitest suite: 152 files, 1,026 passed and 1 skipped (1,027 total). The same
candidate passed TypeScript (`tsc --noEmit`), Web production build (4,306
modules), Browser Extension build, DSH build and client-loader contract, and
Rust all-target tests (41 tests). The critical suite completed 10/10 with 9
files and 50 tests per repetition. Version, docs (136 files), release
red-team, secret audit (921 files / 0 findings), dependency audit, artifact
validation and `git diff --check` also passed.

The Vitest output still contains non-fatal jsdom/React `act(...)` and Ant
Design deprecation warnings in existing tests; no assertion failed and the
previous unawaited usage-monitor warning is fixed. These warnings are not
represented as a clean warning-free test run.

The exact candidate has no Hosted run attached. The NSIS package and CLI
package were independently rebuilt/installed from this clean candidate;
production signing, Hosted CodeQL/provenance, real Provider and authenticated
Codex certification remain external.

## Stable-tag signer preflight

The current desktop workflow has an explicit fail-closed preflight before the
Tauri action: a `v*` tag exits if `TAURI_SIGNING_PRIVATE_KEY` is empty, while
manual/local dry-runs retain the unsigned local Tauri configuration. The local
release red-team and YAML parser both pass this contract. This change is in the
current unpushed main worktree and has not yet been exercised by Hosted Actions.

## Final exact candidate with signer preflight

The clean candidate was advanced to
`71f8395e071e237d6fb83c03e340d55d795b3df0`, which includes the stable-tag
signing preflight. Its rebuilt NSIS artifact passed checksum/SBOM validation
and the isolated install lifecycle. The candidate's parent application source
was fully rechecked with 152 Vitest files (1,026 passed, 1 skipped) and
critical stability 10/10; the candidate itself passed version, docs, red-team,
secret, YAML and artifact gates. The workflow-only delta does not alter the
application bundle, but the final package was rebuilt from this exact SHA.

The candidate is still unpushed, so no Hosted CI, CodeQL or provenance run is
attached.

## Current working-tree regression after browser launcher guidance cleanup

This section is not a new clean candidate or Hosted certification. It records
the current dirty worktree recheck after the launcher/Skill documentation fix:

```text
full Vitest: 154 files, 1035 passed, 1 skipped
TypeScript: pass
Web build: pass, 4306 modules transformed
Browser extension: pass
DSH build/client-loader contract: pass
Rust all-target tests: 41 passed
critical suite: 10/10
docs contract: 136 files
version check: 0.3.2 / avabbbb/Flovart
release red-team: pass
secret audit: 925 files / 0 findings
root and dsh-plugin npm audit: 0 vulnerabilities
git diff --check: pass
```

The exact source-browser regression used Chrome for Testing with dynamic
loopback ports and observed plain-origin `clients=0 / hasWorkflow=false`, then
bootstrap-origin `clients=1 / hasWorkflow=true`, connected UI status and zero
console/page errors. A separate preferred-port collision test changed the
WebUI port automatically and left the unrelated listener untouched. No Edge
window was used by these tests.

## Current detached clean-candidate recheck after browser guidance cleanup

The current visible worktree was snapshotted without `node_modules`, build
outputs, or ignored signing material into detached candidate
`66276e58227d71fc37772ce280fbc518b253794d` at
`C:\tmp\flovart-rc-current-clean-20260902`. Clean dependency installation,
serial full tests, release build, and post-build worktree cleanliness were
verified from that candidate.

```text
Vitest: 154 files; 1035 passed, 1 skipped
TypeScript: passed
Web build: 4306 modules transformed
Browser extension build: passed
DSH build/client-loader: passed
Rust all-targets: 41 passed after clean single-job rebuild
Critical suite: 10/10 (9 files, 50 tests each)
Version/docs/red-team/secret/dependency/diff checks: passed
```

The candidate's local NSIS artifact is
`Flovart_0.3.2_x64-setup.exe`, `12,246,365` bytes, SHA-256
`EC3BF0EEA4CBB6891E085A47660DBB1FE90B3206EFE4ECDE1DC9D66E8C778412`.
The checksum and SPDX-2.3 package-lock SBOM checker passed; the SBOM contains
663 packages and 1,377 relationships. The exact package passed isolated
silent install, launch, graceful close, uninstall and install-root removal.

The first parallel run was recorded as a resource-pressure failure rather
than hidden: Vitest had two 5-second timeouts and Cargo hit Windows mmap
`os error 1455`. The affected Vitest files passed alone, the serial full
Vitest rerun passed, and the clean single-job Rust rebuild passed. Future
Windows RC gates should not compile the full Rust target concurrently with
the browser/test process.

The exact candidate was also checked with the Chrome for Testing executable
`C:\Users\ava\AppData\Local\ms-playwright\chromium-1234\chrome-win64\chrome.exe`,
not the OS-default Edge launcher. Dynamic ports `1157/2008` established the
same plain-origin versus one-time bootstrap distinction, with zero page or
console errors; the preferred `37522` collision fallback selected a free port
and preserved an unrelated blocker. No test listener remained after cleanup.

No Hosted run is attached to this detached candidate. Production signing,
Hosted CodeQL/provenance, real Provider and authenticated Codex certification
remain external.

## Current-worktree Vitest regression closure

One current-worktree full-suite run briefly exposed `fetch failed: bad port` in
`tests/fakeProviderServer.test.js`. The test then passed in isolation, in
`30/30` repeated jsdom/Vitest process runs, and in `100/100` repeated
jsdom/Vitest process runs. A direct Node HTTP loop also passed `100/100`; the
temporary failure diagnostic was removed afterward. The next full current
worktree run passed with `154` files, `1,035` passed tests and `1` skipped test
(`1,036` total, exit `0`). No application code was changed for this
observation, and it is not counted as a hidden retry-based pass.

The current working-tree documentation contract also passed with `138` files;
the exact detached application/package candidate remains the earlier
`111db63d4261cd81cf7f5cadd340f1044cea32e8` source anchor with its separately
recorded `136`-document candidate check. The local RC remains unpushed,
unsigned, and without real Provider/Codex credentials.

After that full-suite run, the current working tree also passed the final
critical repeat (`10/10`, 9 files and 50 tests per repetition), TypeScript,
Web build (`4,306` modules), Browser extension build, and DSH build/client
loader contract. Root and nested DSH audits remained at zero vulnerabilities;
the current updater-feed and NSIS artifact verifiers both returned `ok: true`.

## Latest exact candidate after public Quick Start route closure

The exact clean candidate is
`111db63d4261cd81cf7f5cadd340f1044cea32e8`. The public Quick Start documents
now describe the canonical `#/app` Workflow route without teaching the old
fixed `37522` URL; the fresh-user smoke assertion validates the route and
startup contract instead. The exact candidate passed the local recheck:

```text
Vitest: 154 files, 1035 passed, 1 skipped
TypeScript: pass
Web build: pass, 4306 modules transformed
Browser extension: pass
DSH build/client-loader contract: pass
Rust all-target tests: 41 passed after cargo clean, -j 1, RUSTFLAGS=-C debuginfo=0
Critical suite: 10/10, 50 tests per repetition
Version/docs/red-team/secret checks: pass (docs 136 files; secret 925/0)
root and dsh-plugin npm audit: 0 vulnerabilities
git diff --check: pass
```

The exact NSIS package is `Flovart_0.3.2_x64-setup.exe`, 12,248,572 bytes,
SHA-256
`0E8753064D4C9150C67D632396E158EC614945AACE663F47167688C2DB8A1C3F`.
Artifact/SBOM verification and isolated install/launch/close/uninstall passed.
The first-user fake-provider evidence for this SHA used Chrome for Testing,
not Edge, and is recorded in `C:\tmp\flovart-c14-first-user-evidence.json`.

## Current-worktree recheck after browser and release-environment fixes

The current worktree rerun added the Docker browser-plan output regression and
aligned the Dockerfile base with the repository Node requirement.

```text
focused dev-command suite: 20/20
full Vitest: 154 files, 1040 passed, 1 skipped
TypeScript: pass
Web build: pass, 4306 modules transformed
Browser extension build: pass
DSH build/client-loader contract: pass
Rust all-targets: 41 passed
critical suite: 10/10 (9 files, 50 tests each)
root dependency audit: 0 vulnerabilities
DSH dependency audit with official registry: 0 vulnerabilities
docs/version/red-team/secret checks: pass
artifact + SPDX checker: pass
test-signed updater feed checker: pass
git diff --check: pass
```

The Chrome-only browser smoke also passed after the recheck; its exact
connection evidence is in `RC_BROWSER_LAUNCH_EVIDENCE.md`. Docker image build
and Hosted GitHub execution remain unavailable in this local environment.

## Final current-worktree certification recheck

After the latest test additions and evidence updates:

```text
focused dev-command suite: 20/20
full Vitest: 154 files, 1040 passed, 1 skipped
critical suite: 10/10 (42.6s; 9 files, 50 tests each)
Chrome for Testing browser smoke: pass
docs contract: 139 files checked
version/red-team/secret/dependency checks: pass
TypeScript/Web/extension/DSH/Rust checks: pass
Compose default and overridden port configs: pass
git diff --check: pass (line-ending warnings only)
```

The candidate remains the uncommitted local worktree at `9be74642531ab8186ebcbce80829d68f575148a7`; this evidence is not a Hosted GitHub
workflow result.

## Clean candidate reproducibility check

The current working tree was copied into an isolated clean worktree and
committed locally as `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`. Fresh root and
DSH dependency installation completed before the checks. The clean candidate
passed full Vitest (`154` files, `1040` passed, `1` skipped), TypeScript, Web,
extension, DSH, Rust all-targets (`41` tests), critical `10/10`, docs/version/
red-team/secret checks and both official-registry dependency audits. The
standalone Chrome smoke passed in isolation with dynamic ports and
`clients=1 / hasWorkflow=true`. A concurrent browser run under simultaneous
full test/build CPU load timed out at navigation; it was rerun alone and
passed, and remains recorded as an environment-contention observation.

The candidate remains local-only and unpushed; no Hosted workflow or
production signing evidence is attached.
