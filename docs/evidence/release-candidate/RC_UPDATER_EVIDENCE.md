# Release Candidate Updater Evidence

## Configuration

- `src-tauri/tauri.conf.json` enables the Windows NSIS bundle and
  `createUpdaterArtifacts: true`.
- The production updater endpoint is
  `https://github.com/avabbbb/Flovart/releases/latest/download/latest.json`.
  `npm run version:check` verifies both its exact value and repository owner.
- `src-tauri/tauri.local.conf.json` deliberately sets
  `createUpdaterArtifacts: false` for local development builds.
- No repository private signing key was read or used. The installed update
  proof used a fresh test-only minisign key and a temporary self-signed HTTPS
  server under `C:\tmp`; the test certificate acceptance flags were isolated
  to that overlay and are not production configuration.

## Earlier installed N → N+1 smoke (no data fixture)

The disposable fixture was derived from the preceding clean source candidate
`27c81ad3f5c3a5c69c463aa90e724d2002c8300c`, before the final packaged-Agent
guidance guard was added. Its version files were temporarily
set to `0.3.1` for N and restored to `0.3.2` for N+1; the test-only N build
included an isolated startup trigger so the production updater store executed
its normal check, download/install, and relaunch path.

| Artifact | File version | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| N installer | `0.3.1` | `12,254,571` | `0E5BEF9C7B8AC12692485E291A4DD0746695571AA598C3485D7C477B1B0468F5` |
| N+1 installer | `0.3.2` | `12,252,763` | `6A94CDA077532564569A93512A9BB893E8BF2184B7822884331F5E07519751AD` |

The local HTTPS feed reported `0.3.2`, pointed at the N+1 installer, and its
signature matched the N+1 bytes. N installed successfully into an isolated
directory with embedded version `0.3.1`; after launch, the original process
exited and the replacement `flovart.exe` relaunched from the same directory
with embedded version `0.3.2`. This proves the installed desktop updater path,
not only an offline signature helper.

The fixture did not seed a project or generation history. The later packaged
data-preservation run below closes that specific evidence gap for the local
test-signed update path.

## Final packaged N → N+1 data-preservation run

On 2026-09-01, a disposable install used the clean application/release source
candidate `ea0b78d26ddf00fdba590098a99c678c12db8efe` for both the N and N+1
builds. Each build used only an isolated test overlay changing the version,
updater endpoint and public key; the production source configuration was
restored before the final 0.3.2 package build.

| Artifact | File version | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| N installer | `0.3.1` | `12,243,156` | `78C8DC3C465A78283915F472022EBBC7CD7463B4E51773F83EFAC371AC666675` |
| N+1 installer | `0.3.2` | `12,246,228` | `326EF3CA460FB34EBB5F0C4DAAC0951DD0DCB9AAB7C8C7286A964B8E953008A3` |

The isolated profile was seeded before launch with project id
`rc-preserve-project`, title `RC 数据保留项目`, and node id
`rc-preserve-node`. After the actual product update control was clicked, the
local HTTPS fixture recorded the download and post-relaunch check:

```text
{"port":47831,"root":"C:\\tmp\\flovart-rc-update-feed-final-20260901"}
{"method":"GET","url":"/Flovart_0.3.2_x64-setup.exe"}
{"method":"GET","url":"/latest.json"}
```

The N installer was independently installed into the isolated directory and
its embedded executable version was `0.3.1`. The real update action then
downloaded the signed N+1 installer and relaunched the same installed path;
the live replacement executable reported embedded version `0.3.2`. A visible
post-update screenshot, `C:\tmp\flovart-updater-projects-after-update.png`,
shows the seeded `RC 数据保留项目` in the recent-project list after relaunch.
The polling loop only captured the short-lived replacement process, so this
evidence does not claim a stable simultaneous observation of both versions.

```json
{"nVersion":"0.3.1","nPlusOneVersion":"0.3.2","nProcessObserved":false,"nPlusOneProcessObserved":true,"observedVersions":["0.3.2"],"updateSucceeded":true,"uiAction":"clicked-update"}
```

This is an application-level project-container preservation PASS for the
isolated test-signed Windows update path. It is not production signing,
AuthentiCode, public-feed, or schema-version migration certification.

## Current invalid update rejection

The current candidate's signed N+1 artifact was copied to an isolated feed,
then one byte at offset `4096` was flipped without changing its original
signature or feed.

```text
signed N+1 SHA-256  326EF3CA460FB34EBB5F0C4DAAC0951DD0DCB9AAB7C8C7286A964B8E953008A3
tampered SHA-256    AA34CB73837F89D181A469188BD2845FB688E786EBB8435208199D4DCA342DD8
feed signature      matches the signed N+1 bytes, not the tampered bytes
```

The installed N app stayed alive at embedded version `0.3.1`; no replacement
process or `0.3.2` executable appeared. The updater server recorded both the
metadata request and the attempted installer download, after which the UI
returned to its error/check state. A visible capture is retained at
`C:\tmp\flovart-updater-invalid-rejected.png`. This is the actual installed
updater negative case, not merely a minisign unit test.

## Interrupted download and retry

On 2026-09-02, a disposable install of the test-signed N package exercised a
slow local HTTPS feed. The test-only startup trigger clicked the normal product
update control; after the installer request was observed, the exact N app
process was terminated while the N+1 installer was still downloading.

```json
{"nVersionBefore":"0.3.1","nVersionAfterInterrupt":"0.3.1","nPlusOneVersionAfterRetry":"0.3.2","slowRequestObserved":true,"retryRequestObserved":true,"retrySucceeded":true}
```

The slow feed recorded `GET /latest.json` followed by
`GET /Flovart_0.3.2_x64-setup.exe`. After the kill, the isolated install still
reported `0.3.1`. A normal feed was then started and the next app launch
recorded a fresh metadata request and installer request; the real updater
replaced the installation with `0.3.2`. The exact disposable logs are
`C:\tmp\flovart-rc-update-interruption-hook-slow-20260902031051.stdout.log`,
`C:\tmp\flovart-rc-update-interruption-hook-normal-20260902031051.stdout.log`,
and `C:\tmp\flovart-rc-update-interruption-hook-app-20260902031051.stderr.log`.
The install root and WebView2 profile were removed by the harness. The HTTPS
server, certificate, test key, and startup trigger were test-only and were not
copied into the candidate source or production configuration.

## Local release boundaries

- The candidate NSIS installer is not Authenticode-signed in this local run.
- Production updater private key/password, Authenticode certificate, timestamp
  policy, GitHub Release publication, and production-equivalent clean-machine
  verification remain external release gates.
- Production signing material was not written to the repository, logs, Agent
  context, or this evidence file.

## Hosted release pipeline hardening

`.github/workflows/build-desktop.yml` runs the release gate and reusable
security gate before building. It creates a draft first, stages installers,
emits `SHA256SUMS.txt`, generates a platform-specific SPDX JSON SBOM with
`anchore/sbom-action@v0`, and uses `actions/attest@v4` for tag-only artifact
attestation. A separate finalizer makes the draft public only after every
matrix platform and integrity step succeeds. Hosted execution and production
secrets are not claimed by this local evidence.

## Final exact candidate boundary

The final exact local application candidate is
`d539a9979cb7230f95783e3144d21ea9b6ac7685`; its rebuilt NSIS package is
recorded in `RC_INSTALLER_EVIDENCE.md`. The signed N → N+1, invalid-signature
rejection and interrupted-download/retry runs above remain isolated
test-signed fixtures from earlier source-equivalent candidates. The local
candidate configuration deliberately disables production updater artifacts,
so no production-signed update is claimed for this final SHA. Production
signing and final tagged-feed verification remain external release gates.

The final candidate is now
`71f8395e071e237d6fb83c03e340d55d795b3df0`. It has a rebuilt unsigned local
NSIS artifact, but no production-signed updater was generated because local
builds intentionally disable updater artifacts. The test-signed update and
negative-case evidence above remains valid as isolated source-equivalent
fixture evidence, not as final production-feed certification.

## Current exact candidate and feed metadata gate

The current clean candidate is
`712031d88a427fb04316e590f74cffef67f435b9`. Its rebuilt unsigned local NSIS
artifact is `Flovart_0.3.2_x64-setup.exe`, `12,247,434` bytes, SHA-256
`67FE186BD5AA6221190BE3AA98EC5C5639C1935AC685D28E8FB8489426439E1D`.

The tag-only desktop workflow stages the Tauri-generated `latest.json` and
target `.sig` sidecars in each matrix job. After all platforms finish, the
`publish-release` job downloads the complete draft asset set and runs
`scripts/check-updater-artifacts.mjs`. The verifier requires a matching
version, HTTPS artifact URL, staged artifact and sidecar for each platform,
and exact feed/sidecar signature text agreement. The isolated test-signed feed
`C:\tmp\flovart-rc-update-feed-final-20260901` passed this check for one
Windows entry; the focused unit suite passed `4/4`, including missing,
mismatched and insecure metadata cases.

This is a release-metadata integrity gate, not cryptographic verification of a
production key. The installed N→N+1 test-signed lifecycle evidence above was
captured from the preceding source-equivalent candidate; the current candidate
rechecks the same verifier and local release configuration but does not claim
a new production `latest.json`, production signature, Authenticode signature,
Hosted run or public feed.

## Current clean candidate boundary (2026-09-02)

The current clean snapshot is `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`.
Its local build intentionally uses `src-tauri/tauri.local.conf.json`, which
disables production updater artifact generation. The existing isolated
test-signed feed verifier still passes for `0.3.2` (`windows-x86_64`), but that
fixture is not claimed as the current candidate's production feed.

Current candidate status:

- test-signed metadata verifier: pass;
- production `.sig` / `latest.json`: not generated locally;
- production signing key, Authenticode and Hosted feed verification: external.
