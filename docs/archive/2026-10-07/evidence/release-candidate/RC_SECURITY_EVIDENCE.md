# Release Candidate Security Evidence

## Finding fixed in RC9

The Agent/Skill Hub install route accepted an arbitrary JSON `files` array and
only checked path traversal while writing it. That left the package-specific
file extension, count, and size limits at the local-directory reader boundary,
not at the network/Agent boundary.

The canonical Node-side package helper now validates every untrusted entry
before `SkillRegistry.installPackage` creates its install directory:

- canonical forward-slash relative paths only;
- allowlisted text extensions and ignored-directory rules;
- no duplicate paths;
- at most 512 entries;
- at most 1 MiB per UTF-8 file;
- at most 4 MiB total UTF-8 content;
- string path/content types only.

Invalid input therefore fails before a package directory is created. The
existing install cleanup remains in place for failures after directory
creation.

## Focused verification

```text
npx vitest run tests/skillPackage.test.ts tests/agentSkillRegistry.test.ts --reporter=dot
  2 files passed, 15 tests passed

npx tsc --noEmit
  passed
```

The tests cover traversal, absolute/non-canonical paths, binary extensions,
duplicate paths, oversized files, total-size overflow, entry-count overflow,
manifest mismatch, version mismatch, and the guarantee that rejected packages
leave no install directory behind.

## Existing boundary evidence rechecked by source/tests

- `tests/flovartWorkspaceClient.test.ts`: non-loopback adapter rejection,
  structured errors, typed command envelope, and no shadow-state fallback.
- `tests/dshWorkspaceProxy.test.ts`: loopback target restriction, route/method
  allowlist, and host-side token forwarding.
- `tests/extensionSecurityBoundary.test.ts`: Native Messaging-only extension,
  no permanent page access, and no Provider credential/direct-call path.
- `tests/workflowAgentSession.test.js`: Browser Writer ownership, project/tab
  binding, explicit Native mode, reconnect cleanup, and no Browser-to-Native
  fallback.
- `src-tauri/tests/runtime_control_server.rs`: Runtime bearer auth, browser
  Origin rejection, bounded request bodies, and typed Runtime routes.
- `tests/flovartBundleManager.test.js`: checksum failure, archive traversal /
  link rejection, and bundle-relative entrypoint validation.

## Secret boundary

The RC path uses only local fake fixtures. The raw AI key is not part of Skill
package validation or the install result. Existing Provider/Agent tests cover
redaction from Agent results, logs/diagnostics boundaries, User Script mapping,
and fake Provider recording. Production updater private keys remain external
release material and are not read or committed by this RC work.

## Residual risks

This document is not a certification of real Provider billing, Codex login,
DSH account behavior, or production updater signing. Those remain explicit
external release gates.
