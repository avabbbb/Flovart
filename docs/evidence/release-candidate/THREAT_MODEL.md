# Flovart Threat Model

## Scope and trust boundaries

Flovart is a local-first desktop/WebUI product. The primary trust boundary is
between the browser/WebView, the localhost Agent/Workspace Operator, the
Tauri Production Runtime, external Agent projections, and user-configured AI
services. The following assets must not cross an untrusted boundary:

- AI service API keys and Authorization headers;
- Agent bootstrap and Runtime control tokens;
- local project, workflow, asset, and generated-media data;
- Runtime credential metadata and task receipts;
- updater signing private keys.

The fake Provider and local test fixtures are non-production test services.
They must never be used as evidence for paid Provider billing, cancellation,
quality, or account authentication.

## Boundary controls

### Browser and WebUI

- Browser-bound workflow mutations are routed to the explicitly bound visible
  Browser Workflow. Missing, stale, or inactive bindings fail explicitly.
- Native/Headless Workspace is only selected by an explicit workspace mode; it
  is not a Browser fallback.
- Bootstrap query credentials are exchanged into session state and the URL is
  scrubbed. Diagnostics and normal product responses redact connection tokens.
- The default UI uses product vocabulary; implementation details belong in
  Advanced/Developer diagnostics.

### Local Agent Bridge

- The HTTP Agent binds to `127.0.0.1` and uses a generated token for protected
  routes. `/health` exposes readiness metadata only; `/config` exposes token
  presence, not the token value.
- Origin binding is persisted after a token-authenticated browser request.
  Protected browser requests must match the bound origin; CLI requests use the
  loopback token header without an Origin header.
- The public Agent surface is limited to the stable workflow commands plus
  explicit discovery/bootstrap and diagnostics paths.
- Host identity, distribution target, and runtime binding remain separate;
  workflow authority does not branch on a Host-specific implementation.

### DSH Workspace proxy

- The DSH projection accepts only loopback, credential-free HTTP targets.
- The proxy allowlists `/health`, explicit native registration, the stable
  tools route, and director binding/status routes. It forwards the token only
  upstream and does not expose it to the DSH request caller.
- Request bodies are capped and unknown routes/methods are rejected.

### Production Runtime and Tauri IPC

- Runtime control binds to an ephemeral loopback port and requires a bearer
  token with constant-time comparison. Requests carrying a browser `Origin`
  are rejected.
- Typed IPC payloads use `deny_unknown_fields`; command JSON and browser import
  chunks have bounded sizes. IDs, task routes, artifact paths, and import
  sequences are validated before use.
- Tauri capabilities grant only the project Runtime/managed-agent permissions
  required by the current product surface. The Runtime credential boundary
  does not return raw secret material to the WebUI.

### Skill and plugin packages

- Local Skill discovery ignores binary files, links, VCS folders, dependency
  folders, and build output.
- Hub/Agent-provided Skill entries are validated before any install directory
  is created: canonical relative text paths only, no duplicate paths, bounded
  file count, per-file bytes, and total bytes. A failed install removes its
  partial directory.
- Production manifests are parsed and validated before a package is surfaced
  or bound. Skill context does not grant additional tools, filesystem,
  network, Secret, or Provider authority.
- Toolkit archives reject absolute/traversal paths and symbolic/hard links;
  bundle entrypoints must remain bundle-relative.
- The current Workflow Node Plugin SDK is an in-process trusted-code surface,
  not a security sandbox. Its context does not grant Provider, Runtime,
  credential, React-store, or direct host-state APIs, and renderer failures
  are contained per node, but arbitrary code loaded into the same WebView must
  not be advertised as isolated third-party execution until a separate
  permission/sandbox layer exists.
- Unknown or incompatible plugin nodes remain as data/placeholders rather than
  being deleted or executed.

## Abuse cases and expected outcomes

| Threat | Control | Expected result |
| --- | --- | --- |
| Skill path traversal or absolute path | package path validation and install-root containment | reject before write; no outside file |
| Skill archive/package denial of service | file count, per-file, total, and request limits | reject bounded input; no partial install |
| Corrupt or malformed manifest | schema/id/version/capability validation | package not surfaced or bound |
| Wrong localhost service | WebUI marker and loopback-only Agent config | do not silently connect |
| Cross-tab/project mutation | active Browser Writer, client/project/revision checks | explicit failure; no wrong target write |
| Browser-to-Native authority confusion | explicit native/headless mode only | no silent fallback |
| Provider key disclosure | credential boundary, redaction, no key in Agent result/recorder | key remains internal |
| DSH proxy abuse | route/method/target allowlist and host-side token | unavailable/rejected |
| Runtime IPC injection | bearer auth, typed inputs, size/path validation | reject request |
| Malicious updater/archive | signature verification at release boundary, checksum/archive checks | reject artifact; preserve current install |

## Verification map

The controls are covered by the existing focused suites for Agent bootstrap,
Workspace sessions, browser import security, extension security, Runtime
control server, toolkit bundle installation, Skill packages, and plugin/bundle
management. RC9 adds direct untrusted-entry validation coverage and records
the exact commands and results in `RC_SECURITY_EVIDENCE.md`.

Release automation adds three independent checks:

- `npm run release:secret-audit` scans every Git-visible text file (tracked and
  non-ignored untracked files) for high-confidence private-key, access-token,
  literal-bearer and hard-coded API-key patterns. It never prints a matched
  value; previews are redacted.
- `.github/workflows/security.yml` runs the tracked-secret audit, CodeQL for
  JavaScript/TypeScript and Rust, and high-severity dependency review for pull
  requests.
- GitHub secret scanning, push protection and repository rules are hosting
  controls. They must be enabled and verified in the release repository; a
  workflow file alone does not prove that those settings are active.

## Residual / external-only risks

- Production updater signing private key custody and hosted artifact
  attestation are release-operations concerns; no production key is stored in
  this repository.
- Real Provider billing, pricing, cancellation, and account behavior require
  an explicitly authorized external test account.
- Real Codex/DSH login and account/session revocation require the corresponding
  external host accounts.
