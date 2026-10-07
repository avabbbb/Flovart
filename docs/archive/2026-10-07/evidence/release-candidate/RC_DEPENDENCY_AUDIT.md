# Flovart Release Candidate Dependency Audit

## Scope

This is the dependency-security evidence for the current release-candidate
worktree. It covers both the runtime dependency graph and the development graph
used to build the release. The audit was run against the official npm registry;
no `npm audit fix --force` was used.

The current application/package source candidate used for the final install
and build is
`712031d88a427fb04316e590f74cffef67f435b9`.

## Changes

- Removed `@huggingface/transformers` and `@excalidraw/excalidraw` from the
  root production dependencies after confirming that neither package is
  imported by the current source tree.
- Raised direct `nanoid` and `react-router` constraints to patched releases.
- Re-resolved the lockfile within compatible ranges, including patched
  `protobufjs`, `fast-uri`, `ip-address`, `ws`, Vite tooling and Tar.
- Raised the DSH plugin's direct `esbuild` constraint to `^0.28.2`; the
  nested DSH audit now reports zero vulnerabilities at moderate severity.

## Clean-install evidence

From the clean detached candidate worktree:

```text
npm ci --ignore-scripts --registry=https://registry.npmjs.org
added 586 packages, and audited 587 packages
found 0 vulnerabilities
```

The installed graph was checked with:

```text
npm audit --registry=https://registry.npmjs.org --audit-level=high
found 0 vulnerabilities

npm audit --registry=https://registry.npmjs.org --omit=dev --audit-level=high
found 0 vulnerabilities
```

Important resolved security versions include:

```text
protobufjs 7.6.6
fast-uri 3.1.6
ip-address 10.7.0
ws 8.21.3
react-router 7.18.3
nanoid 5.1.16
vite 6.4.3
tar 7.5.22
```

The hosted security workflow now repeats the full clean install and official
registry audit. A hosted run on the final pushed candidate is still required;
this document is local evidence and does not certify GitHub repository
security settings or production release signing.

## Current nested DSH plugin graph

The final-candidate clean worktree at source commit
`8e34bac2530f43f84819c22fc4ac45fb3b1db7ee` also installed the separately
locked `dsh-plugin` graph with `npm ci --ignore-scripts`.

The first clean probe found the development-only `esbuild 0.21.5` advisory
(`GHSA-67mh-4wv8-2f99`, moderate). It was resolved without `npm audit fix
--force` by updating the direct DSH build dependency and lockfile to
`esbuild 0.28.2`. The resulting audit is:

```text
npm audit --prefix dsh-plugin --registry=https://registry.npmjs.org --audit-level=moderate
found 0 vulnerabilities
```

The DSH build and client-loader contract pass with the updated compiler. CI and
the hosted Security dependency job now audit this nested graph explicitly.

## Current-worktree registry parity recheck

The current worktree was rechecked after the release-environment fixes:

```text
npm run release:dependency-audit
found 0 vulnerabilities
npm audit --prefix dsh-plugin --registry=https://registry.npmjs.org --audit-level=moderate
found 0 vulnerabilities
```

An initial nested audit without an explicit registry inherited a local mirror
and returned HTTP 405; it did not report a vulnerability. The Security
workflow now pins that audit to the official npm registry so local npm config
cannot change the release result.
