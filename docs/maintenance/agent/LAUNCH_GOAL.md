# Flovart Master Autonomous Goal

## Release Candidate → Production Launch

**Status:** `ACTIVE — LOCAL RC EVIDENCE COMPLETE WITH EXPLICIT UNVERIFIED BOUNDARIES`
**Current phase:** `FINAL RC CERTIFICATION — HOSTED AND EXTERNAL GATES PENDING`
**Current launch verdict:** `NO-GO` until every autonomous and external certification gate below has evidence.

## Current certification snapshot

- Local source/release candidate: evidence complete for the autonomous local scope.
- Final exact local candidate: `712031d88a427fb04316e590f74cffef67f435b9`, with a clean-candidate NSIS artifact, test-signed updater feed/sidecar evidence, Chrome-only dynamic-port browser evidence, public `#/app` quick-start documentation, and independently verified CLI package recorded in the RC evidence files.
- Explicit local boundary: the stock production-configured Tauri/WebView2 package exposes no usable CDP endpoint for exact-package UI observation. A source-identical test-only observability overlay verified the installed Home → first-run AI service → Fake Provider → cost confirmation → T2I path; this is not mislabeled as exact production-package UI evidence. Packaged migration write interruption/recovery is covered by the source-identical acceptance fixture.
- Hosted GitHub execution, repository security settings and publication: pending owner-authorized external execution.
- Real Provider billing/cancellation, logged-in Codex/DSH certification and production signing: pending external certification.
- Keep public support claims at the classifications in `SUPPORT_MATRIX.md`; do not promote experimental or planned paths to Stable.

## Mission

Bring the current Flovart checkout to a Release Candidate that an unknown real user can install, configure, create with, recover, upgrade, and use over time. Architecture, tests, a browser smoke, or an Agent command working in isolation are not completion.

The only final verdicts are:

```text
LAUNCH VERDICT: GO
```

or:

```text
LAUNCH VERDICT: NO-GO
```

`GO` requires code, automated tests, and real execution evidence for every claimed capability. A missing evidence class is `UNVERIFIED`, not `PASS`.

## Stable architecture baseline

Preserve and converge the existing system rather than creating competing authorities:

```text
Flovart
├─ Workflow — Canvas / Graph / PromptBar / References
├─ Table — focused media preprocessing workspace
├─ Agent — production collaboration workspace
├─ Production Skill
├─ Runtime / CLI
├─ Stable Agent Surface
│  ├─ status
│  ├─ workflow.inspect
│  ├─ workflow.selection.get
│  ├─ workflow.apply
│  └─ workflow.node.run
├─ BrowserWorkflowContract
├─ CanonicalGenerationInput
├─ Provider Adapter
├─ Agent Host Projection
├─ Node Plugin SDK
└─ Provider Extension Contract
```

Do not create a second Workflow authority, mutation authority, generation-input pipeline, provider-execution pipeline, or model-facing Agent surface.

## Autonomy and authority

Continue autonomously through:

```text
audit → reproduce → failing acceptance test → implement → focused test
→ browser/runtime verification → failure injection → full regression
→ independent review → repair → repeat
```

Allowed in this workspace: inspect and modify source, tests, UI, CLI, Runtime, Provider adapters, Skills, plugins, Rust/Tauri, CI and documentation; add migrations/harnesses/fake providers; run local services, browsers, isolated profiles, packaging and fault injection; update this goal, HANDOFF, ADRs and evidence.

Not authorized without external approval: paid Provider traffic, unknown real credentials, changing the user's Codex/DSH login, deleting real projects or Provider assets, using production signing private keys, pushing commits, publishing a GitHub Release, deploying production, or causing irreversible external cost.

Technical failures are work, not external blockers. Only credentials/accounts, paid real generation, production signing material, publishing permission, and equivalent owner/legal decisions may remain external gates.

## Long-run state

The repository is the durable task memory:

- `LAUNCH_GOAL.md`: stable mission and gates.
- `RELEASE_TRUTH_MATRIX.md`: R0 claim-to-evidence audit.
- `HANDOFF.md`: current phase, changes, evidence, failures and next action.
- `docs/adr/`: architectural decisions.
- `docs/content/docs/progress/todo.mdx`: incomplete product/release work.
- `docs/content/docs/progress/pending-test.mdx`: implemented changes awaiting user acceptance.

After context loss, read these files and relevant tests before continuing. Do not reconstruct state from chat memory alone.

## Severity and priority

- **P0 — Launch blocker:** data loss, wrong-project write, secret leak, unapproved or duplicate paid submission, silent provider fallback, unusable installer, destructive upgrade, authority bypass, arbitrary privileged execution, or broken core generation chain.
- **P1 — Major:** unrecoverable primary path, failed first configuration, missing critical feedback, inconsistent Agent operation, major capability mismatch, widespread task recovery failure, plugin lifecycle damage, or publicly false instructions/claims.
- **P2 — Minor:** documented, has a safe workaround, and does not affect data, security, cost or the primary journey.

Launch requires `P0 = 0` and `P1 = 0`.

When priorities conflict:

```text
data correctness
→ security / secrets
→ cost and side-effect correctness
→ authority consistency
→ provider input semantics
→ recovery
→ primary user journey
→ install / upgrade
→ performance
→ visual polish
```

If the same design direction fails twice, preserve its tests/evidence, remove only that local failed direction, re-audit the root cause, and redesign. Do not stack compatibility patches.

## Evidence states

Every launch claim uses exactly one of:

- `PASS`: implemented, automated coverage passes, and real execution evidence exists.
- `FAIL`: evidence proves the gate is violated.
- `BLOCKED_EXTERNAL`: all autonomous work is complete but a true external credential/signing/publishing action remains.
- `PRE_EXISTING_FAILURE`: confirmed historical failure; still blocks if it affects the launch scope.
- `NOT_VERIFIED`: evidence is absent or incomplete.

Public claims additionally use the R0 truth labels `TRUE`, `STALE`, `PARTIAL`, `UNVERIFIED`, and `FALSE`.

## Launch workstreams

### R0 — Release truth audit

Create and maintain `RELEASE_TRUTH_MATRIX.md` across implementation, public `README.md`, `README.en.md`, Quick Start, CLI help/registry, every packaged/source Skill, Agent Host Projection, Desktop UI, Web UI, extension, DSH plugin, Provider/plugin docs and release workflows.

Explicitly find and resolve stale `command.list/schema` primary-path guidance, `init --host`, `canvas.inspect`, file-state/command-queue polling and old MCP wording. Source, CLI contract, UI, package, Skills, public docs and release claims must describe one real product.

**Gate:** one source of truth; local and published docs match shipped behavior; no removed architecture is presented as current.

### R1 — Core architecture invariant audit

Trace direct Workflow setters and persistence, `NativeWorkflowStore`, legacy reference fields, `aiGateway`, Provider adapters, `CanonicalGenerationInput`, `workflow.node.*`, discovery commands and credential types.

- All Workflow mutations converge on `WorkflowMutationEnvelope → applyWorkflowOps`.
- All generation converges on `GenerationReference → resolver → CanonicalGenerationInput → capability validation → Provider Adapter`.
- Agent inspect/apply/run never reads React state directly.
- Browser projects retain Browser Draft authority and never silently fall back to Native.

Add architecture tests so bypasses fail CI.

### R2 — Data integrity, persistence and migration

Verify projects, nodes, connections, references, assets, artifacts, generation history, Provider configuration metadata, Skills and plugins across:

```text
browser reload ×20
app restart ×20
runtime restart ×20
machine-like clean relaunch ×10
```

Upgrade at least three historical schema fixtures, preserving nodes, connections, references, artifacts, Provider selection and unknown plugin nodes. Inject process termination, disk error and partial write during migration. High-risk migration requires a recoverable snapshot and atomic failure behavior.

**Gate:** zero known data-loss cases.

### R3 — Workflow product reliability

In real Chrome and Desktop WebView verify create/delete/move/resize, multi-select, connect/disconnect, copy/paste, undo/redo, selection, viewport, zoom and pan. Benchmark 100/300/500-node projects for open time, interaction/mutation latency, memory and pan/zoom response.

The 500-node scenario must not crash, corrupt state, freeze interaction for more than five seconds, or create wrong connections. One hundred mutations followed by undo-all/redo-all must restore the same state hash.

### R4 — PromptBar and reference certification

Using a real browser and fake HTTP Provider, run T2I, I2I, T2V and I2V. Cover Graph edges, @ mentions, Asset Library, Runtime Artifacts, uploaded media and plugin resources. Preserve semantic roles such as `reference`, `first_frame`, `last_frame`, `character`, `style` and `mask`; unsupported roles fail explicitly.

Deduplicate the same resource across Graph and @ without merging distinct roles. Prove real multipart/JSON body, headers, endpoint and reference order/role at the wire. Unsupported I2I/I2V must return `UNSUPPORTED_INPUT_MODE`, never silently degrade to T2I/T2V.

### R5 — Provider and BYOK production gate

The ordinary path is Settings → AI 服务 → Add → Base URL → API Key → Connect → `/models` discovery → model selection. Product-grade errors are required for bad URL, DNS, 401, 403, missing `/models`, empty model list, 429, 500, timeout and malformed JSON.

Raw secrets must not appear in Agent/CLI output, PromptBar, console, logs, diagnostics, plugins, user scripts or exported projects. User-script providers must be unable to access `fs`, `child_process`, `process.env`, raw secrets, Canvas state or arbitrary privileged localhost endpoints.

### R6 — Real Provider certification

Maintain a Provider Certification Matrix for every advertised Provider/model and claimed T2I/I2I/T2V/I2V, polling, cancel, error mapping and Artifact behavior. At least one formally supported Provider must pass its complete advertised real capability set.

Fake evidence cannot certify a real Provider. Missing credentials leave `External Launch Gate = BLOCKED` while all other work continues.

### R7 — Cost and side-effect safety

Every external-cost operation enters an Execution Gate that shows AI 服务, model, task count, operation type and a truthful cost notice. If price is unknown, say that the call may incur a charge; never invent an estimate.

`workflow.node.run` without a valid human authorization returns `CONFIRMATION_REQUIRED` and submits zero HTTP requests. Caller-controlled booleans are not proof of approval. Timeout, retry, double-click, Agent retry and refresh must produce one logical paid submission. Large batches such as 50 generations require enhanced confirmation.

### R8 — Built-in Agent and Production Skill

Certify at least: a single-image promotional video, a multi-shot short and a character-consistent storyboard-to-video scenario. The Agent must understand the brief, choose a Skill, build/update the Workflow, inspect results, recover failures, respect cost gates and produce Artifacts.

Skills cannot read API keys, construct raw Provider HTTP, mutate React state or bypass Runtime. Verify install, update, disable, rollback and uninstall; missing historical Skills must degrade with an explanation.

### R9 — External Agent certification

Keep the five stable model-facing tools. Certify a logged-in Codex conversation from automatic bootstrap through inspect/apply/local-fixture run and visible Browser result. Certify status/inspect/apply with at least two available generic hosts. Certify DSH install, profile boot, inspect/apply/run/remove if it is advertised as supported.

Only real passes are `Supported`; everything else is `Experimental`, `Developer Preview`, `Blocked` or `Planned`.

### R10 — Host and Browser chaos

Inject refresh, tab close, duplicate/second tab, project switch and crash/reopen; Runtime kill/restart, occupied port and stale process; Agent exit/reconnect, writer switch and simultaneous hosts.

**Invariants:** no wrong-project or cross-tab mutation, implicit host switch, Native fallback, or duplicate generation.

### R11 — Plugin ecosystem

Verify Node Plugin install/enable/disable/update/rollback/uninstall/reload using reference plugins. A thrown plugin, invalid manifest, missing renderer, version mismatch or corrupt storage cannot crash Workflow.

Plugins declare capabilities, trust state, source, version and permissions. High-risk permission is disclosed before installation; third-party plugins do not inherit Runtime authority by default.

### R12 — Desktop and Tauri release

Build a real Windows NSIS installer. In an isolated user-data profile verify install, first boot, close/reopen, project creation, fake Provider configuration/generation and uninstall. Upgrade N → N+1 while preserving projects, Provider settings, Skills and plugins. Broken, invalid-signature and interrupted updates must leave the old version usable.

Production updater artifacts require signature verification; private signing keys never enter source, logs, artifacts or Agent context.

### R13 — Desktop security

Audit Tauri capabilities, permissions, commands, filesystem scope, shell execution, WebView remote URLs and CSP. Every privileged IPC command has minimal capability, validated input and an explicit allowlist. Test path traversal, malformed/huge/unsupported files, symlinks and corrupt media.

### R14 — Secret and privacy threat model

Create `THREAT_MODEL.md` for Web, Desktop WebView, extension, CLI, Agent bridge, Provider scripts, Node plugins and DSH plugin. Scan for API keys, tokens, signing keys, bootstrap secrets and Authorization headers. Logs and diagnostics redact secrets and unnecessary private paths.

Local Agent security requires localhost-only binding, token authentication, accepted-origin pinning and client/turn binding. Focus changes cannot silently transfer the active writer.

### R15 — Security automation

Evaluate and enable appropriate CodeQL, dependency review, secret scanning/push protection and dependency audits. Production dependencies require zero reachable Critical and zero untriaged reachable High vulnerabilities; Medium findings need documented risk and mitigation.

### R16 — Performance and resource gate

Record a fixed reference machine profile. Measure at least 20 Desktop cold/warm, Browser and Runtime starts with median, p95 and worst values. Measure appropriate Web Vitals or local time-to-interactive/time-to-canvas-ready.

Profile empty/100/500-node Workflow, 30 generation cycles and 30 open/close cycles. Memory must not grow without bound and retained memory must not remain linear after GC.

### R17 — Accessibility and input quality

Verify Tab navigation, Escape closing, Enter submission, visible focus, labels/tooltips, modal focus and absence of keyboard traps. Ordinary targets should be at least 24×24 CSS px or have equivalent spacing. Where applicable, move/connect/delete needs a reasonable non-drag alternative.

### R18 — Error UX

Use a stable taxonomy including:

```text
INPUT_RESOLUTION_FAILED
RESOURCE_NOT_EXECUTABLE
UNSUPPORTED_INPUT_MODE
REVISION_CONFLICT
WORKSPACE_UNAVAILABLE
CONFIRMATION_REQUIRED
PROVIDER_AUTH_FAILED
PROVIDER_RATE_LIMITED
PROVIDER_REQUEST_FAILED
POLLING_TIMEOUT
PLUGIN_ERROR
```

Ordinary users see what happened, whether data is affected, a recovery action and appropriate Retry/Reconnect/Open Settings actions—not stack traces, schema dumps or raw `ECONNREFUSED` messages.

### R19 — Observability and diagnostics

Advanced Diagnostics exposes App/Runtime/CLI version, Browser binding, project/revision, Provider and Host readiness, and recent sanitized errors. Exportable `diagnostics.json` is automatically redacted and excludes API keys, Authorization, signing material and bootstrap tokens.

### R20 — Offline and network degradation

Without network, users can open the app/project, edit Workflow, manage local assets and run local transforms. Remote generation, marketplaces and model discovery show a clear offline state without blanking or disabling the whole app.

### R21 — Import, export and recovery

If project import/export is supported, prove fresh-profile equality, asset integrity and plugin placeholders. Corrupt imports cannot crash or overwrite an existing project. Ship at least one user-operable backup/restore path.

### R22 — Web, Desktop and extension boundary

Either implement and verify cross-surface data bridging or clearly disclose that Web, Desktop WebView and extension data stores are independent. Never imply a shared project/account while silently showing isolated IndexedDB data.

### R23 — Installation UX

On a clean-like Windows environment, go from a Release-like artifact through download, installer, install, first launch and usable UI. Desktop users must not need Node, npm, Rust, PowerShell scripts or PATH editing. Toolkit users may use `npx flovart-cli`, with actionable install failures.

### R24 — Update, rollback and compatibility

Maintain a compatibility matrix for App, Runtime, CLI, Host Projection, Plugin API and Project Schema versions. Newer/older mismatches fail clearly with upgrade guidance and never silently corrupt data.

### R25 — CI as release law

The release gate workflow mechanically runs unit/integration tests, typecheck, Web build, Rust tests/Desktop build, extension build, DSH build, architecture guards, fake-Provider/browser E2E, migration and security checks. Critical suites run ten consecutive times and must be 10/10 without retry masking.

### R26 — Release artifact integrity

Produce Windows installer, checksums and version metadata. Add SBOM and build provenance/attestation where supported, binding binaries to repository, commit and workflow.

### R27 — Documentation as testable contract

Automate checks that documented commands exist or are explicitly deprecated. Required public docs cover five-minute Getting Started, Desktop install, AI 服务/BYOK, first generation, Agent integration, Codex, DSH, Provider extension, Node plugin, troubleshooting, data location, privacy/security, backup/recovery, uninstall, upgrade and known limitations.

Execute README instructions from a clean state. A broken docs Golden Path is a launch failure.

### R28 — Product copy and concept audit

Ordinary UI must not expose implementation vocabulary such as `ProviderAdapter`, `CredentialRef`, `CanonicalGenerationInput`, `WorkflowAgentBridge`, `clientId`, `mutationId`, `NativeWorkspace` or serializer details. Advanced Developer surfaces may expose them deliberately.

### R29 — Real-user Golden Paths

Certify with visible behavior:

1. **New manual user:** install → create project → AI service → image → generate → Canvas result → reopen and retain.
2. **Reference creator:** upload → @ reference → I2I → connect to video → I2V → export.
3. **Codex user:** automatic open/bind → inspect → apply → run → visible result.
4. **Built-in Agent:** brief → Skill → Workflow → plan → paid approval → generation → injected failure recovery → finish.
5. **Offline user:** offline open/edit/save → network restore → reconnect → continue.
6. **Upgrade user:** old app/project → update → reopen → continue.

### R30 — Soak and repetition

Run at least 50 app launches, 50 Browser bind/unbind cycles, 100 Workflow mutation batches, 30 local generation cycles, 20 asynchronous video polling cycles, 20 refresh/recovery cycles and 10 install/update cycles where practical.

Required: zero data corruption, wrong-project mutation, secret leak, duplicate paid-like submission or permanently stuck unbounded task.

### R31 — Final independent red team

At the final stage, give an independent Reviewer/Subagent only the repository, this goal, current diff, tests and release artifact—not the implementer's completion narrative. Ask it to prove Flovart should not launch by attacking data loss, secrets, wrong-project writes, duplicate charge, Provider fallback, plugin trust, Agent authority, upgrade, Browser recovery, installer, documentation truth, stale compatibility and first-run UX.

Every P0/P1 returns to implementation and full relevant verification. Repeat independent review until `P0 = 0` and `P1 = 0`.

## Autonomous Definition of Done

Autonomous engineering passes only when all of the following are evidenced:

```text
P0 = 0
P1 = 0
unit + integration + typecheck + all builds = PASS
Rust tests + architecture guards = PASS
fake Provider + Browser E2E = PASS
migration + recovery + security = PASS
critical suites = 10/10 first-run PASS
Desktop clean install + upgrade fixture = PASS
manual user + built-in Agent + generic CLI/Agent paths = PASS
docs Golden Path = PASS
independent red team P0/P1 = 0
```

## External release certification

Formal `GO` additionally requires:

```text
real Provider certification = PASS
real logged-in Codex Golden Path = PASS
production updater signing = configured and verified
formal artifact = built from a clean release commit
```

If DSH is publicly marked `Supported`, its real logged-in Golden Path must also pass; otherwise label it Developer Preview/Experimental.

## Final release matrix

The completion report must give `PASS`, `FAIL`, `BLOCKED_EXTERNAL` or `NOT_VERIFIED`, evidence and blocking status for:

```text
Core architecture  Data integrity  Workflow  PromptBar/@  Providers  BYOK
Cost safety  Built-in Agent  Codex  DSH  Plugins  Desktop  Installer
Upgrade  Security  Secrets  Recovery  Performance  Accessibility
Documentation  CI  Release artifacts
```

## Verdict law

`LAUNCH VERDICT: GO` is permitted only when the Autonomous Definition of Done and External Release Certification both pass and `P0 = 0`, `P1 = 0`.

Any P0/P1, unverified real Provider, unavailable production signing, or false public claim requires `LAUNCH VERDICT: NO-GO`. The final report must identify each blocker, exact reproduction, next action, owner and required external state.

Do not substitute checklist completion, code volume, test count, or framework breadth for user safety and real behavior.

## Primary references

- [Flovart public README](https://github.com/avabbbb/Flovart/blob/main/README.md)
- [Tauri Updater](https://v2.tauri.app/plugin/updater/)
- [Tauri Content Security Policy](https://v2.tauri.app/security/csp/)
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub code scanning](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configure-code-scanning)
- [Web Vitals](https://web.dev/articles/vitals)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
