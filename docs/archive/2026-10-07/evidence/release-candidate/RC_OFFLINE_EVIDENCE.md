# Release Candidate Offline Evidence

## Scope

Offline support is intentionally local-first. The browser/desktop shell must remain usable for local projects, assets, Canvas editing, and local transforms; remote AI services, model discovery, marketplace content, and remote Agent connections wait for network recovery.

## Evidence

- `components/OfflineNotice.tsx` listens to the browser `online` / `offline` events and exposes a polite status message instead of blanking the shell.
- `components/AppShell.tsx` mounts the notice outside the active Workflow/Table/Agent surface, so local navigation remains available.
- `tests/offlineShell.test.tsx` verifies the notice appears on an offline event and explicitly names the local capabilities that remain usable.
- `tests/offlineShell.test.ts` verifies startup HTML has no Google-hosted font dependency.
- `tests/offlineShell.test.ts` and the normal local persistence suite cover the no-remote-resource startup boundary; localforage-backed project/media paths remain local.

## Boundary

The source WebUI still needs its local Vite/desktop host to serve the application shell. This is not a claim that an arbitrary remote WebUI can reload without its host. The packaged Tauri app is the offline launch target; real network-disable verification of a signed installer remains a distribution certification gate.

## Verification

```text
npx vitest run tests/offlineShell.test.ts tests/offlineShell.test.tsx --reporter=dot
```

Result in this RC run: 2 files, 2 tests passed.
