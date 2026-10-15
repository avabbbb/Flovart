# Release Candidate Windows Installer Evidence

## Current exact application/package source (2026-09-02)

- Candidate application and package source: `712031d88a427fb04316e590f74cffef67f435b9`
- Command: `npm run tauri:build`
- Configuration: `src-tauri/tauri.local.conf.json`; local updater artifacts
  disabled and no production signing material used.
- Target: Windows x64 NSIS
- Package: `Flovart_0.3.2_x64-setup.exe`
- Size: `12,247,434` bytes
- SHA-256: `67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`
- Staged artifact directory:
  `C:\tmp\flovart-rc-artifacts-current-20260902-v3`
- Embedded file version: `0.3.2`
- Authenticode: `NotSigned` (expected for this local RC build)

`release:artifacts:check` passed with zero errors against the staged
installer, checksum manifest, and SPDX package-lock SBOM. The isolated NSIS
smoke passed silent install, real executable launch, graceful close,
uninstall, and install-root removal; the machine-readable rerun returned
`installExit: 0`, `launchObserved: true`, `closeMode: graceful`,
`uninstallExit: 0`, and `installRootExistsAfterUninstall: false`. This exact package does not certify
production Authenticode/updater signing, Hosted provenance, or real Provider
behavior.

## Current packaged WebView2 observation boundary

The v10 package was installed into isolated temporary roots and launched with
test-only WebView2 debugging policies on ports `48129` and `48130`; a separate
fixed-port process observation on `48131` confirmed the real `flovart.exe` and
its WebView2 child used the isolated profile. The application logged normal
Production Runtime startup, but no `/json/version` endpoint or debug listener
became available in the bounded probes. No UI assertion or Provider request
was made from that installed window. This is `NOT_VERIFIED` for exact-package
UI generation, not a generation failure; the source WebUI/Fake Provider smoke
and the source-identical packaged observation remain separate evidence. No
test process or RC port remained afterward; the disposable install/profile
paths were retained as trace artifacts because the shell cleanup policy
rejected a recursive delete command.

## Historical build record

- Application source: `18b317348d0c32720b10b59c0f8e5450c239ce10` (`fix: close first-run release candidate gaps`)
- Clean package commit: `e080a08387644d2fcc4a46a5e7dad5a9ce65273e` (`docs: record release candidate evidence`)
- Release workflow source: `491970e5345523bc7ca0223f18d773a978b6a014`
- Packaged candidate commit: `e080a08387644d2fcc4a46a5e7dad5a9ce65273e`
- Evidence candidate: see `RC_VERSION_TRUTH.md`
- Command: `npm run tauri:build`
- Configuration: `src-tauri/tauri.local.conf.json`; local updater artifacts
  disabled and no production signing material used.
- Target: Windows x64 NSIS
- Package: `src-tauri/target/release/bundle/nsis/Flovart_0.3.2_x64-setup.exe`
- Size: `12,249,655` bytes
- SHA-256: `827AF318C965542372B018C8D851F127C15CB80FC365182EACEC39B7ABE8D86D`
- Embedded file version: `0.3.2`
- Authenticode: `NotSigned` (expected for this local RC build)

The package was built from the restored 0.3.2 candidate worktree after the
release build's production frontend compilation; it was not assembled from a
Vite dev server.

## Isolated install smoke

- Installer mode: NSIS silent install into a unique temporary directory.
- Installer exit code: `0`.
- Installed executable: `flovart.exe` (the real desktop app, not the native-host
  sidecar).
- Launch: observed alive after the eight-second check.
- Close: graceful main-window close.
- Uninstaller exit code: `0`.
- Temporary install directory: absent after uninstall.

Machine-readable smoke result:

```json
{"artifact":"C:\\tmp\\flovart-rc-artifacts-clean-candidate-20260902-v7\\installers\\Flovart_0.3.2_x64-setup.exe","bytes":12249655,"sha256":"827AF318C965542372B018C8D851F127C15CB80FC365182EACEC39B7ABE8D86D","installRoot":"C:\\Users\\ava\\AppData\\Local\\Temp\\flovart-rc-installer-1397085ee17e4b449a7048d9f3b83305","installExit":0,"installedExe":"C:\\Users\\ava\\AppData\\Local\\Temp\\flovart-rc-installer-1397085ee17e4b449a7048d9f3b83305\\flovart.exe","launchObserved":true,"launchPath":"C:\\Users\\ava\\AppData\\Local\\Temp\\flovart-rc-installer-1397085ee17e4b449a7048d9f3b83305\\flovart.exe","closeMode":"graceful","uninstallExit":0,"installRootExistsAfterUninstall":false}
```

This proves the candidate can produce, install, launch, close, and uninstall a
real NSIS package without Node/npm/Rust on the installed path. It does not
certify Authenticode, production updater signing, real paid-provider behavior,
or clean-machine migration of an existing user profile.

The staged artifact and checksum manifest were independently rechecked by
`npm run release:artifacts:check`; the recorded 0.3.2 bytes matched with zero
verification errors. A local SPDX package-lock SBOM was also generated with
`npm sbom --package-lock-only --sbom-format=spdx --sbom-type=application` and
validated by the same artifact checker: SPDX-2.3, 663 packages, 1,377
relationships. Hosted installer SBOM generation and provenance attestation
remain separate external workflow evidence; this local package is unsigned.

## Test-only packaged UI generation evidence

The exact v10 package above retains its `NOT_VERIFIED` WebView2 UI observation
boundary because the stock Tauri/wry window did not expose a debugger endpoint.
To exercise the installed UI without changing production source or config, a
second NSIS package was built from application source
`e7b8280014478e4fd3021f4f9a578b343bea11d2` with the external test overlay
`C:\tmp\tauri-webview-cdp-test.conf.json`. The overlay only added a fixed CDP
port (`48134`) and was not committed or used for the v10 production package.

The test-only package SHA-256 was
`3BC5DDA536AA0A3EA0A7C4EDD8F8C6312AB6B65E913DBB298980D2390FB8C8E2`. Its
installed-window smoke passed the actual Home → 新建 Workflow → first-run
setup → editable Canvas → Fake Provider model discovery → cost confirmation →
image artifact path. The real HTTP recorder observed one
`POST /v1/images/generations` for `gpt-image-2`, with prompt `一只猫` and zero
references; page and console errors were zero and the fake key was absent from
browser/recorder evidence. Full details are in `RC_PACKAGED_UI_EVIDENCE.md`.

This is source-identical installed UI evidence under a test-only observability
overlay. It is not evidence of production signing, updater trust, Hosted
provenance, real Provider billing, or Codex authentication.

## Current exact clean-source package

- Application/source commit: `8e34bac2530f43f84819c22fc4ac45fb3b1db7ee`.
- Command: `npm run tauri:build`.
- Target: Windows x64 NSIS.
- Package: `Flovart_0.3.2_x64-setup.exe`.
- Size: `12,248,570` bytes.
- SHA-256: `2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A`.
- Embedded file version: `0.3.2`.
- Authenticode: `NotSigned` (local RC; production signing remains external).

Machine-readable smoke result:

```json
{"artifact":"C:\\tmp\\flovart-rc-artifacts-clean-candidate-20260902-v8\\installers\\Flovart_0.3.2_x64-setup.exe","bytes":12248570,"sha256":"2639193E7A59CD081056DF13D8214F1F455B351BA3A3B950623260CC91A4D29A","installExit":0,"launchObserved":true,"closeMode":"graceful","uninstallExit":0,"installRootExistsAfterUninstall":false}
```

This package was built from a clean checkout with no development server in the
installed path. It does not certify a production signature, signed updater,
real Provider billing or external-host login.

## Final exact clean-source package

- Application/source commit: `d539a9979cb7230f95783e3144d21ea9b6ac7685`.
- Command: `npm run tauri:build`.
- Target: Windows x64 NSIS.
- Package: `Flovart_0.3.2_x64-setup.exe`.
- Size: `12,252,502` bytes.
- SHA-256: `97B144CEBA32864DE2905F6588EA1F6827AAD83AE1F76C8126A07E25B7ADED53`.
- Embedded file version: `0.3.2`.
- Authenticode: `NotSigned` (local RC; production signing remains external).

The artifact was staged at
`C:\tmp\flovart-rc-artifacts-clean-candidate-20260902-v11`. The checksum/SPDX
checker returned zero errors. Isolated install, real executable launch,
graceful close, uninstall and temporary install-root removal all passed.

## Final exact clean-source package with signer preflight

- Application/source candidate: `71f8395e071e237d6fb83c03e340d55d795b3df0`.
- Package: `Flovart_0.3.2_x64-setup.exe`, `12,250,318` bytes.
- SHA-256: `A731DA53DFCE2A27F8F09BE0E57222B5E6E375BA6DFE7069088AB76B3F289DF8`.
- Artifact checker: pass.
- Installer lifecycle: install `0`, real launch observed, graceful close,
  uninstall `0`, temporary install root removed.
- Authenticode: `NotSigned`; production signing remains external.

## Current clean candidate (2026-09-02)

- Source snapshot: `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`.
- Target: Windows x64 NSIS.
- Package: `Flovart_0.3.2_x64-setup.exe`, `12,247,854` bytes.
- SHA-256: `A36EE61CF7CBA75948D1B8D6278E1814E40113B9962AE7A91684C2F0F86C5ACF`.
- Artifact/SBOM checker: pass; SPDX-2.3 SBOM has `663` packages and `1,377`
  relationships.
- Installer lifecycle: install `0`, real `flovart.exe` launch observed,
  graceful close, uninstall `0`, temporary install root removed.
- Authenticode: `NotSigned`; production signing remains external.

The artifact was built after fresh root and DSH dependency installation in
`C:\Users\ava\AppData\Local\Temp\flovart-rc-current-clean-20260902-v4`.

## Current v3 exact clean-source package

- Application/source candidate: `712031d88a427fb04316e590f74cffef67f435b9`.
- Target: Windows x64 NSIS.
- Package: `Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes.
- SHA-256: `67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.
- Embedded file/product version: `0.3.2` / `0.3.2`.
- Staging directory:
  `C:\tmp\flovart-rc-artifacts-current-20260902-v3`.
- Artifact checker: pass; SPDX-2.3 SBOM contains `663` packages and `1,377`
  relationships.
- Installer lifecycle: install `0`, real launch observed, graceful close,
  uninstall `0`, temporary install root removed.
- Authenticode: `NotSigned`; production signing remains external.

This exact package was built with the local unsigned Tauri overlay. The local
updater checker is intentionally not counted as a pass for this package because
that overlay disables `latest.json` generation; test-signed updater lifecycle
evidence is recorded separately.

## Repeated isolated installer lifecycle

The latest staged unsigned NSIS artifact recorded below was exercised in 10
unique temporary
install roots without launching the installed application. All cycles returned
installer exit `0`, uninstaller exit `0`, and removed their temporary install
root. The elapsed-time summary was median `3,383 ms`, p95 `3,421 ms`, worst
`3,637 ms`. This is repetition evidence for installer/uninstaller mechanics;
the single full lifecycle smoke and the separate test-signed updater runs
remain the evidence for launch and update behavior.

The latest package was then launched 20 times from isolated test profiles: 10
independent-profile cold starts and 10 same-profile warm restarts. All 20
reached a visible main window and closed gracefully. Cold startup to main
window median/p95/worst was `117/123/126 ms`; warm was `113/121/128 ms`.
This measures desktop window readiness only, not Canvas readiness.

## Latest exact clean-source package after Quick Start route closure

- Application/source candidate: `111db63d4261cd81cf7f5cadd340f1044cea32e8`.
- Package: `Flovart_0.3.2_x64-setup.exe`, `12,248,572` bytes.
- SHA-256: `0E8753064D4C9150C67D632396E158EC614945AACE663F47167688C2DB8A1C3F`.
- Staging directory:
  `C:\tmp\flovart-rc-artifacts-current-20260902-v2`.
- Artifact checker: pass with zero errors; SPDX-2.3 SBOM: 663 packages,
  1,377 relationships.
- Installer lifecycle: install `0`, real `flovart.exe` launch observed,
  graceful close, uninstall `0`, temporary install root removed.
- Authenticode: `NotSigned`; production signing remains external.
