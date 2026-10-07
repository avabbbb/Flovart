# Flovart Release Candidate Version Truth

This file records the release identity checked from the local candidate tree.
It is evidence for release review, not a release announcement.

## Current exact application/package anchor (2026-09-02)

| Item | Value | Meaning |
| --- | --- | --- |
| Candidate source commit | `712031d88a427fb04316e590f74cffef67f435b9` | Clean detached application/release source containing the current release workflow, stable-tag signing preflight, complete-draft signed-updater artifact verification, nested DSH dependency audit closure, browser launcher/port isolation fix, retired-command help labels, Skill/Node-version parity, and the public `#/app` quick-start route clarification |
| Candidate worktree | clean, detached after evidence refresh | No uncommitted application or evidence changes at capture time |
| Package source commit | `712031d88a427fb04316e590f74cffef67f435b9` | Exact source used for the current local NSIS build |
| Repository | `avabbbb/Flovart` | Current production owner and updater owner |
| Current public release | `v0.2.0-test` | No public `v0.3.2` release was found during the read-only audit |
| Remote `main` observed | `c60b452719fc3b0ddd32225556fbd86b73b5f299` | `chore: daily traffic snapshot`; candidate was not rebased onto the remote generated commit |
| Candidate publication | not pushed, tagged, or published | Hosted execution and public release remain external gates |
| NSIS package | `Flovart_0.3.2_x64-setup.exe` | `12,247,434` bytes; SHA-256 `67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D` |

The package, checksum/SBOM verification, and isolated installer lifecycle
smoke are bound to the exact application/package source commit above. The
evidence snapshot is maintained separately from this source anchor and does
not change the packaged application. The package is an unsigned local RC
build; production updater/Authenticode signing and Hosted provenance are not
claimed here.

The v3 clean candidate was installed with fresh root and DSH dependencies and
passed the full Vitest suite (`154` files; `1,035` passed and `1` skipped),
the `10/10` critical repeat, TypeScript, Web, extension, DSH and Rust
all-target gates (`41` Rust tests), and the artifact checker. Its SPDX-2.3
SBOM contains `663` packages and `1,377` relationships. The isolated NSIS
smoke observed install `0`, real executable launch, graceful close, uninstall
`0`, and removal of the temporary root.

## Historical candidate anchors

The following table is retained as an evidence trail from earlier local
rebuilds. It is not the current candidate identity.

| Item | Value | Meaning |
| --- | --- | --- |
| Application source anchor | `18b317348d0c32720b10b59c0f8e5450c239ce10` | Clean detached source commit containing the first-user UI and documentation closure |
| Candidate source commit | `18b317348d0c32720b10b59c0f8e5450c239ce10` (`fix: close first-run release candidate gaps`) | Clean detached source candidate containing the release-certification changes, packaged WebView generation fix, bounded artifact-key sanitizer, loopback proxy hardening, scoped release permissions, nested translation resolution and public-documentation closure |
| Release workflow hardening commit | `491970e5345523bc7ca0223f18d773a978b6a014` (`ci: make desktop dry runs unsigned and version gated`) | Non-tag desktop dry runs use the unsigned local overlay; tagged builds retain the production updater configuration and version gate |
| Packaged candidate commit | `e080a08387644d2fcc4a46a5e7dad5a9ce65273e` (`docs: record release candidate evidence`) | Exact clean candidate used for the latest local NSIS build; application source is unchanged from `18b3173` |
| Candidate evidence baseline | `e080a08387644d2fcc4a46a5e7dad5a9ce65273e` | Clean detached package/evidence commit; later evidence-only edits do not change the packaged application source |
| Candidate worktree | clean | Dependencies and build output were created outside Git-visible source |
| Local distance | no push or tag | Candidate changes have not been published by this pass |
| Repository | `avabbbb/Flovart` | Current production owner and updater owner |
| Existing public release | `v0.2.0-test` | No public `v0.3.2` release was found during the read-only audit |

The application candidate was assembled and verified from clean detached source
commit `18b317348d0c32720b10b59c0f8e5450c239ce10`; the final package was
built from clean evidence commit `e080a08387644d2fcc4a46a5e7dad5a9ce65273e`.
Release workflow hardening
was then added in `491970e5345523bc7ca0223f18d773a978b6a014`; the remaining
candidate commits contain release evidence and documentation. The detached
evidence snapshot is clean and remains bound to the source commit above. No
production tag, GitHub Release, or push was created by this pass.

## Version parity

| Source of release identity | Observed version | Result |
| --- | --- | --- |
| `VERSION` | `0.3.2` | PASS |
| root `package.json` | `0.3.2` | PASS |
| root `package-lock.json` | `0.3.2` | PASS |
| `package-lock.json` root package entry | `0.3.2` | PASS |
| `tools/flovart/package.json` | `0.3.2` | PASS |
| `src-tauri/tauri.conf.json` | `0.3.2` | PASS |
| `src-tauri/Cargo.toml` | `0.3.2` | PASS |
| `dsh-plugin/package.json` | `0.1.0` | N/A: independently versioned plugin package |

The executable release identity is checked by:

```text
npm run version:check
```

The check also validates the updater owner and scans Git-visible release files
for the retired repository owner.

## Updater ownership and signing state

| Check | Observed state | Result |
| --- | --- | --- |
| Tauri updater endpoint | `https://github.com/avabbbb/Flovart/releases/latest/download/latest.json` | PASS |
| Old owner in Git-visible source | none | PASS |
| `createUpdaterArtifacts` | `true` in release config | PASS |
| Tauri Windows Authenticode thumbprint | `null` | External production gate |
| Tauri timestamp URL | empty | External Authenticode/release policy gate |
| updater public key | present in config | Test/public-key pairing still requires production certification |
| updater private key | absent from the clean candidate; the developer checkout has two ignored signing paths whose contents were not read | Must remain outside Git, logs, Agent context, and public CI output; production custody is external |

The local test-signing proof is kept in `RC_UPDATER_EVIDENCE.md`; it does not
certify the production signing key.

## CLI package identity and manifest

The independently distributed `tools/flovart` package is also versioned
`0.3.2`. Its `bin` entry points to `cli.js`, and its package allowlist includes
the reachable runtime modules, `managed-agent`, `skill` and `scripts`
projections. The repaired isolated tarball and executable smoke are recorded
in `RC_ARTIFACT_EVIDENCE.md`; this npm package is separate from the Windows
NSIS artifact and does not change the Desktop package hash above.

## Automated gates

`npm run version:check` is required by tagged desktop builds and by the local
release red-team check. It prevents version drift and an updater endpoint being
silently redirected to a former repository owner.

Candidate checks:

```text
Flovart release identity is aligned at 0.3.2 (avabbbb/Flovart).
```

The release artifact content check is a separate gate:

    npm run release:artifacts:check -- --artifact-dir <staged-artifacts>

It validates installer version names and checksum coverage. When the hosted
workflow supplies --sbom, it also validates the generated SPDX document.
For stable tags, the publish finalizer additionally runs
`npm run release:updater:check` against the downloaded draft assets; this
requires every `latest.json` platform entry to have a versioned HTTPS artifact
and matching `.sig` sidecar before publication.

## Dependency security

The clean candidate was installed with `npm ci --ignore-scripts` and audited
against `https://registry.npmjs.org`. Both the full dependency graph and the
runtime-only `--omit=dev` graph returned `found 0 vulnerabilities`. The
exact dependency changes and resolved versions are recorded in
`RC_DEPENDENCY_AUDIT.md`; the same audit is now a Hosted security workflow
step.

## Historical package after first-user release closure

- Source change: `18b317348d0c32720b10b59c0f8e5450c239ce10`; clean packaged
  candidate: `e080a08387644d2fcc4a46a5e7dad5a9ce65273e`.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,249,655` bytes,
  SHA-256 `827AF318C965542372B018C8D851F127C15CB80FC365182EACEC39B7ABE8D86D`.
- `release:artifacts:check` passed with the staged SPDX document; isolated
  install, launch, graceful close and uninstall also passed.
- The source candidate also resolves nested product translations, closes the
  public first-run documentation path, rebuilds DSH proxy targets from a fixed
  `127.0.0.1` origin and scopes release workflow write/attestation permissions
  to the jobs that need them. Hosted CodeQL still must scan this exact
candidate.

## Current exact clean-source candidate

- Source commit: `8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`.
- Evidence docs bind the package to the source commit above; this record is
  updated in the same candidate evidence series.
- Version: `0.3.2` across `VERSION`, root package/lock, Toolkit package,
  Tauri configuration and Cargo package.
- Updater owner/feed: `avabbbb/Flovart`, with the endpoint pointing to the
  current repository's `releases/latest/download/latest.json`.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, 12,248,570 bytes, SHA-256
  `2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`.
- Local version and artifact checks pass. The package is unsigned; production
  updater signing, Hosted provenance and public publication remain external.
## Superseding exact clean candidate identity

The clean candidate source is d22406102260715e8a3c229b1eb84e48a913ef81. It
includes the CLI package closure and the exact local NSIS artifact is
Flovart_0.3.2_x64-setup.exe, 12,250,236 bytes, SHA-256
2E4BED3B09F5A11D62062C2C020ACEE25245E20E30EB5BFB1391C4DA003DA1B0.
The package is unsigned local evidence; Hosted, production signing, real
Provider and real host certification remain pending.
The matching flovart-cli@0.3.2 tarball is 123,596 bytes with SHA-256
F9EB5E2823D6A9B4ED27C0D19276C6AB561A93DF5C7C9FAE168C98D307A701FB and passed
isolated installation, help and structured offline status.

## Final exact candidate after warning cleanup

The final clean candidate is `d539a9979cb7230f95783e3144d21ea9b6ac7685`.
All release identity files remain aligned at `0.3.2`, including `VERSION`,
the root package and lockfile, the CLI package, Tauri configuration and Cargo
package. The updater owner/feed remains `avabbbb/Flovart`.

The exact NSIS artifact is `Flovart_0.3.2_x64-setup.exe`, 12,252,502 bytes,
SHA-256
`97B144CEBA32864DE2905F6588EA1F6827AAD83AE1F76C8126A07E25B7ADED53`.
The exact candidate's CLI tarball is 123,596 bytes with SHA-256
`F9EB5E2823D6A9B4ED27C0D19276C6AB561A93DF5C7C9FAE168C98D307A701FB`.
Both passed their local artifact/install checks. The package is unsigned and
has no Hosted execution attached.

## Final exact candidate with signer preflight

The final clean candidate is
`71f8395e071e237d6fb83c03e340d55d795b3df0`. It keeps all release identity
files aligned at `0.3.2` and includes the stable-tag
`TAURI_SIGNING_PRIVATE_KEY` fail-closed preflight in the desktop workflow.
The rebuilt NSIS package is 12,250,318 bytes with SHA-256
`A731DA53DFCE2A27F8F09BE0E57222B5E6E375BA6DFE7069088AB76B3F289DF8`.
The package is unsigned local evidence and has no Hosted execution attached.

## Runtime image alignment

The repository requires Node `>=22.19.0` for the root application and CLI.
The Dockerfile now uses `node:22-alpine` instead of the stale `node:20-alpine`
base, so the local Compose image no longer advertises an unsupported Node
major. The Docker daemon is unavailable in this environment, therefore the
image build remains unverified; `docker compose config` passed for default and
overridden host ports.

`npm run version:check` now also fails if the Dockerfile's Node major falls
below the root package engine minimum. The current `node:22-alpine` base
passes that guard.

## Current clean candidate snapshot

The current main worktree was copied into an isolated clean worktree and
committed locally as `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306` for RC
reproducibility testing. Its status is clean after dependency installation,
Web/NSIS build and test artifacts. Version parity remains `0.3.2` across the
root, CLI, Tauri and Cargo manifests; updater ownership remains
`avabbbb/Flovart`. This commit is local-only and has not been pushed or tagged.
