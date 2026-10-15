# Flovart Release Candidate Baseline

## Scope

这是 Release Candidate Hardening 的本机基线。它记录的是运行时/测试环境状态，不代表当前 Git 工作树干净；已有 U0–U9 修改按约定保留，未执行 reset、checkout 或清理用户改动。

## Exact application/package candidate recheck

The current release-candidate application/package evidence is bound to clean
detached source commit `712031d88a427fb04316e590f74cffef67f435b9`. The exact
local NSIS package is `Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes,
SHA-256
`67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.
Full local quality, dependency, documentation, red-team, critical-repeat,
artifact-integrity, updater-feed, and isolated installer lifecycle checks
passed from this candidate. Rust all-target tests required the documented
single-job/no-debug-info retry after a Windows linker PDB limit; the retry
passed all 41 tests. The package is unsigned local evidence; Hosted CI,
provenance, production signing, public publication, and real-account
certification remain external.

## Environment

- Collected: 2026-09-02
- OS: Microsoft Windows 11 专业工作站版 `10.0.26200`
- CPU: 11th Gen Intel(R) Core(TM) i5-11400H @ 2.70GHz
- Logical processors: 12
- Visible memory: 15.65 GiB
- Node.js: `v24.14.0`
- npm: `11.9.0`
- Rust: `rustc 1.94.1 (e408947bf 2026-03-25)`
- Cargo: `1.94.1 (29ea6fb6a 2026-03-24)`
- Flovart package version: `0.3.2`
- HEAD at baseline: `9be74642531ab8186ebcbce80829d68f575148a7`

## Worktree

- Runtime/process baseline: clean.
- Git worktree: intentionally dirty; 37 existing modified/untracked paths were present before this baseline file was added.
- No user changes were reverted or overwritten.

## Process and port cleanup

Stopped only processes attributable to the previous automated acceptance runs:

- four orphaned Flovart `npm run dev` / Vite branches;
- four Playwright core smoke runners and their temporary Edge children;
- one Edge `flovart-edge-bootstrap-profile-*` process tree;
- one orphaned `node agent/index.js` owning port `17373`.

The Codex/Playwright MCP browser process was not stopped. After cleanup, no known Flovart test/Vite process remained and ports `37521`, `37522`, `37523`, `17373`, `11451`, `8411`, `8438`, `8749`, `8787`, and `8788` had no listeners.

## RC0 verification commands

The following gates are run from this repository after the process cleanup. Results are appended here when each command completes:

- `npx vitest run --no-file-parallelism --maxWorkers=1 --reporter=dot`
- `npm test -- --reporter=dot`
- `npx tsc --noEmit`
- `npm run build`
- `npm run ext:build`
- `npm --prefix dsh-plugin run build`
- `cargo test --all-targets` from `src-tauri`
- `git diff --check`

## RC0 results

- Vitest (standard `npm test`): `143` files passed; `998` passed, `1` skipped (`999` total), exit code `0`; duration `66.03s`.
- Vitest diagnostic single-worker mode: one full-suite run timed out in `tests/workflowImageTools.test.tsx` after `15s`; the isolated transaction test passed `20/20` repetitions and the standard suite passed. This is recorded as a non-release execution-mode stability risk, not as a business-logic pass.
- TypeScript: `npx tsc --noEmit` passed.
- Web build: `npm run build` passed; Vite transformed `4303` modules. Existing dynamic-import and large-chunk warnings remain.
- Extension build: `npm run ext:build` passed and produced `dist-extension`.
- DSH build: `npm --prefix dsh-plugin run build` passed; client loader contract verified.
- Rust: `cargo test --all-targets` passed with `36` tests and no failures.
- Diff hygiene: `git diff --check` passed; Git only reported existing LF/CRLF normalization warnings.

## Historical final certification source anchor

- Local review base: `9a1534b035350152c87d93a5f6e07f7452f3f66f1`.
- Clean candidate: `b7ba494b1d7d542d12f00d3f5711a43e3d5eb1b1` in the detached
  worktree `flovart-rc-candidate-f46b418215ba44c1a083da5dbfa80b9c`.
- The local `origin/main` ref still points at the review base in this checkout;
  the remote branch later advanced to `969478db26e7f55668bcb3a782e58962fe0f3f47`
  through a `stats/history.json` traffic snapshot only. No push, release tag,
  or public release was created by this pass.
- `npm run version:check`, `npm run docs:check`, `npm run release:red-team`,
  and `npm run release:secret-audit` pass from the clean candidate.
- The current public Releases list still contains only `v0.2.0-test`; a hosted
  run of the final candidate remains an external repository gate.

## Final candidate package evidence

- NSIS: `Flovart_0.3.2_x64-setup.exe`
- Size: `12,254,279` bytes
- SHA-256: `41D9178E515F5C2C33BFC5977E73FC12263E22292F829139E7DD746DA3EBC194`
- Installer smoke: install `0`, main `flovart.exe` launch observed, graceful
  close, uninstall `0`, install directory removed.

## Updated source candidate after dependency audit

- Source candidate: `52b7e51e7fdd1094b98b88a173b8b7111fb03d12` in the same clean
  detached worktree. This candidate contains the dependency lock refresh and
  Hosted npm audit gate; the earlier package evidence above remains historical.
- Clean install: `npm ci --ignore-scripts --registry=https://registry.npmjs.org`
  passed; full and `--omit=dev` official-registry audits both returned
  `0 vulnerabilities`.
- Full regression: Vitest `151` files, `1019` passed, `1` skipped; TypeScript,
  Web, extension, DSH, Rust and critical suite `10/10` all passed.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,248,162` bytes,
  SHA-256 `B780E378C16E48CEA058316F658CB594641F832335C7611011572164AB8ACB22`.
  Isolated install, launch, graceful close and uninstall all passed; the
  artifact checker reported zero errors.

## Final candidate certification snapshot

- Final clean detached source candidate used for the final application and
  release-workflow checks: `c95ff2943777f0460d9b5de5da610345d64814e5`. Its
  preceding clean source commit `0d6dc8b114849896e851bf909c8e2483d701ec94`
  contains the application and release-workflow changes used for the package;
  the later candidate commits only anchor release evidence.
- Final full Vitest: `151` files passed; `1019` passed and `1` skipped (`1020`
  total), with `--no-file-parallelism --maxWorkers=1`; exit `0`.
- Final typecheck, Web build, Extension build, DSH build, Rust
  `--all-targets`, dependency audit, docs contract, secret audit, red-team,
  artifact tests and diff check all passed.
- Final NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,248,835` bytes,
  SHA-256 `53B7BD71D2FB1E35EB2A57347EBA0C7AD111EDD101FBB0F4360FF942D9436AD8`,
  file/product version `0.3.2`; the exact installer checksum verifier passed.
- The isolated NSIS install smoke returned install `0`, observed the real
  executable, closed gracefully, returned uninstall `0`, and removed its
  temporary install root. A disposable test-signed N `0.3.1` → N+1 `0.3.2`
  updater run retained a seeded project container; invalid signature rejection
  also remains green.
- This candidate is still local and unpushed. The exact candidate has no
  Hosted GitHub run, production signing, public feed, real Provider, or logged-
  in Codex evidence.

## Current exact-source package

- Clean candidate source: `68865e7c3a0b674adf7118860d8a0afba132f237`.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,245,884` bytes,
  SHA-256 `12C7802F9CEDB2FE05B646251959A5B1BAC33F77237A458D13741532B170D426`.
- The package was rebuilt from that clean source and the staged checksum/SBOM
  checker returned zero errors. This replaces the earlier package hashes in
  this append-only baseline as the current artifact identity.

## Current source-fix package

- Clean application source: `ce0c235ef0bbfc0920600d75a37747cb733bad48`
  (`fix: decode generated data URLs in desktop WebView`).
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,246,944` bytes,
  SHA-256 `17FF507822D8A9A0D469FF3C382A6F4AB4CC85154CAA30B791237F7B3FCD2F24`.
- The exact package passed isolated install, launch, graceful close and
  uninstall. Full post-fix Vitest passed `151` files (`1,022` passed,
  `1` skipped); the 10-repeat critical suite was `10/10`.
- This unsigned local package does not certify production Authenticode,
  updater signing, Hosted provenance, real Provider billing or Codex login.

## Current candidate after CodeQL source triage

- Source and package commit: `1444453597e2cb9c7c5a3867f406e33391cd4a3a`.
- The research artifact-key sanitizer now caps input at 4096 characters and
  uses a bounded ASCII scan; focused regression passed `5/5`.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,247,499` bytes,
  SHA-256 `2DE7DF820459F681521D99EBBA4D6D4E18ACE645E8DF95821166E44D4F7AD26F`.
- Staged checksum/SPDX validation and isolated install/launch/graceful
  close/uninstall passed. The current package supersedes the prior local hash.
- Remote read-only CodeQL status remains 13 open alerts on the older main SHA;
  the candidate requires a Hosted scan before the security gate can be green.

## Current first-user closure candidate

- Application source: `18b317348d0c32720b10b59c0f8e5450c239ce10`
  (`fix: close first-run release candidate gaps`); package commit:
  `e080a08387644d2fcc4a46a5e7dad5a9ce65273e`.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,249,655` bytes,
  SHA-256 `827AF318C965542372B018C8D851F127C15CB80FC365182EACEC39B7ABE8D86D`.
- The candidate includes the nested translation fix and the public first-run
  documentation closure. Visible Chromium first-user generation and isolated
  NSIS install/launch/graceful-close/uninstall passed; the new package was
  checked with local SPDX and checksum evidence in `RC_ARTIFACT_EVIDENCE.md`.
- Hosted CI/CodeQL, production signing, public release publication and real
  Provider/Codex certification remain external.

## Current clean-source RC baseline

- Candidate commit: `8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`.
- Root clean install: 586 packages installed, 0 vulnerabilities.
- DSH clean install: 92 packages installed, 0 vulnerabilities.
- Full Vitest: 151 files, 1,023 passed, 1 skipped.
- Critical suite: 10/10, 9 files and 50 tests per repetition.
- TypeScript, Web, extension, DSH and Rust all-target tests: pass; Rust 41
  tests passed.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, 12,248,570 bytes,
  SHA-256 `2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`.
- Artifact checker: pass; SPDX-2.3 SBOM contains 663 packages and 1,377
  relationships.
- Installer lifecycle: install 0, real launch observed, graceful close,
  uninstall 0, temporary install root removed.

This is a local clean-source baseline. Hosted workflow execution, production
signing and external Provider/Codex certification are not included.

## Final exact candidate baseline

- Candidate commit: `d539a9979cb7230f95783e3144d21ea9b6ac7685`.
- Full Vitest: 152 files, 1,026 passed, 1 skipped.
- Critical suite: 10/10; 9 files and 50 tests per repetition.
- TypeScript, Web, extension, DSH and Rust all-target tests: pass; Rust 41
  tests passed.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, 12,252,502 bytes,
  SHA-256 `97B144CEBA32864DE2905F6588EA1F6827AAD83AE1F76C8126A07E25B7ADED53`.
- Artifact checker and isolated installer lifecycle: pass.
- CLI package: `flovart-cli@0.3.2`, 123,596 bytes,
  SHA-256 `F9EB5E2823D6A9B4ED27C0D19276C6AB561A93DF5C7C9FAE168C98D307A701FB`;
  isolated help/status smoke: pass.

The final candidate is unpushed and unsigned. Hosted execution, production
signing and external Provider/Codex certification remain outside this local
baseline.

## Final exact candidate with signer preflight

- Candidate: `71f8395e071e237d6fb83c03e340d55d795b3df0`.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, 12,250,318 bytes,
  SHA-256 `A731DA53DFCE2A27F8F09BE0E57222B5E6E375BA6DFE7069088AB76B3F289DF8`.
- Stable-tag missing-signing-key preflight: present and covered by local
  release red-team.
- Artifact validation and isolated install/launch/close/uninstall: pass.

The candidate is unpushed and unsigned; Hosted and production signing evidence
remain external.

## Current v3 clean-source package

- Candidate commit: `712031d88a427fb04316e590f74cffef67f435b9`.
- Full Vitest: `154` files, `1,035` passed, `1` skipped.
- Critical suite: `10/10`; `9` files and `50` tests per repetition.
- TypeScript, Web (`4,306` modules), extension, DSH and Rust all-target
  checks: pass; Rust `41` tests passed after a clean single-job build.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes,
  SHA-256 `67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.
- SPDX-2.3 SBOM: `663` packages and `1,377` relationships; artifact checker:
  pass.
- Installer lifecycle: install `0`, real launch observed, graceful close,
  uninstall `0`, temporary install root removed.

This is unsigned local evidence from a detached clean candidate. Hosted
workflow execution, production signing, public publication and real-account
certification remain external.

## Current-worktree post-fix recheck

The current working tree was rechecked after the Chrome-only launcher and
Docker port hardening:

```text
full Vitest: 154 files, 1040 passed, 1 skipped
focused dev-command: 20 passed
critical suite: 10/10 (9 files, 50 tests each)
TypeScript/Web/extension/DSH: pass
Rust all-targets: 41 passed
version/docs/red-team/secret checks: pass
root + DSH official-registry audit: 0 vulnerabilities
artifact + SPDX + test-signed updater checks: pass
git diff --check: pass
```

The browser smoke used Chrome for Testing with dynamic WebUI/Agent ports and
zero page/console errors. No listener remained on `37522`, `17373` or `1635`;
the Docker daemon was unavailable, so an image build is not claimed here.

## Current clean candidate reproducibility snapshot

- Candidate commit: `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`.
- Fresh root and DSH `npm ci`: pass.
- Full Vitest: `154` files, `1,040` passed, `1` skipped.
- TypeScript, Web, extension, DSH and Rust all-targets: pass; Rust `41`
  tests passed.
- Critical suite: `10/10`; `9` files and `50` tests per repetition.
- Chrome for Testing isolated smoke: pass; `clients=1`, `hasWorkflow=true`,
  zero console/page errors.
- Windows x64 NSIS: `12,247,854` bytes,
  SHA-256 `A36EE61CF7CBA75948D1B8D6278E1814E40113B9962AE7A91684C2F0F86C5ACF`.

The candidate worktree was clean after generated build output. The NSIS is
unsigned local evidence; Hosted CI, production signing and public release are
not claimed.
