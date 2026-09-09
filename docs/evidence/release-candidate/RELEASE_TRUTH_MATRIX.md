# Flovart Release Truth Matrix

## R0 verdict

```text
R0 RELEASE TRUTH AUDIT: PARTIAL
PRODUCT CORE: PASS
AUTONOMOUS RC EVIDENCE: PASS (LOCAL SCOPE)
UNVERIFIED LOCAL BOUNDARIES: EXACT FORMAL-PACKAGE UI OBSERVATION
HOSTED RELEASE EVIDENCE: PENDING
PUBLISHED MAIN PARITY: BLOCKED_EXTERNAL
CURRENT LAUNCH VERDICT: NO-GO
```

The current working tree has passed the locally reproducible RC scope, but it is not yet a published release. Public `main` and production-only certification remain separate gates. No real Provider, Codex login, production signing key or GitHub Release is represented as a local PASS.

This matrix distinguishes four scopes:

- **Published main:** what an unknown GitHub visitor can read or download now.
- **Local candidate source:** the current local branch plus the certification changes under review.
- **Local working tree:** the current release-candidate work and its executable evidence.
- **External gate:** a credential, signing, publishing or owner decision that cannot be certified in this workspace.

The reconciliation below is the current truth. The historical inventory remains below it for audit traceability. `PASS` means local evidence only; `EXTERNAL` means the capability is intentionally not claimed as locally complete.

## Final candidate anchor

The current exact application/package source is clean detached commit
`712031d88a427fb04316e590f74cffef67f435b9`. It contains the current release
workflow hardening, stable-tag signing preflight, fail-closed updater feed and
sidecar verification, nested DSH dependency audit closure, retired-command
help labels, packaged UI observation boundary, and the public `#/app`
quick-start route clarification.
The local NSIS package built from this exact source is
`Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes, SHA-256
`67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.
It has not been pushed, tagged, or published. Evidence-only commits may be
added after this source anchor; current package evidence remains bound to this
exact application/package source and `RC_VERSION_TRUTH.md`.

The remote `main` currently observed is
`c60b452719fc3b0ddd32225556fbd86b73b5f299`, a scheduled
`chore: daily traffic snapshot` commit. The candidate was not rebased onto
that unrelated generated commit.

## Current working-tree reconciliation

| Surface / claim | Local evidence | State | Remaining gate |
| --- | --- | --- | --- |
| Stable model-facing Agent surface | `status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, `workflow.node.run`; release red-team asserts exactly five | `PASS` | Publish only through an authorized release |
| CLI help and Skill projections | `--help`/`-h` work; four Flovart Skill projections are byte-identical; docs-contract and red-team checks pass | `PASS` | None locally |
| Discovery commands | `command.list` / `command.schema` are documented as bootstrap/diagnostics, not the normal model path | `PASS` | Keep compatibility surface explicitly non-primary |
| Browser Workflow authority | Browser binding, active writer, wrong-project rejection, refresh/reopen recovery and no Native fallback have visible evidence | `PASS` | Desktop process-kill loop remains a release-environment check |
| First Run → First Safe Generation | Fresh Canvas, BYOK, `/models`, T2I/I2I/T2V/I2V fake HTTP, references, Cost Gate and recovery are evidenced | `PASS` | Real Provider billing/quality remains external |
| Provider wire semantics | Fake Provider recorder proves edit/video endpoints, reference roles, dedupe and polling | `PASS` | Real paid Provider certification is external |
| Persistence, migration and soak | RC evidence covers migration fixtures, truncated-envelope recovery, restart/refresh cycles, task identity and deterministic Canvas stress; same-schema installed-update preservation, same-WebView2 packaged cross-schema migration and source-identical packaged process-kill recovery are evidenced | `PASS (local data layer)` | Production-signed clean-machine migration and long-term field usage remain observational/external |
| Performance and accessibility | 100/300/500-node measurements, 20 reloads, 30-cycle heap probe, 50 Browser bind/unbind cycles, 50 dynamic WebUI launcher cycles, 20 isolated Desktop window launches, keyboard/focus/dialog checks recorded | `PASS` | Establish production telemetry after release |
| Secret boundary and diagnostics | Key redaction, approval-boundary tests, sanitized diagnostics and threat-model evidence pass | `PASS` | Production security review remains advisable |
| Plugin / DSH projection | Lifecycle containment and DSH build/profile evidence are recorded | `EXPERIMENTAL` | Real DSH account and upgrade/rollback certification |
| Coding Agent support | Claude/OpenCode local tracers are evidence-backed; Codex has no logged-in transcript | `EXPERIMENTAL` | Real Codex login and supported-host certification |
| Windows NSIS distribution | Candidate `0.3.2` NSIS install, launch of `flovart.exe`, graceful close and uninstall passed in an isolated target; the current package is bound to `712031d88a427fb04316e590f74cffef67f435b9` and its SHA-256 is recorded in `RC_VERSION_TRUTH.md`; source WebUI and source-identical test-overlay packaged Fake Provider T2I evidence are complete | `PASS` locally for lifecycle and installed test-overlay generation | Exact formal no-debug package UI observation remains `NOT_VERIFIED`; Authenticode and public release publication |
| Updater signature enforcement | Test-signed installed N→N+1 update replaced `0.3.1` with `0.3.2`; one-byte tampered artifact was rejected without replacing N; a seeded disposable project remained present after the final update run; interrupted download kept N at `0.3.1` and a later launch retried to `0.3.2`; current release workflow fail-closes if a stable tag lacks signed updater metadata, and the isolated feed/sidecar verifier passes | `PASS` locally | Production key, clean-machine profile preservation and public feed are external |
| Checksums, SBOM and provenance | Local artifact checker validates the final NSIS checksum and the updater feed/sidecar verifier validates versioned HTTPS URLs plus matching `.sig` files; release workflow stages checksums/SBOM, grants attestation and artifact-metadata permissions, and keeps attestation tag-only | `PASS` locally / `CONFIGURED` hosted | Hosted GitHub run and repository permissions |
| CodeQL, dependency and secret automation | `.github/workflows/security.yml` is configured for CodeQL, high-severity PR dependency review, the official-registry npm audit and the secret audit; local secret/dependency checks pass, but a read-only GitHub API audit reports 13 open CodeQL alerts on the older main SHA (1 critical, 9 high, 3 medium) and the detached candidate has no Hosted scan; the latest candidate also removes the remaining unbounded artifact-key regex; see `RC_CODEQL_TRIAGE.md` | `PARTIAL locally / EXTERNAL Hosted security gate` | Run Hosted CodeQL on the exact candidate, triage the critical DSH proxy alert, and confirm repository security settings |
| Tauri/WebView network policy | CSP keeps scripts self-only but permits arbitrary HTTPS for user-configurable BYOK endpoints | `PARTIAL` | Narrowing requires an approved provider proxy/security design |
| Release identity and updater ownership | Candidate `npm run version:check` passes at `0.3.2`; Tauri endpoint is owned by `avabbbb/Flovart`; no retired owner reference is Git-visible | `PASS` | Build the final pushed/tagged candidate |
| Public documentation and artifacts | The exact clean candidate docs contract checks 137 documents; the current working tree checks 138 after adding RC evidence documents; the local 0.3.2 NSIS checksum is verified; public Releases still expose only `v0.2.0-test` | `BLOCKED_EXTERNAL` | Publish the reviewed candidate with owner approval |

## Historical baseline matrix (captured before RC hardening)

The table below is retained as the initial R0 inventory. Its `Published main` and pre-RC local columns are historical observations, not the current release verdict. Use the reconciliation table above when making current implementation decisions.

## Truth matrix

| Surface / claim | Published main | Local source / working tree | Evidence | R0 status | Blocking |
| --- | --- | --- | --- | --- | --- |
| Product is Workflow + Table + Agent | Public README describes these three surfaces | `App.tsx` mounts `WorkflowWorkspace`, `TableWorkspace` and `AgentWorkspace` | Static route/mount inspection | `TRUE` at naming level | No |
| Table is a usable independent node-style media processing workspace | Public copy presents Table as a product surface | `components/table/TableWorkspace.tsx` currently says Table does not create a second node graph; project todo calls the body an unfinished placeholder | Source + progress docs | `FALSE` | **P1** if advertised as mature |
| Agent is a spatial production workspace rather than only a Workflow drawer | Public copy presents an Agent surface | `AgentWorkspace` is mounted as a top-level surface; Workflow has a separate Production Crew status area | Source inspection | `PARTIAL` pending real-user path | Yes, if the public UX claim exceeds evidence |
| Stable model-facing Agent surface is exactly five tools | Public README still teaches discovery commands as a normal first step | Local model tool projection contains `status`, `workflow.inspect`, `workflow.selection.get`, `workflow.apply`, `workflow.node.run` | `agent/tools.js`, local README/Quick Start, CLI registry | `STALE` publicly, `TRUE` locally | **P1** docs blocker |
| `command.list` / `command.schema` are diagnostics/bootstrap only | Public README instructs users to start with them | Local README/Skills demote them; DSH YAML comment still describes deriving tools from them | Public README, local docs, `dsh-plugin/cordis.patch.yml` | `STALE` | **P1** |
| CLI initialization uses `--target` | Published README shows `init --host codex` | Local Quick Start and CLI use `init --target`; Host Projection separates Agent Identity from target | Public/local README and CLI source | `STALE` publicly | **P1** |
| Current Workflow command is `workflow.inspect` | Published Quick Start still documents `canvas.inspect` | Local CLI/Agent surface uses `workflow.inspect`; removed Canvas/Element model surface is rejected | Public Quick Start, local registry/tests | `STALE` publicly | **P1** |
| Browser authority uses automatic binding | Published Quick Start still describes file-state runtime and browser polling `.flovart/command-queue.json` | Local Browser contract/bootstrap uses authenticated loopback registration and active-writer binding | Public Quick Start; `BrowserWorkflowContract`, Agent session and HANDOFF evidence | `STALE` publicly, `PARTIAL` locally | **P1** |
| README Quick Start is executable from a clean user state | Public instructions target older CLI/runtime architecture | Local docs have newer commands but have not passed a clean-state docs Golden Path on a release artifact | Live public docs + local inspection | `FALSE` publicly / `UNVERIFIED` locally | **P1** |
| Standard CLI help works | Published docs imply ordinary CLI behavior | `node tools/flovart/cli.js help` works; conventional `--help` resolves to invalid command `..help` and returns `CLI_FATAL` | Direct command execution | `PARTIAL` | P1 installation/usability |
| CLI registry is the canonical compatibility contract | Public docs point to registry | `command.list --json` reads the canonical registry and stable Workflow commands route through Browser Workspace | Direct execution + registry source | `TRUE` for compatibility registry | No |
| No second hidden Workflow authority | Public docs do not disclose one | Public Workflow commands use Workspace, but `tools/flovart/shadow-runtime.js` still contains a packaged file-state Workflow implementation and dedicated tests | CLI imports, package contents, `shadowRuntime.test.ts` | `PARTIAL` / architecture drift | **P1 candidate** pending caller proof |
| Source Skill and packaged Skill are identical | Public repository exposes a Skill | `.agents/skills/flovart/SKILL.md`, `tools/flovart/skill/SKILL.md`, and `skills/flovart/SKILL.md` differ; package install prefers the tools copy | File comparison and `tools/flovart/agent-kit.js` | `FALSE` | **P1** truth-source failure |
| Skill never teaches removed queue/Canvas paths | Public copy is stale | Current `.agents`/tools copies reject legacy shadow/Canvas; root `skills/` copy is older and narrower | Three Skill files | `PARTIAL` | **P1** until generated from one source |
| Codex is formally supported | Public/local README lists Codex in the formal support set | Browser/CLI fixture tracers pass, but this machine has no logged-in Codex Golden Path | HANDOFF external-agent evidence | `UNVERIFIED` | `BLOCKED_EXTERNAL` certification + **P1 claim** |
| Claude Code is supported | Public/local README lists Claude Code | Real local `status → inspect → apply → inspect` tracer is recorded | HANDOFF evidence; must be revalidated for RC | `PARTIAL` | No, pending final rerun |
| OpenCode is supported | Public/local README lists OpenCode | Real local `status → inspect → apply → inspect` tracer is recorded | HANDOFF evidence; must be revalidated for RC | `PARTIAL` | No, pending final rerun |
| DSH is formally supported | Public/local README lists DSH | RC8 profile/boot/native draft paths pass, but real logged-in reload, failed-upgrade rollback and authority transfer remain unverified | `dsh-plugin/README.md`, HANDOFF | `PARTIAL` | **P1 claim** unless relabeled Developer Preview |
| Pi is formally supported | Public/local README lists Pi | Compatibility projection exists, but no current final real-host certification is recorded | Host projection/docs inspection | `UNVERIFIED` | **P1 claim** unless relabeled |
| Extension is a production integration | Public docs list Browser integration | `extension/README.md` honestly describes a development thin import companion; store ID, Native Host registration and installer hooks are not release-certified | Extension README/manifest/progress docs | `PARTIAL` | No if labeled experimental |
| Extension never stores Provider secrets | Extension docs say it does not | `hooks/useApiKeys.ts` retains a `chrome.storage.local` synchronization path when an extension API is exposed | Docs + source inspection | `PARTIAL` / security ambiguity | **P1 candidate** |
| Provider extension is declarative and secret-isolated | Public docs describe provider extension | `docs/dev/provider-extension-contract.md` uses a declarative JSON DSL, public/HTTPS constraints and no arbitrary JS/raw secret | Docs + implementation inspection pending | `PARTIAL` | R5/R14 verification required |
| User-script Provider sandbox rejects privileged APIs | Launch claim requires this | No complete real sandbox failure matrix has been evidenced in R0 | Test search/source audit pending | `UNVERIFIED` | R5 blocker |
| Node Plugin lifecycle is production-ready | Public docs present a Plugin SDK | In-memory SDK supports reference plugin install/update/enable/disable/uninstall; no persistent permission/trust model or rollback certification | `components/workflow/nodePluginSdk.tsx` | `PARTIAL` | **P1** if advertised as production-ready |
| Plugins declare capabilities/trust/source/version/permissions | Launch requirement | Current definition lacks the complete trust and permission contract | Plugin SDK types | `FALSE` | **P1** |
| OpenAI-compatible first configuration is a normal-user path | Published release predates current work | Working tree mounts Onboarding, defaults to OpenAI-compatible, validates `/models`, and suggests missing product routes | Dirty `App.tsx`, Onboarding, setup service/tests | `PARTIAL` | Must pass Browser Golden Path |
| Fake Provider exercises real transport | Not a public claim | Working tree adds a local HTTP fake server/recorder and tests, not yet fully certified in a Browser | Untracked server/tests and HANDOFF | `PARTIAL` | R4/R5 blocker |
| Unsupported I2I/I2V never silently falls back | Public claim is not explicit | Canonical validation tests exist, but real fake-Provider wire proof for all four modes is not complete | Existing/dirty generation tests | `UNVERIFIED` | R4 blocker |
| Paid generation requires human approval | Public UX implies user control | Browser bridge asks via `window.confirm`, but the dispatcher accepts caller-supplied `args.confirmed === true`; a durable unforgeable approval receipt is absent | `services/workflowAgentBridge.ts`, `services/workflowDispatcher.ts` | `FALSE` at trust boundary | **P0 candidate; reproduce before mutation** |
| Logical generation is exactly-once | Required release property | Dispatcher idempotency cache is in-memory and not durable across refresh/restart; paid-like retry/restart evidence is absent | Dispatcher source/tests | `UNVERIFIED` | **P0/P1 depending provider behavior** |
| API keys are securely stored | README says keys are encrypted in local storage | `utils/keyVault.ts` uses AES-GCM with origin/user-agent-derived material and same-origin salt; it protects at-rest readability but is not OS keyring isolation | README + key vault source | `PARTIAL` / claim needs precision | Security claim blocker |
| Diagnostics/logs cannot leak secrets | Required launch property | Redaction helpers/tests exist in Agent paths, but no canary across Browser, CLI, fake Provider, diagnostics and artifacts has run | Source/tests | `UNVERIFIED` | R14/R19 blocker |
| Version has one product value | Public latest release is `v0.2.0-test` | `VERSION`, root/toolkit package, Cargo and Tauri align at `0.3.2`; version checker passes | `node scripts/check-release-version.mjs` | `TRUE` locally, `STALE` publicly | Release blocker until artifact/publish |
| Windows NSIS artifact is current and clean-install certified | Public Releases provide an older test installer | Tauri config targets NSIS; current 0.3.2 clean build/install evidence is absent | Public Releases + Tauri config | `UNVERIFIED` | **P0/P1 release blocker** |
| Windows installer is code-signed | Formal Windows release requires it | Tauri config has no certificate thumbprint/timestamp configuration | `src-tauri/tauri.conf.json` | `FALSE` | `BLOCKED_EXTERNAL` plus release setup |
| Updater artifacts require signature | Tauri requires signature verification | Updater public key/endpoints and artifact setting exist; ignored local key material exists but production provenance/ownership is unverified | Tauri config, ignore/tracking check; key contents not read | `PARTIAL` | External certification |
| Tauri CSP is restrictive | Public security claim is generic | Script source is self-only, but `connect-src` permits broad `https://*`; capability and host allowlists need reduction | Tauri config/capabilities | `PARTIAL` | R13 blocker |
| Release tags enforce all launch tests | Public workflow publishes artifacts | Desktop workflow builds/publishes but omits the full unit/type/Rust/extension/DSH/E2E/migration/security matrix | `.github/workflows/build-desktop.yml` | `FALSE` | **P1** |
| Release artifacts include checksums/SBOM/provenance | Launch requirement | Current workflows do not produce the complete set or GitHub attestation | Workflow inspection | `FALSE` | R26 blocker |
| CodeQL/dependency/security gates are release law | Launch requirement | No current CodeQL workflow or reachability triage gate was found | `.github/workflows` inspection | `FALSE` | R15 blocker |
| Public backup/recovery, uninstall, upgrade and known-limit docs exist | Launch requirement | Dedicated user-operable release docs were not found in the first R0 inventory | `rg --files` docs inventory | `FALSE` | **P1** docs blocker |
| Web/Desktop/extension storage boundary is clear | Public README notes IndexedDB isolation | Current public/local copy acknowledges default separation; no shared production bridge is certified | README/progress docs | `TRUE` as limitation, feature `PARTIAL` | No if disclosure remains prominent |
| Public release claims match current evidence | Public branch is behind local architecture and exposes older installer/docs | Local README also overstates some hosts/plugins/Table | Entire matrix | `FALSE` | **P1** launch blocker |

## Historical R0 blockers (closed or reclassified)

These findings were recorded before the RC hardening work. They are kept for traceability; they are not open local blockers unless the reconciliation table explicitly says so.

- The retired README/Quick Start path was corrected locally. `--target`, `workflow.*`, Browser authority and automatic binding are now covered by the docs contract. Published parity remains an external release gate.
- The four Flovart Skill projections are now byte-identical and checked by both docs-contract and release red-team automation.
- `node tools/flovart/cli.js --help` and `-h` now return the same stable help text and are checked by release red-team automation.
- RC CI, installer, checksum, SBOM and test-attestation steps now exist locally. Hosted execution, production signing and publication remain external gates.
- Capability claims are now classified in `SUPPORT_MATRIX.md`; Codex, DSH, real Providers and production distribution are not promoted to Stable without their missing evidence.

## Current v3 exact candidate reconciliation

The current clean detached candidate is
`712031d88a427fb04316e590f74cffef67f435b9`. It passed fresh dependency
installation, full Vitest (`154` files; `1,035` passed and `1` skipped), the
critical suite (`10/10`), TypeScript, Web, extension, DSH and Rust all-target
checks (`41` Rust tests), version/docs/red-team/secret checks and diff hygiene.
The candidate docs contract counted `137` documents; the current working tree
recheck counted `138` after evidence-only additions.

Its exact unsigned Windows x64 NSIS package is
`Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes, SHA-256
`67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.
SPDX-2.3 SBOM and checksum validation passed (`663` packages, `1,377`
relationships), and isolated install/launch/graceful-close/uninstall passed.
The local overlay intentionally disables updater artifact generation, so the
local updater checker correctly reports no `latest.json`; the separate
test-signed N→N+1 chain remains the autonomous updater evidence.

This candidate remains local and unpushed. Hosted CI/CodeQL/provenance,
production signing, real Provider/Codex certification, repository security
settings and public publication remain external gates.

## Historical P0 candidates (reconciled in the RC)

### Human approval boundary

The pre-RC concern was that `args.confirmed === true` could authorize a paid-like run. The current dispatcher uses an internal approval receipt, removes the caller-controlled flag, and returns `CONFIRMATION_REQUIRED` for forged input. Browser and fake-Provider tests record zero submissions before approval. Keep the invariant in the release red-team suite.

### Paid-like idempotency

The RC fake-Provider and refresh-recovery suites prove no duplicate logical submission across the covered retry and polling scenarios. Exactly-once behavior across an arbitrary process crash and a provider that accepted a request before disconnect remains a provider/runtime certification concern; ambiguous state must remain recoverable rather than being blindly resubmitted.

## R0 gate decision

The local R0 reconciliation is complete for the autonomous scope:

1. One canonical Skill and one documented CLI/Agent path exist.
2. Local README/Quick Start claims match actual support/certification status.
3. Docs-contract automation rejects retired commands and paths.
4. Conventional CLI help and package instructions work.
5. The approval, secret, idempotency, installer and recovery evidence is recorded in RC artifacts.
6. Remaining partial capabilities are classified in the support matrix instead of being advertised as Stable.

R0 still does not become a production launch PASS because public `main`, production signing, hosted release attestations, real Provider billing and real host account certification require external authorization or credentials. Packaged source-identical process-kill recovery now covers both migration write phases; production-signed clean-machine certification remains an external release gate.

## Current clean-source candidate reconciliation

The reviewed local candidate is now pinned to source commit
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`. It passed the local full suite,
critical 10x, clean dependency audits (including the nested DSH graph),
version/docs/red-team/secret checks, and a clean-source Windows NSIS build.
The current package is `Flovart_0.3.2_x64-setup.exe`, 12,248,570 bytes,
SHA-256 `2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`;
artifact validation and isolated install/launch/close/uninstall passed.

This local evidence does not change the public/hosted status: the candidate is
not pushed, no Hosted CI/CodeQL/provenance run is attached, the package is
unsigned, and real Provider/Codex certification is pending.

## Current working-tree CLI distribution recheck

The independently published `flovart-cli@0.3.2` surface was tested after an
isolated install exposed and fixed a missing runtime module in its npm
allowlist. The repaired tarball passed `flovart --help` and
`flovart status --json`, and its 69 entries include the executable, managed
agent, Skill projection, `bootstrap-coordinator.js`,
`crew-command-surface.js` and `web-discovery.js`. The package-manifest
regression is covered by `tests/cliPackageManifest.test.js`. This is a
working-tree CLI distribution fix; it is not retroactively attributed to the
separately staged Desktop package hash above until a new clean candidate is
assembled.
## Exact candidate after CLI distribution closure

The clean candidate source is d22406102260715e8a3c229b1eb84e48a913ef81. It
contains the repaired flovart-cli@0.3.2 package and its manifest regression.
The exact local NSIS artifact, 12,250,236 bytes with SHA-256
2E4BED3B09F5A11D62062C2C020ACEE25245E20E30EB5BFB1391C4DA003DA1B0, passed
artifact validation and isolated install lifecycle. It is unsigned local
evidence, not a production-signed or Hosted-certified release.

## Final exact candidate after warning cleanup

The final local candidate is source commit
`d539a9979cb7230f95783e3144d21ea9b6ac7685`. It passed the exact candidate
full-suite, build, critical 10/10, version/docs/red-team/secret/dependency
checks and independent CLI/NSIS packaging checks. The NSIS artifact is
`Flovart_0.3.2_x64-setup.exe`, 12,252,502 bytes, SHA-256
`97B144CEBA32864DE2905F6588EA1F6827AAD83AE1F76C8126A07E25B7ADED53`.

This remains local evidence only: the candidate is unpushed and unsigned,
with no Hosted CI/CodeQL/provenance run attached. Production updater signing,
real Provider certification, authenticated Codex certification and repository
security settings remain external launch gates.

## Final exact candidate with signer preflight

The final local candidate is
`71f8395e071e237d6fb83c03e340d55d795b3df0`. It includes and locally verifies
the stable-tag missing-signing-key fail-closed preflight. Its rebuilt NSIS
artifact is 12,250,318 bytes with SHA-256
`A731DA53DFCE2A27F8F09BE0E57222B5E6E375BA6DFE7069088AB76B3F289DF8` and
passed artifact validation plus the isolated installer lifecycle. No Hosted
run, production signature, real Provider certification or authenticated Codex
certification is attached.

## Current-worktree browser and environment correction

The current worktree adds no new product-core behavior. It fixes two release
environment hazards: the Dockerfile now uses Node 22 to satisfy the root
`>=22.19.0` engine, and Docker Compose port allocation covers the actual Web
dependency closure with distinct host ports. The browser acceptance runner is
Chrome for Testing only, with `--no-open --web-port=0 --agent-port=0`.

The post-fix local recheck passed full Vitest (`154` files, `1,037` passed,
`1` skipped), critical `10/10`, TypeScript, Web/extension/DSH/Rust builds and
tests, docs/version/red-team/secret checks, dependency audits, artifact/SBOM
validation and the test-signed updater feed checker. This remains a dirty,
unpushed worktree; it has no Hosted run or production signature attached.
