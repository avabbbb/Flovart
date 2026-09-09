# Packaged UI First-User Evidence

## Scope

The final v16 package remains the unsigned NSIS artifact recorded in
`RC_INSTALLER_EVIDENCE.md`. Because the stock Tauri/wry WebView2 window does
not expose a debugger endpoint, a separate package was built from the same
application source with a temporary, test-only Tauri window overlay. The
overlay was created outside the repository and only injected WebView2 CDP
arguments; it is not a production configuration or release artifact.

- Application source anchor: `3f9bee9306f44da3ea8be9c480ad4e5fc91acf65` (application behavior is source-equivalent to the prior overlay build)
- Test overlay: `C:\tmp\tauri-webview-cdp-test.conf.json`
- Test package: `Flovart_0.3.2_x64-setup.exe`
- Test package SHA-256: `3BC5DDA536AA0A3EA0A7C4EDD8F8C6312AB6B65E913DBB298980D2390FB8C8E2`
- Test package staging: `C:\tmp\flovart-rc-artifacts-cdp-overlay-20260902`
- Isolated install: `C:\tmp\flovart-rc-packaged-overlay-first-user-install-v6-20260902`
- Debug port: `48134`
- Authenticode: `NotSigned` (test-only local package)

## Browser and Provider path

The package was installed silently and the real `flovart.exe` was launched
with an isolated WebView2 profile. Playwright connected to the packaged
WebView2 page over the test-only CDP overlay. The product flow passed:

1. Home opened in the packaged window.
2. `新建 Workflow` opened the first-run AI setup.
3. The setup was dismissed and the unconfigured Workflow remained editable.
4. An image node was created and the prompt `一只猫` was entered.
5. A local OpenAI-compatible Fake Provider was configured with Base URL and a
   fake API key.
6. Models were discovered through real HTTP.
7. One product-language cost confirmation was shown and accepted.
8. One image artifact appeared on the Workflow canvas.

Observed evidence:

- Page URL: `http://tauri.localhost/#/app`
- Dialog count: `1`
- Dialog text described the AI service, model, task count and possible cost.
- Provider requests: `/v1/models` and one `POST /v1/images/generations`.
- Generation model: `gpt-image-2`.
- Prompt: `一只猫`.
- Reference count: `0`.
- Page errors: `0`.
- Console errors: `0`.
- Raw fake key present in browser/recorder evidence: `false`.

Machine-readable evidence:
`C:\tmp\flovart-c14-packaged-overlay-evidence.json`.

Screenshots:

- `C:\tmp\flovart-c14-packaged-overlay-home.png`
- `C:\tmp\flovart-c14-packaged-overlay-first-run.png`
- `C:\tmp\flovart-c14-packaged-overlay-first-generation.png`

This proves the first-user generation path in an installed, source-identical
test package. It does not upgrade the production release verdict: production
Authenticode/updater signing, Hosted provenance, real Provider behavior and a
logged-in Codex transcript remain external gates, and the exact no-debug v10
package keeps its separate `NOT_VERIFIED` WebView2 UI observation boundary.

## Final candidate boundary

The final exact release candidate source is
`d539a9979cb7230f95783e3144d21ea9b6ac7685`, and its ordinary NSIS artifact is
recorded separately in `RC_INSTALLER_EVIDENCE.md`. No production-configured
CDP overlay was added to that package. The installed UI evidence above remains
explicitly test-only, source-identical to the earlier application source, and
must not be reported as exact-package production UI certification.

The final candidate source advanced to
`71f8395e071e237d6fb83c03e340d55d795b3df0` for the signer-preflight workflow
change. No new production-configured CDP observation was claimed for it; the
test-overlay boundary above remains explicit.

## Current v3 package boundary

The current exact unsigned NSIS package is bound to clean candidate
`712031d88a427fb04316e590f74cffef67f435b9` and is recorded in
`RC_INSTALLER_EVIDENCE.md`. No production-configured WebView2 CDP endpoint is
claimed for this package. The source-identical test overlay remains valid
evidence for the application flow, while exact stock-package UI observation
remains `NOT_VERIFIED`.
