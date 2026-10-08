# Release Candidate Diagnostics Evidence

The advanced Dock binding surface now exposes `复制诊断信息`. The payload is produced by `services/supportDiagnostics.ts`, not by serializing the connection object or browser storage.

Included fields are limited to app/version, online state, platform, loopback origin, connection status, host identity, client/project identifiers, revision, provider observation state, and recent error codes. A non-loopback endpoint is replaced with `redacted`; a loopback URL is reduced to its origin.

The payload intentionally excludes API keys, Authorization headers, bootstrap tokens, raw query strings, signing material, and provider request bodies. `tests/supportDiagnostics.test.ts` proves both the useful fields and the redaction boundary.

```text
npx vitest run tests/supportDiagnostics.test.ts tests/dockPage.test.tsx --reporter=dot
```

Result in this RC run: 2 files, 10 tests passed.
