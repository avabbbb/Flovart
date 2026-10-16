# Flovart Final RC Certification

Snapshot date: 2026-09-02

## Candidate identity

- Main worktree HEAD: `9be74642531ab8186ebcbce80829d68f575148a7` (intentionally
  dirty; user changes were preserved).
- Isolated clean RC snapshot: `7bf531cf3e1fe02ccf68f38e38c5b97dc04f0306`.
- Release identity: `0.3.2`, updater owner `avabbbb/Flovart`.

## Browser and port correction

Automated acceptance no longer invokes the Windows URL handler or Edge. It
uses Playwright Chrome for Testing (`chromium-1223`) with an isolated profile,
`--no-open --web-port=0 --agent-port=0`, and a one-time bootstrap URL. The
latest clean-candidate smoke established `clients=1`, `hasWorkflow=true`, and
zero console/page errors on dynamically allocated WebUI `5226` and Agent
`7380` ports.

The plain `http://127.0.0.1:37522/` origin is intentionally not a Browser
binding; it has no bootstrap handoff. For Docker, the old incorrect Web port
was corrected from the source preference `37522` to Compose's `1635` default,
with dynamic, non-overlapping host-port allocation for the dependency closure.

Manual `flovart start --open` still follows the Windows system-default browser
by design. Automated validation uses `npm run test:browser:chrome` and does
not open that browser.

## Local clean-candidate evidence

- Fresh root and DSH `npm ci`: pass.
- Full Vitest: `154` files, `1040` passed, `1` skipped.
- TypeScript, Web, extension, DSH and Rust all-targets: pass; Rust `41` tests.
- Critical suite: `10/10`, `9` files and `50` tests per repetition.
- Docs contract: `139` files checked on the final current worktree; the clean
  candidate run checked `137` files before evidence-only addenda.
- Red-team: zero failures; five model-facing Agent commands.
- Secret audit: `929` files scanned on the final current worktree, zero
  findings; the clean candidate run scanned `928` files.
- Root and DSH official-registry audits: zero vulnerabilities.
- Chrome smoke: pass; isolated rerun after one recorded concurrent-load timeout.
- NSIS: `Flovart_0.3.2_x64-setup.exe`, `12,247,854` bytes,
  SHA-256 `A36EE61CF7CBA75948D1B8D6278E1814E40113B9962AE7A91684C2F0F86C5ACF`.
- SPDX-2.3 SBOM: `663` packages, `1,377` relationships.
- Artifact checker and installer lifecycle: pass; Authenticode is `NotSigned`.
- Test-signed updater metadata checker: pass; production feed was not generated.

## Verdicts

- Product Core: `PASS` for the local/fake-provider scope.
- Autonomous RC: `PASS` for the locally verifiable scope.
- Production Launch: `NO-GO`.

## External launch gates

1. Run Hosted CI/CodeQL/provenance on the pushed candidate SHA; the current
   candidate is local-only. The read-only repository snapshot reports 13 open
   CodeQL alerts on the older remote SHA, including one critical alert.
2. Configure production Tauri updater signing and Windows Authenticode.
3. Certify real Provider credentials, billing, cancellation and output behavior.
4. Log in to Codex and run the prepared real-host transcript.
5. Confirm GitHub repository security settings, including secret scanning,
   push protection, Dependabot and branch protection.
6. Build the Docker image when a Docker daemon/CI runner is available.

No real paid Provider, user API key, Codex login, production signing key or
public release was used in this certification.
